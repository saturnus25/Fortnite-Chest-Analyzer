use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::wire::{Bits, Invalid, WireResult};

const MAX_ITEMS: usize = 512;
const MAX_STREAMS: usize = 512;
const MAX_REFERENCES: usize = 8192;
const MAX_FIELDS_PER_ITEM: usize = 32;
const MAX_SAMPLES_PER_KIND: usize = 8;
const MAX_REWARD_TRACES: usize = 128;
const INVALID: Invalid = Invalid("Delta de ActivatableAbilities no reconocido.");

#[derive(Clone, Copy, Default, PartialEq)]
struct Spec {
    ability: Option<u32>,
    source: Option<u32>,
    handle: Option<u64>,
    level: Option<u32>,
    input_id: Option<u32>,
}

impl Spec {
    fn merge(self, patch: Self) -> Self {
        Self {
            ability: patch.ability.or(self.ability),
            source: patch.source.or(self.source),
            handle: patch.handle.or(self.handle),
            level: patch.level.or(self.level),
            input_id: patch.input_id.or(self.input_id),
        }
    }
}

pub(crate) struct Delta {
    key: i32,
    base: i32,
    deleted: Vec<u32>,
    changed: Vec<(u32, Spec)>,
}

impl Delta {
    // This branch was verified against build 59594394, engine network version 45.
    // Property handles are one-based in the compatibility stream.
    pub(crate) fn read<'a>(
        mut bits: Bits<'_>,
        field_name: impl Fn(usize) -> Option<&'a str>,
    ) -> WireResult<Self> {
        if !bits.bit()? {
            return Err(INVALID);
        }
        let key = bits.u32()? as i32;
        let base = bits.u32()? as i32;
        let deletes = bits.u32()? as usize;
        let changes = bits.u32()? as usize;
        if key <= 0
            || base < 0
            || base >= key
            || deletes > MAX_ITEMS
            || changes > MAX_ITEMS
            || deletes * 32 + changes * 40 > bits.left()
        {
            return Err(INVALID);
        }
        let mut ids = HashSet::with_capacity(deletes + changes);
        let mut read_id = |bits: &mut Bits<'_>| -> WireResult<u32> {
            let id = bits.u32()?;
            if id == 0 || id > i32::MAX as u32 || !ids.insert(id) {
                return Err(INVALID);
            }
            Ok(id)
        };
        let mut deleted = Vec::with_capacity(deletes);
        for _ in 0..deletes {
            deleted.push(read_id(&mut bits)?);
        }
        let mut changed = Vec::with_capacity(changes);
        for _ in 0..changes {
            let id = read_id(&mut bits)?;
            changed.push((id, read_spec(&mut bits, &field_name)?));
        }
        if bits.left() != 0 {
            return Err(INVALID);
        }
        Ok(Self {
            key,
            base,
            deleted,
            changed,
        })
    }
}

