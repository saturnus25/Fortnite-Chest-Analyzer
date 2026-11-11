// Unreal replay frame, package-map and actor replication decoding.
// Based on the MIT-licensed Unreal.Core reader by Shiqan and contributors.
use std::collections::HashMap;

use crate::analysis::{Analysis, Kind, Observation, Observer, Position, Update, is_supply_drop};
use crate::names::name_of;
use crate::wire::{Bits, Bytes, Invalid, WireResult, path_tail};

const MAX_CHANNELS: usize = 32_767;
const MAX_GROUPS: usize = 16_384;
const MAX_FIELDS: usize = 1_000_000;
const MAX_GUIDS: usize = 400_000;
const MAX_PARTIAL_BITS: usize = 8 * 1024 * 1024;

struct Field {
    name: String,
    observed: bool,
}

struct Group {
    name: String,
    tail: String,
    schema_key: String,
    schema_started: bool,
    supply: bool,
    kind: Kind,
    fields: Vec<Option<Field>>,
}

#[derive(Clone, Copy)]
struct Actor {
    id: u32,
    archetype: Option<u32>,
    location: Option<Position>,
}

#[derive(Clone, Copy)]
struct Bunch {
    channel: usize,
    open: bool,
    close: bool,
    reliable: bool,
    sequence: u32,
    exports: bool,
    mapped: bool,
}

struct Partial {
    bunch: Bunch,
    payload: Vec<u8>,
    bits: usize,
}

pub(crate) struct Network {
    channels: Vec<Option<Actor>>,
    groups: Vec<Group>,
    names: HashMap<String, usize>,
    indices: HashMap<u32, usize>,
    guids: HashMap<u32, String>,
    resolved: HashMap<u32, usize>,
    missing: HashMap<String, usize>,
    observer: Observer,
    packet_number: u32,
    reliable_sequence: u32,
    partial: Option<Partial>,
    field_budget: usize,
    streaming: bool,
    game_data: bool,
    cannon_layout: bool,
}

impl Network {
    pub(crate) fn new(flags: u32, cannon_layout: bool) -> Self {
        Self {
            channels: vec![None; MAX_CHANNELS],
            groups: Vec::new(),
            names: HashMap::new(),
            indices: HashMap::new(),
            guids: HashMap::new(),
            resolved: HashMap::new(),
            missing: HashMap::new(),
            observer: Observer::default(),
            packet_number: 0,
            reliable_sequence: 0,
            partial: None,
            field_budget: 0,
            streaming: flags & 2 != 0,
            game_data: flags & 8 != 0,
            cannon_layout,
        }
    }

    pub(crate) fn saw_activity_schema(&self) -> bool {
        self.observer.saw_container_schema
    }

    pub(crate) fn finish(&self, result: &mut Analysis) {
        self.observer.finish(result, &self.guids);
        #[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
        {
            result.reward_probe.abilities.finish(&self.guids);
            for (path, index) in &self.names {
                let exports = &mut result.reward_probe.acquisition_exports;
                if path.len() <= 512 && exports.len() < 256 {
                    let direct_schema = acquisition_reference(path);
                    let fields: Vec<_> = self.groups[*index]
                        .fields
                        .iter()
                        .flatten()
                        .filter(|field| {
                            field.name.len() <= 512
                                && (direct_schema || acquisition_reference(&field.name))
                        })
                        .take(64)
                        .map(|field| field.name.clone())
                        .collect();
                    if !fields.is_empty() {
                        exports.insert(path.clone(), fields);
                    }
                }
                if reward_reference(path) {
                    let fields = self.groups[*index]
                        .fields
                        .iter()
                        .flatten()
                        .take(256)
                        .map(|field| field.name.clone())
                        .collect();
                    result.reward_probe.exports.insert(path.clone(), fields);
                }
            }
            result.reward_probe.references.extend(
                self.guids
                    .values()
                    .filter(|path| {
                        path.len() <= 512 && (reward_reference(path) || acquisition_reference(path))
                    })
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .take(512)
                    .cloned(),
            );
        }
    }

