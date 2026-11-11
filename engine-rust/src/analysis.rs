use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::wire::{Bits, Invalid, WireResult, hex};

#[derive(Clone, Copy, Debug, Serialize)]
pub(crate) struct Position {
    x: f64,
    y: f64,
    z: f64,
}

impl Position {
    pub(crate) fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    pub(crate) fn finite(self) -> Option<Self> {
        ([self.x, self.y, self.z]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1.0e9))
        .then_some(self)
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    #[serde(skip_serializing_if = "is_false")]
    pub legacy_required: bool,
    pub status: &'static str,
    pub detail: Option<&'static str>,
    pub branch: Option<String>,
    pub build: Option<u32>,
    pub file_version: Option<u32>,
    pub network_version: Option<u32>,
    pub engine_network_version: Option<u32>,
    pub guid: Option<String>,
    pub duration_ms: Option<u32>,
    pub recorded_at: Option<String>,
    pub encrypted: Option<bool>,
    pub compressed: Option<bool>,
    pub frames: u32,
    pub skipped_packets: u32,
    pub chest_actors_observed: usize,
    pub recorder_name: Option<String>,
    pub squad_evidence: Option<&'static str>,
    pub recorder_team: Option<u16>,
    squad: Vec<SquadMember>,
    chests: Vec<Opening>,
    items: Vec<Loot>,
    supply_drops: Vec<SupplyDrop>,
    containers: BTreeMap<String, ContainerCounts>,
    treasures: Vec<TreasureAward>,
    #[serde(serialize_with = "serialize_gizmos")]
    gizmos: BTreeMap<u32, GizmoObservation>,
    pub schema: BTreeMap<String, BTreeSet<String>>,
    pub events: BTreeSet<String>,
    #[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
    #[serde(skip_serializing_if = "RewardProbe::is_empty")]
    pub(crate) reward_probe: RewardProbe,
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewardProbe {
    pub network_chunks: u32,
    pub exports: BTreeMap<String, Vec<String>>,
    pub acquisition_exports: BTreeMap<String, Vec<String>>,
    pub event_payload_sizes: BTreeMap<String, BTreeSet<u32>>,
    pub references: BTreeSet<String>,
    pub blocks: BTreeMap<String, ProbeBlocks>,
    #[serde(skip_serializing_if = "crate::fast_array::AbilityProbe::is_empty")]
    pub abilities: crate::fast_array::AbilityProbe,
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
impl RewardProbe {
    fn is_empty(&self) -> bool {
        self.network_chunks == 0
            && self.exports.is_empty()
            && self.acquisition_exports.is_empty()
            && self.event_payload_sizes.is_empty()
            && self.references.is_empty()
            && self.blocks.is_empty()
    }
}

#[cfg(all(feature = "reward-probe", not(target_arch = "wasm32")))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProbeBlocks {
    pub count: u32,
    pub samples: Vec<(f32, u32, usize)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opening {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    time: f32,
    position: Option<Position>,
    player_id: Option<u32>,
    player: Option<String>,
    recorder: bool,
    attribution: &'static str,
    evidence: &'static str,
    action: &'static str,
    team_role: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SquadMember {
    player_id: u32,
    alias: Option<String>,
    recorder: bool,
    account_key: Option<String>,
    display_names: Vec<DisplayName>,
    evidence: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreasureAward {
    actor: u32,
    observed_at: f32,
    template_id: Option<String>,
    source_actor: Option<u32>,
    source_type: Option<String>,
    player_id: Option<u32>,
    player: Option<String>,
    from_destruction: Option<bool>,
}

#[derive(Default)]
struct TreasureState {
    success_at: Option<f32>,
    template_id: Option<String>,
    source: Option<u32>,
    pawn: Option<u32>,
    from_destruction: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupplyDrop {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    observed_at: f32,
    opened: bool,
    opened_at: Option<f32>,
    position: Option<Position>,
    spawned_pickups: Option<bool>,
}

impl Analysis {
    pub(crate) fn observe_gizmo(&mut self, actor: u32, time: f32, class: &str) {
        let (item_id, kind) = match class {
            "B_RelicExtractor_C" => ("WID_RelicExtractor", "extractor"),
            "B_LuckyLocator_C" => ("WID_LuckyLocator", "lucky-locator"),
            "B_SmugglerExtractionKey_C" => ("WID_SmugglerExtractionKey_Gizmo", "smuggler-key"),
            "B_RelicFinder_C" => ("WID_RelicFinder", "sprite-locator"),
            "B_FlameCeleb_BaseWeapon_C" => ("WID_FlameCeleb_Consumable_S43", "golden-firework"),
            "B_ExtractionSiteBooster_C" => ("WID_ExtractionSiteBooster", "site-booster"),
            "B_JunkFoodBucket_Gizmo_C" => ("WID_JunkFoodBucket_Gizmo", "snack-lantern"),
            "B_LlamaSupplyDropRadioGizmo_Weapon_C" => ("WID_LLamaSupplyDropRadioGizmo", "llama-drop"),
            "B_SpicyTaco_Gizmo_C" => ("WID_SpicyTaco_Gizmo", "spicy-taco"),
            _ => return,
        };
        self.gizmos
            .entry(actor)
            .or_insert_with(|| GizmoObservation {
                actor,
                observed_at: time,
                class: class.to_owned(),
                item_id,
                kind,
            });
    }
}

fn serialize_gizmos<S>(
    gizmos: &BTreeMap<u32, GizmoObservation>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.collect_seq(gizmos.values())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GizmoObservation {
    actor: u32,
    observed_at: f32,
    class: String,
    item_id: &'static str,
    kind: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayName {
    name: String,
    observed_at: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Loot {
    actor: u32,
    item_id: String,
    observed_at: f32,
    position: Option<Position>,
    stack: Option<i32>,
    picked_up: Option<bool>,
    from_container: Option<bool>,
    chest_id: Option<String>,
    source_evidence: Option<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Other,
    Chest,
    Cannon,
    Treasure,
    Pickup,
    Pawn,
    PlayerState,
    GameState,
    Controller,
}

impl Kind {
    pub(crate) fn of(path: &str, name: &str) -> Self {
        if path.contains(':') || path.ends_with("ClassNetCache") {
            return Self::Other;
        }
        if matches!(
            name,
            "BGA_DelilahTreasureHuntAnimatedChest"
                | "BGA_DelilahTreasureHuntAnimatedChest_Rare"
                | "BGA_DelilahTreasureHuntAnimatedChest_Sprite"
        ) {
            return Self::Treasure;
        }
        let lower = name.to_ascii_lowercase();
        if lower.contains("lootcannon") || lower.contains("confetti") {
            return Self::Cannon;
        }
        if known_container(name)
            || lower.contains("chest")
            || [
                "Tiered_Ammo",
                "Tiered_Short_Ammo",
                "AmmoBox",
                "LootContainer",
                "SupplyDrop",
            ]
            .iter()
            .any(|s| name.contains(s))
            || path.contains("/Containers/")
        {
            return Self::Chest;
        }
        if name.starts_with("FortPickupAthena") && !name.contains("Component") {
            return Self::Pickup;
        }
        if name.contains("PlayerPawn") {
            return Self::Pawn;
        }
        if name.contains("PlayerState") && !name.contains("Component") {
            return Self::PlayerState;
        }
        if name.contains("ReplayPC") {
            return Self::Controller;
        }
        if name.contains("GameState") && !name.contains("Component") {
            return Self::GameState;
        }
        Self::Other
    }

    pub(crate) fn schema_key(self, name: &str) -> String {
        let label = match self {
            Self::Other => return String::new(),
            Self::Chest => "Chest",
            Self::Cannon => "Cannon",
            Self::Treasure => "Treasure",
            Self::Pickup => "Pickup",
            Self::PlayerState => "PlayerState",
            Self::Pawn => return "Pawn".to_owned(),
            Self::GameState => return "GameState".to_owned(),
            Self::Controller => return "Controller".to_owned(),
        };
        format!("{label}/{name}")
    }
}

#[derive(Default)]
pub(crate) struct Update {
    searcher: Option<u32>,
    prize: Option<TreasureState>,
    prize_success: bool,
    state: Option<u32>,
    item: Option<u32>,
    owner: Option<u32>,
    fired: Option<bool>,
    searched: Option<bool>,
    destroyed: Option<bool>,
    tossed: Option<bool>,
    picked: Option<bool>,
    animation: Option<i32>,
    count: Option<i32>,
    player: Player,
    location: Option<Position>,
    cannon_loot: Option<Vec<u32>>,
    supply_open: Option<bool>,
    spawned_pickups: Option<bool>,
}

pub(crate) fn is_supply_drop(name: &str) -> bool {
    name.starts_with("AthenaSupplyDrop")
        && !["Balloon", "Llama", "Spawner"]
            .iter()
            .any(|other| name.contains(other))
}

// Exact gameplay blueprints seen in the replay corpus or verified in 43.00 assets.
fn known_container(name: &str) -> bool {
    matches!(
        name,
        "Tiered_Chest_Athena"
            | "AlwaysSpawn_NormalChest"
            | "AlwaysSpawn_RareChest"
            | "Tiered_Chest_5_Child"
            | "B_TieredChest_Relics"
            | "B_Delilah_TieredChest_Relics_Variant1"
            | "B_Delilah_TieredChest_Relics_Variant2"
            | "B_Delilah_TieredChest_Relics_Variant3"
            | "B_Athena_BuriedChest_Chest"
            | "B_Athena_BuriedChest_RelicFinder"
            | "B_SpritePosters_Booty_Chest"
            | "B_SpritePosters_Booty_Chest_Variant1"
            | "Tiered_Ammo_Athena"
            | "Tiered_Short_Ammo_3_Parent"
            | "FoodBox_Produce_Athena"
            | "Barrel_FishingRod_Container_Athena"
            | "Athena_Prop_Recreation_Cooler"
            | "Athena_Prop_Recreation_Cooler_RandomColor"
            | "Athena_Prop_Utility_ToolBox_02"
            | "Athena_Prop_Commerce_CashRegister"
    )
}

fn object_size(size: usize) -> bool {
    (8..=40).contains(&size) && size % 8 == 0
}

impl Update {
    pub(crate) fn read(
        &mut self,
        kind: Kind,
        field: &str,
        mut bits: Bits<'_>,
        cannon_layout: bool,
        supply: bool,
    ) -> WireResult<()> {
        let size = bits.left();
        match (kind, field) {
            (Kind::Treasure, "bSuccess") if size == 1 => self.prize_success = bits.bit()?,
            (Kind::Treasure, "PrizeTemplateId") => {
                self.prize
                    .get_or_insert_with(TreasureState::default)
                    .template_id = read_prize_id(bits);
            }
            (Kind::Treasure, "OpeningPawn" | "SourceContainer") if object_size(size) => {
                let reference = bits.packed()?;
                if bits.left() == 0 && reference > 0 {
                    let prize = self.prize.get_or_insert_with(TreasureState::default);
                    if field == "OpeningPawn" {
                        prize.pawn = Some(reference);
                    } else {
                        prize.source = Some(reference);
                    }
                }
            }
            (Kind::Treasure, "bFromDestruction") if size == 1 => {
                self.prize
                    .get_or_insert_with(TreasureState::default)
                    .from_destruction = Some(bits.bit()?);
            }
            (Kind::Chest, "Opened") if supply && size == 1 => self.supply_open = Some(bits.bit()?),
            (Kind::Chest, "bHasSpawnedPickups") if supply && size == 1 => {
                self.spawned_pickups = Some(bits.bit()?)
            }
            (Kind::Chest, "LandingLocation") if supply && matches!(size, 96 | 192) => {
                self.location = bits.vector(size == 192).ok()
            }
            (Kind::Chest, "bAlreadySearched") if size == 1 => self.searched = Some(bits.bit()?),
            (Kind::Chest, "bDestroyed") if size == 1 => self.destroyed = Some(bits.bit()?),
            (Kind::Chest | Kind::Cannon, "SearchingPawn") if object_size(size) => {
                self.searcher = Some(bits.packed()?)
            }
            (Kind::Cannon, "SingleUseLootCannonFired") if size == 1 => {
                self.fired = Some(bits.bit()?)
            }
            (Kind::Chest, "ChestCurrentLoc") => self.location = Some(bits.quantized_vector(1.0)?),
            (Kind::Cannon, "SpawnedPickupLoot") if size <= 4096 && cannon_layout => {
                self.cannon_loot = read_cannon_loot(bits).ok()
            }
            (Kind::Chest, "SearchAnimationCount") if size <= 32 => {
                self.animation = Some(bits.read(size)? as i32)
            }
            (Kind::Pawn | Kind::Controller, "PlayerState")
            | (Kind::GameState, "RecorderPlayerState")
                if object_size(size) =>
            {
                self.state = Some(bits.packed()?).filter(|id| *id > 0)
            }
            (Kind::PlayerState, "TeamIndex") if size <= 16 => {
                self.player.team = Some(bits.read(size)? as u16).filter(|id| *id > 0)
            }
            (Kind::PlayerState, "SquadId") if size == 8 => self.player.squad = Some(bits.u8()?),
            (Kind::PlayerState, "PlayerTeamPrivate") if object_size(size) => {
                self.player.team_actor = Some(bits.packed()?).filter(|id| *id > 1)
            }
            (Kind::PlayerState, "bOnlySpectator") if size == 1 => {
                self.player.spectator = Some(bits.bit()?)
            }
            (Kind::PlayerState, "UniqueID" | "UniqueId") if (16..=512).contains(&size) => {
                self.player.account = read_account(bits).ok()
            }
            (Kind::PlayerState, "PlayerNamePrivate") if (40..=2080).contains(&size) => {
                self.player.alias = read_alias(bits)
            }
            (Kind::Pickup, "ItemDefinition") if object_size(size) => {
                self.item = Some(bits.packed()?)
            }
            (Kind::Pickup, "Owner") if object_size(size) => self.owner = Some(bits.packed()?),
            (Kind::Pickup, "Count") if size == 32 => self.count = Some(bits.u32()? as i32),
            (Kind::Pickup, "bTossedFromContainer") if size == 1 => self.tossed = Some(bits.bit()?),
            (Kind::Pickup, "bPickedUp") if size == 1 => self.picked = Some(bits.bit()?),
            (Kind::Pickup, "LootInitialPosition") => {
                self.location = Some(bits.quantized_vector(10.0)?)
            }
            _ => {}
        }
        Ok(())
    }
}

// In the 43.00 netfield, the replicated template string is length-delimited
// inside a nested property. Check the observed envelope before accepting it.
fn read_prize_id(mut bits: Bits<'_>) -> Option<String> {
    if bits.left() > 1024
        || bits.packed().ok()? != 1
        || bits.packed().ok()? != 1
        || bits.packed().ok()? != 50
    {
        return None;
    }
    let length = bits.packed().ok()? as usize;
    let mut payload = bits.slice(length).ok()?;
    let id = payload.string().ok()?;
    let suffix = id.strip_prefix("DelilahPrize:")?;
    if payload.left() != 0
        || bits.left() != 16
        || bits.u16().ok()? != 0
        || suffix.is_empty()
        || !suffix
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return None;
    }
    Some(id)
}

fn read_alias(mut bits: Bits<'_>) -> Option<String> {
    let name = bits.string().ok()?;
    (bits.left() == 0
        && !name.trim().is_empty()
        && name.encode_utf16().count() <= 96
        && !name.chars().any(|c| c.is_control() || c == '\u{FFFD}'))
    .then_some(name)
}

fn read_account(mut bits: Bits<'_>) -> WireResult<String> {
    let flags = bits.u8()?;
    let subsystem = flags >> 3;
    if subsystem == 0 || flags & 3 == 3 || (subsystem == 31 && bits.string()? == "None") {
        return Err(Invalid("Cuenta sin identificador."));
    }
    let id = if flags & 1 != 0 {
        if bits.u8()? != 16 {
            return Err(Invalid("Longitud de identificador de cuenta inválida."));
        }
        let mut raw = [0; 16];
        for b in &mut raw {
            *b = bits.u8()?;
        }
        hex(&raw, true)
    } else {
        bits.string()?
    };
    if bits.left() != 0
        || id.len() != 32
        || !id.bytes().all(|b| b.is_ascii_hexdigit())
        || id.bytes().all(|b| b == b'0')
    {
        return Err(Invalid("Identificador de cuenta inválido."));
    }
    Ok(id)
}

fn read_cannon_loot(mut bits: Bits<'_>) -> WireResult<Vec<u32>> {
    let length = bits.packed()?;
    if length > 128 {
        return Err(Invalid("Lista de recompensas inválida."));
    }
    let mut actors = Vec::new();
    loop {
        let index = bits.packed()?;
        if index == 0 && bits.left() == 0 {
            return Ok(actors);
        }
        if index == 0 || index > length {
            return Err(Invalid("Índice de recompensa inválido."));
        }
        loop {
            let handle = bits.packed()?;
            if handle == 0 {
                break;
            }
            let size = bits.packed()? as usize;
            let mut value = bits.slice(size)?;
            if handle == 46 && object_size(size) {
                let actor = value.packed()?;
                if value.left() != 0 {
                    return Err(Invalid("Referencia de recompensa inválida."));
                }
                if actor > 0 {
                    actors.push(actor);
                }
            }
        }
    }
}

#[derive(Default)]
struct Player {
    alias: Option<String>,
    account: Option<String>,
    team: Option<u16>,
    squad: Option<u8>,
    team_actor: Option<u32>,
    spectator: Option<bool>,
}

impl Player {
    fn merge(&mut self, other: Self) {
        if other.alias.is_some() {
            self.alias = other.alias;
        }
        if other.account.is_some() {
            self.account = other.account;
        }
        self.team = other.team.or(self.team);
        self.squad = other.squad.or(self.squad);
        self.team_actor = other.team_actor.or(self.team_actor);
        self.spectator = other.spectator.or(self.spectator);
    }

    fn squad_link(&self, other: &Self) -> Option<&'static str> {
        if other.spectator == Some(true) {
            return None;
        }
        let both = self.squad.unwrap_or(0) > 0 && other.squad.unwrap_or(0) > 0;
        if both && self.squad != other.squad {
            return None;
        }
        if let (Some(team), Some(other_team)) = (self.team, other.team) {
            return (team == other_team).then_some(if both {
                "TeamIndex + SquadId"
            } else {
                "TeamIndex"
            });
        }
        (self.team_actor.is_some() && self.team_actor == other.team_actor)
            .then_some("PlayerTeamPrivate")
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContainerCounts {
    detected: usize,
    opened: Option<usize>,
    opened_by_squad: usize,
    opened_by_other: usize,
    destroyed: Option<usize>,
    destruction_observed: usize,
}

struct Chest {
    id: String,
    kind: String,
    position: Option<Position>,
    last_seen: f32,
    was_closed: bool,
    previously_open: bool,
    searcher: Option<(u32, f32)>,
    opening: Option<Event>,
    first_seen: Option<f32>,
    searchable: bool,
    observed_open: bool,
    destroyed: Option<bool>,
    supply_open: bool,
    spawned_pickups: Option<bool>,
}

struct Event {
    time: f32,
    pawn: Option<u32>,
    action: &'static str,
    attribution: &'static str,
    evidence: &'static str,
}

impl Chest {
    fn observe(&mut self, time: f32, data: &Update, cannon: bool) {
        self.first_seen.get_or_insert(time);
        if !cannon {
            self.searchable |=
                data.searched.is_some() || data.animation.is_some() || data.supply_open.is_some();
            self.observed_open |= data.searched == Some(true) || data.supply_open == Some(true);
            if self.destroyed != Some(true) {
                self.destroyed = data.destroyed.or(self.destroyed);
            }
        }
        self.supply_open |= data.supply_open == Some(true);
        if self.spawned_pickups != Some(true) {
            self.spawned_pickups = data.spawned_pickups.or(self.spawned_pickups);
        }
        let earlier = time - self.last_seen > 0.25;
        self.last_seen = time;
        if self.opening.is_some() || self.previously_open {
            return;
        }
        let preceding = self
            .searcher
            .filter(|(_, at)| time - at <= 2.5)
            .map(|(id, _)| id);
        let searcher = data.searcher.filter(|id| *id > 0);
        if data.searcher.is_some() {
            self.searcher = searcher.map(|id| (id, time));
        }
        let searched = if cannon {
            data.fired
        } else {
            data.supply_open.or(data.searched)
        };
        let animation = data.animation.unwrap_or(-1);
        let destroyed = data.destroyed == Some(true);
        let broken = destroyed && searched != Some(true) && animation > 0 && searcher.is_some();
        if searched != Some(true) && animation <= 0 {
            self.was_closed |= searched == Some(false) || animation == 0 || searcher.is_some();
            return;
        }
        if destroyed && searched != Some(true) && !broken {
            return;
        }
        if !self.was_closed && !earlier && searcher.is_none() {
            self.previously_open = true;
            return;
        }
        self.opening = Some(Event {
            time,
            pawn: searcher.or(preceding),
            action: if cannon {
                "fired"
            } else if broken {
                "broken"
            } else {
                "opened"
            },
            attribution: if searcher.is_some() {
                "confirmed"
            } else if preceding.is_some() {
                "inferred"
            } else {
                "unknown"
            },
            evidence: if cannon {
                "SingleUseLootCannonFired"
            } else if broken {
                "bDestroyed + SearchAnimationCount"
            } else if data.supply_open == Some(true) {
                "Opened"
            } else if searched == Some(true) {
                "bAlreadySearched"
            } else {
                "SearchAnimationCount"
            },
        });
    }
}

#[derive(Default)]
struct Pickup {
    time: f32,
    position: Option<Position>,
    item: Option<u32>,
    owner: Option<u32>,
    count: Option<i32>,
    picked: Option<bool>,
    tossed: Option<bool>,
}

#[derive(Default)]
pub(crate) struct Observer {
    recorder: Option<u32>,
    controller: Option<u32>,
    pawns: HashMap<u32, u32>,
    players: HashMap<u32, Player>,
    display_names: HashMap<u32, Vec<DisplayName>>,
    chests: Vec<Chest>,
    chest_by_name: HashMap<String, usize>,
    chest_by_actor: HashMap<u32, usize>,
    spawn_cells: HashMap<(String, i32, i32), Vec<usize>>,
    pickups: Vec<(u32, Pickup)>,
    pickup_by_actor: HashMap<u32, usize>,
    item_names: HashMap<u32, String>,
    cannon_loot: HashMap<u32, usize>,
    treasures: HashMap<u32, TreasureState>,
    pub saw_container_schema: bool,
}

pub(crate) struct Observation<'a> {
    pub time: f32,
    pub actor: u32,
    pub kind: Kind,
    pub name: &'a str,
    pub position: Option<Position>,
    pub guids: &'a HashMap<u32, String>,
}

impl Observer {
    pub(crate) fn record_name(&mut self, actor: u32, time: f32, payload: &[u8]) {
        let Some(name) = read_display_name(payload) else {
            return;
        };
        if self.display_names.len() >= 4096 && !self.display_names.contains_key(&actor) {
            return;
        }
        let names = self.display_names.entry(actor).or_default();
        if names.len() < 64 && names.last().is_none_or(|last| last.name != name) {
            names.push(DisplayName {
                name,
                observed_at: time,
            });
        }
    }

    fn name_at(&self, actor: u32, time: f32) -> Option<String> {
        let names = self.display_names.get(&actor)?;
        names
            .iter()
            .rev()
            .find(|name| name.observed_at <= time)
            .or_else(|| names.first())
            .map(|n| n.name.clone())
    }

    pub(crate) fn update(&mut self, obs: Observation<'_>, data: Update) -> WireResult<()> {
        let Observation {
            time,
            actor,
            kind,
            name,
            position,
            guids,
        } = obs;
        let position = data.location.or(position).and_then(Position::finite);
        match kind {
            Kind::Chest => {
                self.saw_container_schema |= data.searched.is_some()
                    || data.animation.is_some()
                    || data.supply_open.is_some();
                let index = self.chest(actor, name, position, guids);
                if is_supply_drop(name)
                    && let Some(location) = data.location.and_then(Position::finite)
                {
                    self.chests[index].position = Some(location);
                }
                self.chests[index].observe(time, &data, false);
            }
            Kind::Cannon => {
                self.saw_container_schema |= data.fired.is_some() || data.cannon_loot.is_some();
                let index = self.chest(actor, name, position, guids);
                if let Some(loot) = data.cannon_loot.as_ref().filter(|loot| !loot.is_empty()) {
                    let chest = &mut self.chests[index];
                    let mut event = chest.opening.take().unwrap_or(Event {
                        time,
                        pawn: None,
                        action: "fired",
                        attribution: "unknown",
                        evidence: "SpawnedPickupLoot",
                    });
                    event.attribution = "unknown";
                    event.evidence = "SpawnedPickupLoot";
                    chest.opening = Some(event);
                    for &id in loot {
                        self.cannon_loot.entry(id).or_insert(index);
                    }
                } else if data.fired.is_some() {
                    self.chests[index].observe(time, &data, true);
                }
            }
            Kind::Treasure if data.prize_success || data.prize.is_some() => {
                if self.treasures.len() < 20_000 || self.treasures.contains_key(&actor) {
                    let record = self.treasures.entry(actor).or_default();
                    if data.prize_success {
                        record.success_at.get_or_insert(time);
                    }
                    if let Some(prize) = data.prize {
                        record.template_id = prize.template_id.or(record.template_id.take());
                        record.source = prize.source.or(record.source);
                        record.pawn = prize.pawn.or(record.pawn);
                        record.from_destruction =
                            prize.from_destruction.or(record.from_destruction);
                    }
                }
            }
            Kind::Treasure => {}
            Kind::Pickup => self.pickup(actor, time, position, guids, data)?,
            Kind::Pawn => {
                if let Some(state) = data.state {
                    self.pawns.insert(actor, state);
                }
            }
            Kind::PlayerState => self.players.entry(actor).or_default().merge(data.player),
            Kind::GameState => self.recorder = self.recorder.or(data.state),
            Kind::Controller => self.controller = self.controller.or(data.state),
            Kind::Other => {}
        }
        Ok(())
    }

    fn chest(
        &mut self,
        actor: u32,
        kind: &str,
        position: Option<Position>,
        guids: &HashMap<u32, String>,
    ) -> usize {
        if let Some(&index) = self.chest_by_actor.get(&actor) {
            return index;
        }
        let name = guids.get(&actor).filter(|name| !name.is_empty());
        let mut cell = None;
        let mut known = name.and_then(|name| self.chest_by_name.get(name).copied());
        if name.is_none()
            && let Some(p) = position
        {
            let x = (p.x / 25.0).floor() as i32;
            let y = (p.y / 25.0).floor() as i32;
            let kind = kind.to_owned();
            'search: for dx in -1..=1 {
                for dy in -1..=1 {
                    if let Some(indices) = self.spawn_cells.get(&(
                        kind.clone(),
                        x.wrapping_add(dx),
                        y.wrapping_add(dy),
                    )) {
                        known = indices.iter().copied().find(|&i| {
                            self.chests[i].position.is_some_and(|other| {
                                (other.x - p.x).abs() <= 15.0 && (other.y - p.y).abs() <= 15.0
                            })
                        });
                        if known.is_some() {
                            break 'search;
                        }
                    }
                }
            }
            cell = Some((kind, x, y));
        }
        let index = known.unwrap_or_else(|| {
            let id = name.cloned().unwrap_or_else(|| format!("net:{actor}"));
            let index = self.chests.len();
            self.chest_by_name.insert(id.clone(), index);
            self.chests.push(Chest {
                id,
                kind: kind.to_owned(),
                position,
                last_seen: f32::INFINITY,
                was_closed: false,
                previously_open: false,
                searcher: None,
                opening: None,
                first_seen: None,
                searchable: false,
                observed_open: false,
                destroyed: None,
                supply_open: false,
                spawned_pickups: None,
            });
            if let Some(key) = cell {
                self.spawn_cells.entry(key).or_default().push(index);
            }
            index
        });
        self.chest_by_actor.insert(actor, index);
        index
    }

    fn pickup(
        &mut self,
        actor: u32,
        time: f32,
        position: Option<Position>,
        guids: &HashMap<u32, String>,
        data: Update,
    ) -> WireResult<()> {
        let index = match self.pickup_by_actor.get(&actor) {
            Some(&i) => i,
            None => {
                let i = self.pickups.len();
                if i >= 60_000 {
                    return Err(Invalid("Límite de actores de objetos alcanzado."));
                }
                self.pickup_by_actor.insert(actor, i);
                self.pickups.push((
                    actor,
                    Pickup {
                        time,
                        position,
                        ..Pickup::default()
                    },
                ));
                i
            }
        };
        let (_, pickup) = &mut self.pickups[index];
        pickup.item = data.item.filter(|v| *v > 0).or(pickup.item);
        if let Some(id) = pickup.item
            && !self.item_names.contains_key(&id)
            && let Some(name) = guids.get(&id)
        {
            self.item_names.insert(id, name.clone());
        }
        pickup.owner = data.owner.filter(|v| *v > 0).or(pickup.owner);
        pickup.count = data.count.filter(|v| *v > 0).or(pickup.count);
        pickup.picked = if data.picked == Some(true) {
            data.picked
        } else {
            pickup.picked.or(data.picked)
        };
        pickup.tossed = data.tossed.or(pickup.tossed);
        pickup.position = pickup.position.or(position);
        Ok(())
    }

    pub(crate) fn finish(&self, analysis: &mut Analysis, guids: &HashMap<u32, String>) {
        let recorder = self.recorder.or(self.controller);
        let player = recorder.and_then(|id| self.players.get(&id));
        analysis.recorder_name = recorder
            .and_then(|id| self.name_at(id, f32::INFINITY))
            .or_else(|| player.and_then(|p| p.alias.clone()));
        analysis.recorder_team = player.and_then(|p| p.team);
        analysis.squad_evidence = player.and_then(|p| {
            p.team
                .map(|_| "TeamIndex")
                .or(p.team_actor.map(|_| "PlayerTeamPrivate"))
        });
        let roster = self.squad(recorder, player, analysis);
        analysis.chest_actors_observed = self.chests.len();
        let searchable_classes: HashSet<_> = self
            .chests
            .iter()
            .filter(|chest| chest.searchable)
            .map(|chest| chest.kind.as_str())
            .collect();
        for chest in &self.chests {
            if chest.first_seen.is_some()
                && (searchable_classes.contains(chest.kind.as_str())
                    || is_supply_drop(&chest.kind)
                    || known_container(&chest.kind))
            {
                let totals = analysis.containers.entry(chest.kind.clone()).or_default();
                totals.detected += 1;
                if chest.searchable {
                    *totals.opened.get_or_insert(0) += usize::from(
                        chest.observed_open
                            || chest
                                .opening
                                .as_ref()
                                .is_some_and(|event| event.action == "opened"),
                    );
                }
                if let Some(destroyed) = chest.destroyed {
                    totals.destruction_observed += 1;
                    *totals.destroyed.get_or_insert(0) += usize::from(destroyed);
                }
            }
            if is_supply_drop(&chest.kind)
                && let Some(time) = chest.first_seen
            {
                analysis.supply_drops.push(SupplyDrop {
                    id: chest.id.clone(),
                    kind: chest.kind.clone(),
                    observed_at: time,
                    opened: chest.supply_open
                        || chest.opening.as_ref().is_some_and(|e| e.action == "opened"),
                    opened_at: chest
                        .opening
                        .as_ref()
                        .filter(|e| e.action == "opened")
                        .map(|e| e.time),
                    position: chest.position,
                    spawned_pickups: chest.spawned_pickups,
                });
            }
            let Some(event) = &chest.opening else {
                continue;
            };
            let player_id = event.pawn.and_then(|id| self.pawns.get(&id).copied());
            let other = player_id.and_then(|id| self.players.get(&id));
            let is_recorder = player_id.is_some() && player_id == recorder;
            let team_role = if is_recorder {
                "recorder"
            } else if player_id.is_some_and(|id| roster.contains(&id)) {
                "squad"
            } else if player
                .zip(other)
                .is_some_and(|(a, b)| a.team.zip(b.team).is_some_and(|(x, y)| x != y))
            {
                "other"
            } else {
                "unknown"
            };
            if chest.first_seen.is_some() && chest.searchable && event.action == "opened"
                && let Some(totals) = analysis.containers.get_mut(&chest.kind)
            {
                match team_role {
                    "recorder" | "squad" => totals.opened_by_squad += 1,
                    "other" => totals.opened_by_other += 1,
                    _ => {}
                }
            }
            analysis.chests.push(Opening {
                id: chest.id.clone(),
                kind: chest.kind.clone(),
                time: event.time,
                position: chest.position,
                player_id,
                player: player_id
                    .and_then(|id| self.name_at(id, event.time))
                    .or_else(|| other.and_then(|p| p.alias.clone())),
                recorder: is_recorder,
                attribution: if player_id.is_some() {
                    event.attribution
                } else {
                    "unknown"
                },
                evidence: event.evidence,
                action: event.action,
                team_role,
            });
        }
        analysis.chests.sort_by(|a, b| a.time.total_cmp(&b.time));
        for (&actor, treasure) in &self.treasures {
            let Some(time) = treasure.success_at else {
                continue;
            };
            let player_id = treasure.pawn.and_then(|id| self.pawns.get(&id).copied());
            let source_type = treasure
                .source
                .and_then(|id| self.chest_by_actor.get(&id))
                .map(|&index| self.chests[index].kind.clone());
            analysis.treasures.push(TreasureAward {
                actor,
                observed_at: time,
                template_id: treasure.template_id.clone(),
                source_actor: treasure.source,
                source_type,
                player_id,
                player: player_id.and_then(|id| {
                    self.name_at(id, time).or_else(|| {
                        self.players
                            .get(&id)
                            .and_then(|player| player.alias.clone())
                    })
                }),
                from_destruction: treasure.from_destruction,
            });
        }
        analysis.treasures.sort_by(|a, b| {
            a.observed_at
                .total_cmp(&b.observed_at)
                .then(a.actor.cmp(&b.actor))
        });
        for (actor, pickup) in &self.pickups {
            let Some(name) = pickup
                .item
                .and_then(|id| self.item_names.get(&id).or_else(|| guids.get(&id)))
            else {
                continue;
            };
            if name.trim().is_empty() {
                continue;
            }
            let within = |index: &&usize| {
                self.chests[**index]
                    .opening
                    .as_ref()
                    .is_some_and(|e| (e.time - pickup.time).abs() <= 2.0)
            };
            let source = self
                .cannon_loot
                .get(actor)
                .filter(within)
                .map(|i| (*i, "SpawnedPickupLoot"))
                .or_else(|| {
                    if pickup.tossed != Some(true) {
                        return None;
                    }
                    pickup
                        .owner
                        .and_then(|id| self.chest_by_actor.get(&id))
                        .filter(within)
                        .map(|i| (*i, "Owner + bTossedFromContainer"))
                });
            analysis.items.push(Loot {
                actor: *actor,
                item_id: name.clone(),
                observed_at: pickup.time,
                position: pickup.position,
                stack: pickup.count,
                picked_up: pickup.picked,
                from_container: pickup.tossed,
                chest_id: source.map(|(i, _)| self.chests[i].id.clone()),
                source_evidence: source.map(|(_, evidence)| evidence),
            });
        }
    }

    fn squad(
        &self,
        recorder: Option<u32>,
        owner: Option<&Player>,
        analysis: &mut Analysis,
    ) -> HashSet<u32> {
        let Some(recorder) = recorder else {
            return HashSet::new();
        };
        let mut occurrences = HashMap::new();
        for id in self.players.values().filter_map(|p| p.account.as_deref()) {
            *occurrences.entry(id).or_insert(0) += 1;
        }
        let mut roster = HashSet::new();
        let missing = Player::default();
        let people = self
            .players
            .iter()
            .map(|(&id, p)| (id, p))
            .chain(owner.is_none().then_some((recorder, &missing)));
        for (id, player) in people {
            let evidence = if id == recorder {
                Some("RecorderPlayerState")
            } else {
                owner.and_then(|p| p.squad_link(player))
            };
            let Some(evidence) = evidence else { continue };
            roster.insert(id);
            let account_key = player
                .account
                .as_deref()
                .filter(|s| occurrences.get(s) == Some(&1))
                .map(|s| hex(&Sha256::digest(s.as_bytes()), false));
            let display_names = self.display_names.get(&id).cloned().unwrap_or_default();
            analysis.squad.push(SquadMember {
                player_id: id,
                alias: player.alias.clone(),
                recorder: id == recorder,
                account_key,
                display_names,
                evidence,
            });
        }
        analysis.squad.sort_by_key(|p| p.player_id);
        roster
    }
}

// PlayerState external data, identified by the two-byte PlayerNameData header.
// Apply the per-code-unit offset before decoding UTF-16 so that Unicode names survive.
fn read_display_name(payload: &[u8]) -> Option<String> {
    if !(8..=199).contains(&payload.len()) || payload[..2] != [0x19, 0xfb] || payload[2] > 1 {
        return None;
    }
    let length = i32::from_le_bytes(payload[3..7].try_into().ok()?);
    let units = length.unsigned_abs() as usize;
    if !(2..=96).contains(&units) {
        return None;
    }
    let raw = &payload[7..];
    let mut text: Vec<u16> = if length < 0 {
        if raw.len() != units * 2 {
            return None;
        }
        raw.chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect()
    } else {
        if raw.len() != units {
            return None;
        }
        raw.iter().map(|&b| u16::from(b)).collect()
    };
    if text.pop() != Some(0) {
        return None;
    }
    if payload[2] == 1 {
        let seed = text.len() % 4 * 3 % 8 + 1;
        for (i, unit) in text.iter_mut().enumerate() {
            *unit = unit.wrapping_add(((seed + i) * 3 % 8) as u16);
        }
    }
    let name = String::from_utf16(&text).ok()?;
    (!name.trim().is_empty() && !name.chars().any(char::is_control)).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::{
        Analysis, Bits, Kind, Observation, Observer, TreasureState, Update, read_display_name,
        read_prize_id,
    };

    #[test]
    fn recognizes_a_gizmo_actor_without_creating_an_acquisition() {
        let mut result = Analysis::default();
        result.observe_gizmo(700, 12.0, "B_RelicFinder_C");
        result.observe_gizmo(700, 15.0, "B_RelicFinder_C");
        result.observe_gizmo(701, 13.0, "B_RelicFinder_Unknown_C");
        assert_eq!(result.gizmos.len(), 1);
        let observation = &result.gizmos[&700];
        assert_eq!(observation.kind, "sprite-locator");
        assert_eq!(observation.observed_at, 12.0);
        assert!(result.treasures.is_empty());
        assert!(result.chests.is_empty());
    }

    #[test]
    fn decodes_exact_treasure_template() {
        // The observed envelope carries an FString followed by two terminators.
        let template = b"DelilahPrize:PirateAccount\0";
        let bits = (4 + template.len()) * 8;
        let mut bytes = vec![
            2,
            2,
            100,
            ((bits % 128) * 2 + 1) as u8,
            ((bits / 128) * 2) as u8,
        ];
        bytes.extend_from_slice(&(template.len() as u32).to_le_bytes());
        bytes.extend_from_slice(template);
        bytes.extend_from_slice(&[0, 0]);
        assert_eq!(
            read_prize_id(Bits::new(&bytes, bytes.len() * 8)).as_deref(),
            Some("DelilahPrize:PirateAccount")
        );
        assert_eq!(read_prize_id(Bits::new(&bytes, bytes.len() * 8 - 1)), None);
    }

    #[test]
    fn counts_container_and_reward_updates_once_per_actor() {
        let mut observer = Observer::default();
        let guids = Default::default();
        for (time, searched, destroyed) in
            [(1.0, false, false), (2.0, true, false), (3.0, true, true)]
        {
            observer
                .update(
                    Observation {
                        actor: 20,
                        time,
                        kind: Kind::Chest,
                        name: "Tiered_Chest_Athena",
                        position: None,
                        guids: &guids,
                    },
                    Update {
                        searched: Some(searched),
                        destroyed: Some(destroyed),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        for time in [2.0, 2.5] {
            observer
                .update(
                    Observation {
                        actor: 40,
                        time,
                        kind: Kind::Treasure,
                        name: "BGA_DelilahTreasureHuntAnimatedChest",
                        position: None,
                        guids: &guids,
                    },
                    Update {
                        prize: Some(TreasureState {
                            template_id: Some("DelilahPrize:dpid_item10".to_owned()),
                            source: Some(20),
                            ..Default::default()
                        }),
                        prize_success: true,
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        let mut result = Analysis::default();
        observer.finish(&mut result, &guids);
        let chest = &result.containers["Tiered_Chest_Athena"];
        assert_eq!(
            (
                chest.detected,
                chest.opened,
                chest.destroyed,
                chest.destruction_observed
            ),
            (1, Some(1), Some(1), 1)
        );
        assert_eq!(result.treasures.len(), 1);
        assert_eq!(result.treasures[0].observed_at, 2.0);
        assert_eq!(
            result.treasures[0].source_type.as_deref(),
            Some("Tiered_Chest_Athena")
        );
    }

    #[test]
    fn reads_external_display_name() {
        let bytes = [
            0x19, 0xfb, 1, 7, 0, 0, 0, 0x4e, 0x68, 0x66, 0x6b, 0x60, 0x6a, 0,
        ];
        assert_eq!(read_display_name(&bytes).as_deref(), Some("Shiqan"));
        assert_eq!(read_display_name(&bytes[..12]), None);
    }
}