fn read_spec<'a>(
    bits: &mut Bits<'_>,
    field_name: impl Fn(usize) -> Option<&'a str>,
) -> WireResult<Spec> {
    let mut spec = Spec::default();
    let mut previous = 0;
    for _ in 0..MAX_FIELDS_PER_ITEM {
        let handle = bits.packed()?;
        if handle == 0 {
            return Ok(spec);
        }
        if handle <= previous {
            return Err(INVALID);
        }
        previous = handle;
        let size = bits.packed()? as usize;
        let mut value = bits.slice(size)?;
        match (field_name(handle as usize - 1), size) {
            (Some("ability" | "Ability"), 8 | 16 | 24 | 32 | 40) => {
                spec.ability = Some(value.packed()?);
            }
            (Some("SourceObject"), 8 | 16 | 24 | 32 | 40) => {
                spec.source = Some(value.packed()?);
            }
            (Some("HandleValue"), 64) => spec.handle = Some(value.read(64)?),
            (Some("Level"), 32) => spec.level = Some(value.u32()?),
            (Some("InputID"), 32) => spec.input_id = Some(value.u32()?),
            (Some("GeneratedByServerId" | "Handle"), 32)
            | (Some("bIsValid"), 1)
            | (
                Some("DynamicAbilityTags" | "DynamicAbilityTriggers" | "ReplicatedInstances"),
                1..,
            ) => {
                continue;
            }
            _ => return Err(INVALID),
        }
        if value.left() != 0 {
            return Err(INVALID);
        }
    }
    Err(INVALID)
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Location {
    pub time: f32,
    pub actor: u32,
    pub component: u32,
    pub after_properties: bool,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct Observation {
    #[serde(flatten)]
    location: Location,
    array_key: i32,
    base_key: i32,
    replication_id: u32,
    kind: &'static str,
    ability_guid: Option<u32>,
    source_guid: Option<u32>,
}

impl Observation {
    fn references(self) -> impl Iterator<Item = (&'static str, u32)> {
        [
            ("ability", self.ability_guid),
            ("SourceObject", self.source_guid),
        ]
        .into_iter()
        .filter_map(|(property, guid)| guid.filter(|&id| id > 1).map(|id| (property, id)))
    }
}

#[derive(Serialize)]
struct RewardReference {
    property: &'static str,
    path: String,
    #[serde(flatten)]
    observation: Observation,
}

#[derive(Default)]
struct Stream {
    key: i32,
    items: HashMap<u32, Spec>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AbilityProbe {
    pub fields: u32,
    pub rejected: u32,
    pub dedicated_deltas: u32,
    pub suffix_deltas: u32,
    unanchored: u32,
    repeated_keys: u32,
    out_of_order_keys: u32,
    rebases: u32,
    limits_reached: u32,
    snapshots: u32,
    initial_entries: u32,
    newly_observed_entries: u32,
    existing_entries_written: u32,
    known_values_changed: u32,
    explicit_removals: u32,
    observed_entries_removed: u32,
    resolved_ability_references: usize,
    resolved_source_references: usize,
    samples: Vec<Observation>,
    reward_references: Vec<RewardReference>,
    #[serde(skip)]
    streams: HashMap<(u32, u32), Stream>,
    #[serde(skip)]
    references: HashMap<(&'static str, u32), Observation>,
}

impl AbilityProbe {
    pub(crate) fn is_empty(&self) -> bool {
        self.fields == 0
    }

    pub(crate) fn observe(
        &mut self,
        location: Location,
        delta: Delta,
        guids: &HashMap<u32, String>,
    ) {
        let stream_id = (location.actor, location.component);
        if !self.streams.contains_key(&stream_id) {
            // A name shared by subclasses is not enough to assign delete-only
            // or empty deltas. Require a real spec from this component first.
            if !delta
                .changed
                .iter()
                .any(|(_, spec)| spec.ability.is_some_and(|guid| guid > 1) && spec.handle.is_some())
            {
                self.unanchored += 1;
                return;
            }
            if self.streams.len() >= MAX_STREAMS {
                self.limits_reached += 1;
                return;
            }
        }
        let stream = self.streams.entry(stream_id).or_default();
        if stream.key == delta.key {
            self.repeated_keys += 1;
            return;
        }
        if stream.key > delta.key {
            self.out_of_order_keys += 1;
            return;
        }
        // A fresh snapshot or a base we did not observe gives us a new
        // observation window. Never turn that baseline into in-match adds.
        let baseline = stream.key == 0 || delta.base == 0 || delta.base > stream.key;
        if baseline {
            self.snapshots += u32::from(delta.base == 0);
            self.rebases += u32::from(delta.base != 0);
            stream.items.clear();
        }
        stream.key = delta.key;
        if location.after_properties {
            self.suffix_deltas += 1;
        } else {
            self.dedicated_deltas += 1;
        }
        let observation = |replication_id, kind, spec: Spec| Observation {
            location,
            array_key: delta.key,
            base_key: delta.base,
            replication_id,
            kind,
            ability_guid: spec.ability.filter(|&id| id > 1),
            source_guid: spec.source,
        };
        for id in delta.deleted {
            self.explicit_removals += 1;
            let removed = stream.items.remove(&id);
            self.observed_entries_removed += u32::from(removed.is_some());
            let observed = observation(id, "explicit-removal", removed.unwrap_or_default());
            sample(&mut self.samples, observed);
            trace_reward_references(&mut self.reward_references, guids, observed);
        }
        for (id, patch) in delta.changed {
            if stream.items.len() >= MAX_ITEMS && !stream.items.contains_key(&id) {
                self.limits_reached += 1;
                continue;
            }
            let previous = stream.items.get(&id).copied();
            let state = previous.unwrap_or_default().merge(patch);
            let kind = if let Some(previous) = previous {
                self.existing_entries_written += 1;
                self.known_values_changed += u32::from(previous != state);
                "existing-entry"
            } else if baseline {
                self.initial_entries += 1;
                "baseline-entry"
            } else {
                self.newly_observed_entries += 1;
                "newly-observed-entry"
            };
            stream.items.insert(id, state);
            let observed = observation(id, kind, state);
            sample(&mut self.samples, observed);
            if previous != Some(state) {
                trace_reward_references(&mut self.reward_references, guids, observed);
            }
            for (property, guid) in observed.references() {
                if self.references.len() < MAX_REFERENCES {
                    self.references.entry((property, guid)).or_insert(observed);
                } else if !self.references.contains_key(&(property, guid)) {
                    self.limits_reached += 1;
                }
            }
        }
    }

    pub(crate) fn finish(&mut self, guids: &HashMap<u32, String>) {
        let mut late = Vec::new();
        for (&(property, guid), &observation) in &self.references {
            let Some(path) = guids.get(&guid) else {
                continue;
            };
            if property == "ability" {
                self.resolved_ability_references += 1;
            } else {
                self.resolved_source_references += 1;
            }
            if is_reward_related(path)
                && !self.reward_references.iter().any(|trace| {
                    trace.property == property
                        && trace.observation.location.actor == observation.location.actor
                        && trace.observation.location.component == observation.location.component
                        && trace.observation.replication_id == observation.replication_id
                        && trace.observation.array_key == observation.array_key
                })
            {
                late.push(RewardReference {
                    property,
                    path: path.clone(),
                    observation,
                });
            }
        }
        self.reward_references.append(&mut late);
        self.reward_references.sort_by(|a, b| {
            a.observation
                .location
                .time
                .total_cmp(&b.observation.location.time)
                .then_with(|| a.property.cmp(b.property))
                .then_with(|| a.path.cmp(&b.path))
                .then_with(|| {
                    a.observation
                        .location
                        .actor
                        .cmp(&b.observation.location.actor)
                })
                .then_with(|| {
                    a.observation
                        .location
                        .component
                        .cmp(&b.observation.location.component)
                })
                .then_with(|| a.observation.array_key.cmp(&b.observation.array_key))
                .then_with(|| {
                    a.observation
                        .replication_id
                        .cmp(&b.observation.replication_id)
                })
        });
        self.reward_references.truncate(MAX_REWARD_TRACES);
    }
}

fn sample(samples: &mut Vec<Observation>, observation: Observation) {
    if samples
        .iter()
        .filter(|entry| entry.kind == observation.kind)
        .count()
        < MAX_SAMPLES_PER_KIND
    {
        samples.push(observation);
    }
}

fn trace_reward_references(
    traces: &mut Vec<RewardReference>,
    guids: &HashMap<u32, String>,
    observation: Observation,
) {
    for (property, guid) in observation.references() {
        if traces.len() >= MAX_REWARD_TRACES {
            break;
        }
        if let Some(path) = guids.get(&guid).filter(|path| is_reward_related(path)) {
            traces.push(RewardReference {
                property,
                path: path.clone(),
                observation,
            });
        }
    }
}

fn is_reward_related(path: &str) -> bool {
    if path.len() > 240 {
        return false;
    }
    let lower = path.to_ascii_lowercase();
    [
        "delilahprize:",
        "delilahtreasurehuntanimatedchest",
        "treasurehandler",
        "prizes_eventlistener",
        "relicextractor",
        "luckylocator",
        "smugglerextractionkey",
        "pirateaccount",
        "pirateshop",
        "dpid_item",
    ]
    .iter()
    .any(|fragment| lower.contains(fragment))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fixture {
        bytes: Vec<u8>,
        len: usize,
    }

    impl Fixture {
        fn put(&mut self, value: u64, width: usize) {
            for index in 0..width {
                if self.len.is_multiple_of(8) {
                    self.bytes.push(0);
                }
                self.bytes[self.len / 8] |= (((value >> index) & 1) as u8) << (self.len % 8);
                self.len += 1;
            }
        }

        fn read(&self, len: usize) -> WireResult<Delta> {
            Delta::read(Bits::new(&self.bytes, len), |index| {
                ["HandleValue", "ability", "SourceObject", "Level"]
                    .get(index)
                    .copied()
            })
        }
    }

    fn header(deletes: u64, changes: u64) -> Fixture {
        let mut bits = Fixture::default();
        bits.put(1, 1);
        for value in [5, 3, deletes, changes] {
            bits.put(value, 32);
        }
        bits
    }

    #[test]
    fn decodes_a_delta_with_compatibility_handles_and_netguids() {
        let mut bits = header(1, 1);
        bits.put(9, 32); // Explicit removal.
        bits.put(4, 32); // Changed replication ID.
        bits.put(1 << 1, 8);
        bits.put(64 << 1, 8);
        bits.put(1u64 << 40, 64); // Ability handle, distinct from replication ID.
        bits.put(2 << 1, 8);
        bits.put(16 << 1, 8);
        bits.put(0x0203, 16); // Two packed bytes encode NetGUID 129.
        bits.put(3 << 1, 8);
        bits.put(8 << 1, 8);
        bits.put(0, 8); // Explicit null SourceObject.
        bits.put(0, 8); // End of the item's property list.
        let delta = bits.read(bits.len).unwrap();
        assert_eq!((delta.key, delta.base), (5, 3));
        assert_eq!(delta.deleted, [9]);
        assert_eq!(delta.changed.len(), 1);
        let (id, spec) = delta.changed[0];
        assert_eq!(id, 4);
        assert_eq!(spec.ability, Some(129));
        assert_eq!(spec.source, Some(0));
        assert_eq!(spec.handle, Some(1u64 << 40));
        assert!(bits.read(bits.len - 1).is_err());
        bits.put(0, 1);
        assert!(bits.read(bits.len).is_err());
    }

    #[test]
    fn rejects_oversized_counts_duplicate_ids_and_unmapped_fields() {
        let bits = header(513, 0);
        assert!(bits.read(bits.len).is_err());

        let mut bits = header(1, 1);
        bits.put(4, 32);
        bits.put(4, 32);
        bits.put(0, 8);
        assert!(bits.read(bits.len).is_err());

        let mut bits = header(0, 1);
        bits.put(4, 32);
        bits.put(5 << 1, 8); // No such exported field.
        bits.put(1 << 1, 8);
        bits.put(1, 1);
        bits.put(0, 8);
        assert!(bits.read(bits.len).is_err());
    }

    #[test]
    fn keeps_observation_baselines_partial_updates_and_duplicate_keys_separate() {
        let mut probe = AbilityProbe::default();
        let guids = HashMap::from([(11, "GA_TreasureHandler_Generic_C".into())]);
        let location = Location {
            time: 1.0,
            actor: 7,
            component: 8,
            after_properties: false,
        };
        let initial = Spec {
            ability: Some(11),
            handle: Some(20),
            ..Spec::default()
        };
        let snapshot = || Delta {
            key: 5,
            base: 0,
            deleted: vec![],
            changed: vec![(1, initial)],
        };
        probe.observe(location, snapshot(), &guids);
        probe.observe(location, snapshot(), &guids);
        probe.observe(
            location,
            Delta {
                key: 6,
                base: 5,
                deleted: vec![],
                changed: vec![
                    (
                        1,
                        Spec {
                            level: Some(2),
                            ..Spec::default()
                        },
                    ),
                    (2, initial),
                ],
            },
            &guids,
        );
        let stream = &probe.streams[&(7, 8)];
        assert_eq!(stream.items[&1].ability, Some(11));
        assert_eq!(stream.items[&1].level, Some(2));
        probe.observe(location, snapshot(), &guids); // Stale delta.
        probe.observe(
            location,
            Delta {
                key: 7,
                base: 6,
                deleted: vec![1],
                changed: vec![],
            },
            &guids,
        );
        let second_actor = Location {
            actor: 9,
            ..location
        };
        probe.observe(second_actor, snapshot(), &guids);
        probe.observe(
            location,
            Delta {
                key: 10,
                base: 9,
                deleted: vec![],
                changed: vec![(3, initial)],
            },
            &guids,
        );
        assert_eq!(probe.repeated_keys, 1);
        assert_eq!(probe.out_of_order_keys, 1);
        assert_eq!(probe.initial_entries, 3);
        assert_eq!(probe.newly_observed_entries, 1);
        assert_eq!(probe.known_values_changed, 1);
        assert_eq!(probe.observed_entries_removed, 1);
        assert_eq!(probe.rebases, 1);
        assert_eq!(probe.streams[&(7, 8)].items.len(), 1);
        assert!(probe.streams[&(9, 8)].items.contains_key(&1));
        probe.finish(&guids);
        assert_eq!(probe.resolved_ability_references, 1);
        assert_eq!(probe.reward_references.len(), 6);
    }
}