    pub(crate) fn read_frames(&mut self, bytes: &[u8], result: &mut Analysis) -> WireResult<()> {
        let mut stream = Bytes::new(bytes);
        while stream.left() > 0 {
            stream.skip(4)?; // Current level index.
            let time = stream.f32()?;
            if !time.is_finite() || !(0.0..=86_400.0).contains(&time) {
                return Err(Invalid("Marca temporal de fotograma inválida."));
            }
            result.frames += 1;
            self.read_frame_exports(&mut stream)?;
            let levels = stream.packed()?;
            if levels > 4096 {
                return Err(Invalid("Demasiados niveles en un fotograma."));
            }
            for _ in 0..levels {
                stream.skip_string()?;
                if !self.streaming {
                    stream.skip_string()?;
                    stream.skip(40)?; // Quaternion, translation and scale.
                }
            }
            if self.streaming {
                stream.skip(8)?;
            }
            loop {
                let bits = stream.packed()? as usize;
                if bits == 0 {
                    break;
                }
                let actor = stream.packed()?;
                let bytes = stream.take(bits.div_ceil(8))?;
                if bits % 8 == 0 {
                    self.observer.record_name(actor, time, bytes);
                }
            }
            if self.game_data {
                let size = usize::try_from(stream.u64()?)
                    .map_err(|_| Invalid("Tamaño de datos del juego inválido."))?;
                stream.skip(size)?;
            }
            loop {
                if self.streaming {
                    stream.packed()?;
                }
                let size = stream.i32()?;
                if !(1..=2048).contains(&size) {
                    break;
                }
                let packet = stream.take(size as usize)?;
                if packet.last() == Some(&0) {
                    result.skipped_packets += 1;
                    return Err(Invalid("Paquete de red sin bit final."));
                }
                if self.packet(packet, time, result).is_err() {
                    result.skipped_packets += 1;
                }
            }
        }
        Ok(())
    }

    fn read_frame_exports(&mut self, stream: &mut Bytes<'_>) -> WireResult<()> {
        let fields = stream.packed()?;
        if fields > 65_536 {
            return Err(Invalid("Demasiadas exportaciones de campos."));
        }
        for _ in 0..fields {
            let index = stream.packed()?;
            let group = if stream.packed()? == 1 {
                let path = stream.string()?;
                let count = stream.packed()? as usize;
                Some(self.group(index, path, count)?)
            } else {
                self.indices.get(&index).copied()
            };
            if stream.u8()? != 0 {
                let handle = stream.packed()? as usize;
                stream.skip(4)?;
                let name = if stream.u8()? != 0 {
                    name_of(stream.packed()?)
                } else {
                    let name = stream.string()?;
                    stream.skip(4)?;
                    name
                };
                self.field(group, handle, name);
            }
        }
        let guids = stream.packed()?;
        if guids > 65_536 {
            return Err(Invalid("Demasiadas exportaciones de objetos."));
        }
        for _ in 0..guids {
            let size = stream.u32()? as usize;
            let data = stream.take(size)?;
            self.object(&mut Bits::new(data, data.len() * 8), true, 0)?;
        }
        Ok(())
    }

    fn group(&mut self, index: u32, path: String, count: usize) -> WireResult<usize> {
        let existing = self.names.get(&path).copied();
        let previous = existing.map_or(0, |i| self.groups[i].fields.len());
        if count > 65_536 || self.field_budget + count.saturating_sub(previous) > MAX_FIELDS {
            return Err(Invalid("Límite de campos de replicación alcanzado."));
        }
        self.field_budget += count.saturating_sub(previous);
        let group = if let Some(i) = existing {
            if count > previous {
                self.groups[i].fields.resize_with(count, || None);
            }
            i
        } else {
            let i = self.groups.len();
            if i >= MAX_GROUPS {
                return Err(Invalid("Límite de clases de replicación alcanzado."));
            }
            let tail = path_tail(&path).to_owned();
            let class = path.rsplit('.').next().unwrap_or(&path);
            let name = class.strip_suffix("_C").unwrap_or(class).to_owned();
            let kind = Kind::of(&path, &name);
            let schema_key = kind.schema_key(&name);
            let supply = is_supply_drop(&name);
            self.groups.push(Group {
                name,
                tail,
                schema_key,
                schema_started: false,
                supply,
                kind,
                fields: (0..count).map(|_| None).collect(),
            });
            self.names.insert(path, i);
            i
        };
        self.indices.insert(index, group);
        Ok(group)
    }

    fn field(&mut self, group: Option<usize>, handle: usize, name: String) {
        if let Some(slot) = group.and_then(|i| self.groups[i].fields.get_mut(handle)) {
            let observed = slot
                .as_ref()
                .is_some_and(|old| old.observed && old.name == name);
            *slot = Some(Field { name, observed });
        }
    }

    fn object(&mut self, bits: &mut Bits<'_>, exporting: bool, depth: u8) -> WireResult<u32> {
        if depth > 16 {
            return Err(Invalid(
                "Cadena de referencias de objeto demasiado profunda.",
            ));
        }
        let id = bits.packed()?;
        if id != 0 && (id == 1 || exporting) {
            let flags = bits.u8()?;
            if flags & 1 != 0 {
                self.object(bits, true, depth + 1)?;
                let path = bits.string()?;
                if flags & 4 != 0 {
                    bits.skip(32)?;
                }
                if exporting {
                    if self.guids.len() >= MAX_GUIDS && !self.guids.contains_key(&id) {
                        return Err(Invalid("Límite de objetos de red alcanzado."));
                    }
                    let tail = path_tail(&path);
                    if self.guids.get(&id).is_none_or(|current| current != tail) {
                        self.guids.insert(id, tail.to_owned());
                        self.resolved.remove(&id);
                    }
                }
            }
        }
        Ok(id)
    }

    fn exports(&mut self, bits: &mut Bits<'_>) -> WireResult<()> {
        if !bits.bit()? {
            let count = bits.u32()? as i32;
            if count <= 2048 {
                for _ in 0..count {
                    self.object(bits, true, 0)?;
                }
            }
            return Ok(());
        }
        let count = bits.u32()?;
        if count > 65_536 {
            return Err(Invalid("Demasiados campos de compatibilidad."));
        }
        for _ in 0..count {
            let index = bits.packed()?;
            let group = if bits.bit()? {
                let path = bits.string()?;
                let count = bits.u32()? as usize;
                Some(self.group(index, path, count)?)
            } else {
                self.indices.get(&index).copied()
            };
            if bits.bit()? {
                let handle = bits.packed()? as usize;
                bits.skip(32)?;
                self.field(group, handle, read_name(bits)?);
            }
        }
        Ok(())
    }

    fn group_for(&mut self, id: u32) -> Option<usize> {
        if let Some(&group) = self.resolved.get(&id) {
            return Some(group);
        }
        let path = self.guids.get(&id)?;
        // A miss stays valid for the groups already examined. Only inspect newly
        // exported groups when this object path is referenced again.
        let start = self.missing.get(path).copied().unwrap_or(0);
        let groups = &self.groups[start..];
        if groups.is_empty() {
            return None;
        }
        let trimmed = path.trim_end_matches(|c: char| c.is_ascii_digit() || c == '_');
        let found = groups
            .iter()
            .position(|group| path.contains(&group.tail))
            .or_else(|| groups.iter().position(|group| group.tail.contains(trimmed)))
            .map(|index| start + index);
        if let Some(index) = found {
            self.resolved.insert(id, index);
            if start > 0 {
                self.missing.remove(path);
            }
        } else if let Some(checked) = self.missing.get_mut(path) {
            *checked = self.groups.len();
        } else {
            self.missing.insert(path.clone(), self.groups.len());
        }
        found
    }

    fn packet(&mut self, bytes: &[u8], time: f32, result: &mut Analysis) -> WireResult<()> {
        self.packet_number += 1;
        // The final set bit terminates the packet. Padding after it is outside the bit archive.
        let count = bytes.len() * 8 - 1 - bytes[bytes.len() - 1].leading_zeros() as usize;
        let mut packet = Bits::new(bytes, count);
        while packet.left() > 0 {
            let control = packet.bit()?;
            let open = control && packet.bit()?;
            let close = control && packet.bit()?;
            if close {
                packet.serialized(15)?;
            }
            packet.bit()?; // Replication paused.
            let reliable = packet.bit()?;
            let channel = packet.packed()? as usize;
            if channel >= MAX_CHANNELS {
                return Err(Invalid("Canal de red fuera del rango."));
            }
            let exports = packet.bit()?;
            let mapped = packet.bit()?;
            let partial = packet.bit()?;
            let initial = partial && packet.bit()?;
            if partial {
                packet.bit()?;
            } // Partial custom exports final bit.
            let final_part = partial && packet.bit()?;
            if reliable || open {
                read_name(&mut packet)?;
            }
            let size = packet.serialized(16_384)? as usize;
            if size > packet.left() {
                break;
            }
            let mut payload = packet.slice(size)?;
            if exports {
                self.exports(&mut payload)?;
            }
            let sequence = if reliable {
                self.reliable_sequence + 1
            } else {
                self.packet_number
            };
            if reliable {
                self.reliable_sequence = sequence;
            }
            let bunch = Bunch {
                channel,
                open,
                close,
                reliable,
                sequence,
                exports,
                mapped,
            };
            let parsed = if partial {
                self.partial_bunch(bunch, payload, initial, final_part, time, result)
            } else {
                self.actor_bunch(bunch, payload, time, result)
            };
            if parsed.is_err() {
                result.skipped_packets += 1;
            }
        }
        Ok(())
    }

    fn partial_bunch(
        &mut self,
        bunch: Bunch,
        payload: Bits<'_>,
        initial: bool,
        final_part: bool,
        time: f32,
        result: &mut Analysis,
    ) -> WireResult<()> {
        if initial {
            if self
                .partial
                .as_ref()
                .is_some_and(|part| part.bunch.reliable)
            {
                return Ok(());
            }
            let bits = payload.left();
            let mut data = Vec::new();
            payload.append_to(&mut data)?;
            self.partial = Some(Partial {
                bunch,
                payload: data,
                bits,
            });
            return Ok(());
        }
        let Some(part) = &mut self.partial else {
            return Ok(());
        };
        let prev = part.bunch.sequence;
        if part.bunch.reliable != bunch.reliable
            || !(bunch.sequence == prev + 1 || (!bunch.reliable && bunch.sequence == prev))
        {
            return Ok(());
        }
        let bits = payload.left();
        if !bunch.exports && bits > 0 {
            if part.bits % 8 != 0 || part.bits + bits > MAX_PARTIAL_BITS {
                self.partial = None;
                return Err(Invalid("Fragmento de red inválido."));
            }
            payload.append_to(&mut part.payload)?;
            part.bits += bits;
        }
        part.bunch.sequence = bunch.sequence;
        if final_part {
            if bunch.exports {
                return Ok(());
            }
            let part = self.partial.take().unwrap();
            let complete = Bunch {
                close: bunch.close,
                mapped: bunch.mapped,
                ..part.bunch
            };
            self.actor_bunch(complete, Bits::new(&part.payload, part.bits), time, result)?;
        }
        Ok(())
    }

    fn actor_bunch(
        &mut self,
        bunch: Bunch,
        mut bits: Bits<'_>,
        time: f32,
        result: &mut Analysis,
    ) -> WireResult<()> {
        let parse = self.actor_content(bunch, &mut bits, time, result);
        if bunch.close {
            self.channels[bunch.channel] = None;
        }
        parse
    }

    fn actor_content(
        &mut self,
        bunch: Bunch,
        bits: &mut Bits<'_>,
        time: f32,
        result: &mut Analysis,
    ) -> WireResult<()> {
        if bunch.mapped {
            let count = bits.u16()?;
            for _ in 0..count {
                bits.packed()?;
            }
        }
        let actor = if let Some(actor) = self.channels[bunch.channel] {
            actor
        } else {
            if !bunch.open {
                return Ok(());
            }
            let id = match self.object(bits, false, 0) {
                Ok(id) => id,
                Err(_) => return Ok(()),
            };
            let mut actor = Actor {
                id,
                archetype: None,
                location: None,
            };
            if id > 0 && id & 1 == 0 {
                if bits.left() == 0 {
                    return Ok(());
                }
                actor.archetype = Some(self.object(bits, false, 0)?);
                self.object(bits, false, 0)?; // Level.
                actor.location = Some(spawn_vector(bits)?);
                if bits.bit()? {
                    for _ in 0..3 {
                        if bits.bit()? {
                            bits.skip(16)?;
                        }
                    }
                }
                spawn_vector(bits)?; // Scale.
                spawn_vector(bits)?; // Velocity.
            }
            self.channels[bunch.channel] = Some(actor);
            if let Some(class) = actor.archetype.and_then(|id| self.guids.get(&id)) {
                result.observe_gizmo(actor.id, time, class);
            }
            if actor
                .archetype
                .and_then(|id| self.guids.get(&id))
                .is_some_and(|path| path == "BP_ReplayPC_Athena_C")
            {
                bits.skip(8)?;
            }
            actor
        };

        while bits.left() > 0 {
            // Unreal discards malformed content blocks without dropping the containing frame.
            let Ok((layout, rep)) = self.content_header(bits, actor) else {
                break;
            };
            let Some(rep) = rep else { continue };
            let Ok(size) = bits.packed() else { break };
            let Ok(payload) = bits.slice(size as usize) else {
                break;
            };
            #[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
            if let Some(path) = self.guids.get(&rep).filter(|path| reward_reference(path)) {
                if result.build == Some(59_594_394)
                    && result.engine_network_version == Some(45)
                    && result.network_version == Some(19)
                    && matches!(
                        path.as_str(),
                        "AbilitySystemComponent" | "FortAbilitySystemComponentAthena"
                    )
                {
                    let location = crate::fast_array::Location {
                        time,
                        actor: actor.id,
                        component: rep,
                        after_properties: layout,
                    };
                    self.probe_ability_fields(
                        payload,
                        location,
                        &mut result.reward_probe.abilities,
                    );
                }
                let key = format!("{}:{path}", if layout { "properties" } else { "custom" });
                let blocks = &mut result.reward_probe.blocks;
                if blocks.len() < 512 || blocks.contains_key(&key) {
                    let entry = blocks
                        .entry(key)
                        .or_insert_with(|| crate::analysis::ProbeBlocks {
                            count: 0,
                            samples: Vec::new(),
                        });
                    entry.count += 1;
                    if entry.samples.len() < 4 {
                        entry.samples.push((time, actor.id, payload.left()));
                    }
                }
            }
            if layout && payload.left() > 0 {
                if let Some(index) = self.group_for(rep) {
                    self.properties(index, actor, payload, time, result)?;
                }
            }
        }
        Ok(())
    }

    #[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
    fn probe_ability_fields(
        &self,
        mut payload: Bits<'_>,
        location: crate::fast_array::Location,
        probe: &mut crate::fast_array::AbilityProbe,
    ) {
        const GROUP: &str = "/Script/FortniteGame.FortAbilitySystemComponentAthena";
        const CACHE: &str = "/Script/FortniteGame.FortAbilitySystemComponentAthena_ClassNetCache";
        let Some((&group, &cache)) = self.names.get(GROUP).zip(self.names.get(CACHE)) else {
            return;
        };
        let group = &self.groups[group];
        let cache = &self.groups[cache];
        if location.after_properties && skip_rep_layout(&mut payload).is_err() {
            return;
        }
        let Ok(Some(value)) = ability_field(payload, cache) else {
            return;
        };
        probe.fields += 1;
        match crate::fast_array::Delta::read(value, |handle| {
            group
                .fields
                .get(handle)?
                .as_ref()
                .map(|field| field.name.as_str())
        }) {
            Ok(delta) => probe.observe(location, delta, &self.guids),
            Err(_) => probe.rejected += 1,
        }
    }

    fn content_header(
        &mut self,
        bits: &mut Bits<'_>,
        actor: Actor,
    ) -> WireResult<(bool, Option<u32>)> {
        let layout = bits.bit()?;
        if bits.bit()? {
            return Ok((layout, Some(actor.archetype.unwrap_or(actor.id))));
        }
        let guid = self.object(bits, false, 0)?;
        if bits.bit()? {
            return Ok((layout, Some(guid)));
        }
        if bits.bit()? {
            bits.skip(8)?;
            return Ok((layout, None));
        }
        let class = self.object(bits, false, 0)?;
        if class == 0 {
            return Ok((layout, None));
        }
        if bits.left() > 0 && !bits.bit()? {
            self.object(bits, false, 0)?;
        }
        Ok((layout, Some(class)))
    }

    fn properties(
        &mut self,
        index: usize,
        actor: Actor,
        mut bits: Bits<'_>,
        time: f32,
        result: &mut Analysis,
    ) -> WireResult<()> {
        let group = &mut self.groups[index];
        if group.kind == Kind::Other {
            return Ok(());
        }
        if !group.schema_started {
            result.schema.entry(group.schema_key.clone()).or_default();
            group.schema_started = true;
        }
        if bits.bit().is_err() {
            return Ok(());
        }
        let mut update = Update::default();
        let mut finished = false;
        while bits.left() >= 8 {
            let Ok(handle) = bits.packed() else { break };
            if handle == 0 {
                finished = true;
                break;
            }
            let Ok(size) = bits.packed() else { break };
            let Ok(value) = bits.slice(size as usize) else {
                break;
            };
            if size == 0 {
                continue;
            }
            let Some(field) = group
                .fields
                .get_mut(handle as usize - 1)
                .and_then(Option::as_mut)
            else {
                continue;
            };
            if !field.observed {
                result
                    .schema
                    .entry(group.schema_key.clone())
                    .or_default()
                    .insert(field.name.clone());
                field.observed = true;
            }
            if update
                .read(
                    group.kind,
                    &field.name,
                    value,
                    self.cannon_layout,
                    group.supply,
                )
                .is_err()
            {
                break;
            }
        }
        if finished {
            self.observer.update(
                Observation {
                    time,
                    actor: actor.id,
                    kind: group.kind,
                    name: &group.name,
                    position: actor.location,
                    guids: &self.guids,
                },
                update,
            )?;
        }
        Ok(())
    }
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
fn skip_rep_layout(payload: &mut Bits<'_>) -> WireResult<()> {
    payload.bit()?;
    for _ in 0..128 {
        if payload.packed()? == 0 {
            return Ok(());
        }
        let size = payload.packed()? as usize;
        payload.skip(size)?;
    }
    Err(Invalid("Límite de propiedades en el diagnóstico."))
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
fn ability_field<'a>(mut payload: Bits<'a>, cache: &Group) -> WireResult<Option<Bits<'a>>> {
    let mut ability = None;
    for _ in 0..64 {
        if payload.left() == 0 {
            return Ok(ability);
        }
        let handle = payload.serialized(cache.fields.len().max(2) as u32)? as usize;
        let Some(field) = cache.fields.get(handle).and_then(Option::as_ref) else {
            break;
        };
        let size = payload.packed()? as usize;
        let value = payload.slice(size)?;
        if field.name == "ActivatableAbilities" && ability.replace(value).is_some() {
            break;
        }
    }
    Err(Invalid("Encuadre de ClassNetCache no reconocido."))
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
fn acquisition_reference(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        "prize",
        "gizmo",
        "pirateshop",
        "pirateaccount",
        "treasurehunt",
        "reward",
        "client_replicatecontext",
    ]
        .iter()
        .any(|fragment| lower.contains(fragment))
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
fn reward_reference(path: &str) -> bool {
    [
        "AbilitySystemComponent",
        "TreasureHandler",
        "DelilahTreasureHunt",
        "GA_Prizes_EventListener",
        "PrizeEarnedData",
    ]
    .iter()
    .any(|fragment| path.contains(fragment))
}

fn read_name(bits: &mut Bits<'_>) -> WireResult<String> {
    if bits.bit()? {
        Ok(name_of(bits.packed()?))
    } else {
        let name = bits.string()?;
        bits.skip(32)?;
        Ok(name)
    }
}

fn spawn_vector(bits: &mut Bits<'_>) -> WireResult<Position> {
    if !bits.bit()? {
        return Ok(Position::new(0.0, 0.0, 0.0));
    }
    if bits.bit()? {
        bits.quantized_vector(10.0)
    } else {
        bits.vector(true)
    }
}

#[cfg(test)]
mod tests {
    use super::Network;

    #[test]
    fn retries_an_object_after_its_group_is_exported() {
        let mut network = Network::new(0, false);
        network.guids.insert(3, "Example_C".to_owned());
        assert_eq!(network.group_for(3), None);
        let group = network
            .group(1, "/Game/Example.Example_C".to_owned(), 1)
            .unwrap();
        assert_eq!(network.group_for(3), Some(group));
    }
}
