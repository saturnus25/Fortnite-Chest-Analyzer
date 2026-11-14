//! Native-only evidence collection. These observations never feed the production totals.
use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use crate::{
    analysis::Kind,
    wire::{Bits, Invalid, WireResult},
};

const MAX_OBSERVATIONS: usize = 150_000;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub fields: BTreeMap<&'static str, usize>,
    pub malformed: usize,
    pub truncated: bool,
    pub fatal_targets: usize,
    pub damage_exports: Vec<String>,
    pub searcher_without_transition: usize,
    pub closed_without_event: BTreeMap<u32, usize>,
    pub actors: Vec<Case>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Case {
    pub id: String,
    pub actor: u32,
    pub kind: String,
    pub action: Option<&'static str>,
    pub player_state: Option<u32>,
    pub at: f32,
    pub state: ChestUpdate,
    pub prior_searcher: Option<(f32, u32)>,
    pub parent: Option<u32>,
    pub direct: Vec<u32>,
    pub support: Vec<u32>,
    pub prize_openers: Vec<u32>,
    pub assessment: Assessment,
    pub close: Option<(f32, u32)>,
    pub linked_loot: usize,
    pub unassigned: bool,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Assessment {
    AlreadyOpened,
    ConflictingEvidence,
    CorroboratedExistingBreak,
    DirectHitCandidate,
    SupportHitCandidate,
    NoResolvedDamageSource,
}

pub(crate) fn assess(
    action: Option<&str>,
    existing: Option<u32>,
    direct: &[u32],
    support: &[u32],
) -> Assessment {
    if action == Some("opened") {
        return Assessment::AlreadyOpened;
    }
    let Some(candidate) = direct.first().or_else(|| support.first()).copied() else {
        return Assessment::NoResolvedDamageSource;
    };
    if direct
        .iter()
        .chain(support)
        .any(|&player| player != candidate)
        || existing.is_some_and(|player| player != candidate)
    {
        return Assessment::ConflictingEvidence;
    }
    if !direct.is_empty() {
        if action == Some("broken") && existing == Some(candidate) {
            return Assessment::CorroboratedExistingBreak;
        }
        return Assessment::DirectHitCandidate;
    }
    Assessment::SupportHitCandidate
}

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChestUpdate {
    pub time: f32,
    pub resent: bool,
    pub opened_channel: bool,
    pub searcher: Option<u32>,
    pub searched: Option<bool>,
    pub animation: Option<u32>,
    pub destroyed: Option<bool>,
    pub parent: Option<u32>,
    pub instigator: Option<u32>,
    pub damage_magnitude: bool,
}

#[derive(Default)]
pub(crate) struct Probe {
    pub fields: BTreeMap<&'static str, usize>,
    pub malformed: usize,
    pub truncated: bool,
    budget: usize,
    pub updates: HashMap<u32, Vec<ChestUpdate>>,
    pub fatal: HashMap<u32, Vec<(f32, u32)>>,
    pub closes: HashMap<u32, Vec<(f32, u32)>>,
}

pub(crate) fn resolve_candidate(
    evidence: impl IntoIterator<Item = u32>,
    resolve: impl Fn(u32) -> Option<u32>,
) -> Vec<u32> {
    let mut players: Vec<_> = evidence.into_iter().filter_map(resolve).collect();
    players.sort_unstable();
    players.dedup();
    players
}

impl Probe {
    fn add(&mut self) -> bool {
        if self.budget == MAX_OBSERVATIONS {
            self.truncated = true;
            return false;
        }
        self.budget += 1;
        true
    }

    pub(crate) fn closed(&mut self, actor: u32, time: f32, reason: Option<u32>) {
        if let Some(reason) = reason
            && self.add()
        {
            self.closes.entry(actor).or_default().push((time, reason));
        }
    }

    pub(crate) fn fields<'a>(
        &mut self,
        actor: u32,
        time: f32,
        kind: Kind,
        rpc: bool,
        mut bits: Bits<'_>,
        name: impl Fn(usize) -> Option<&'a str>,
        opened_channel: bool,
    ) {
        let mut update = ChestUpdate {
            time,
            opened_channel,
            ..Default::default()
        };
        let mut hit = None;
        let mut non_player_hit = None;
        let mut fatal = None;
        let mut non_player_fatal = None;
        let mut relevant = false;
        let read = visit_fields(&mut bits, name, |field, mut value| {
            let key = match field {
                "SearchingPawn" => {
                    update.searcher = reference(&mut value);
                    "SearchingPawn"
                }
                "SearchAnimationCount" => {
                    let width = value.left();
                    update.animation = (width <= 32)
                        .then(|| value.read(width).ok().map(|v| v as u32))
                        .flatten();
                    "SearchAnimationCount"
                }
                "bAlreadySearched" => {
                    update.searched = flag(&mut value);
                    "bAlreadySearched"
                }
                "bDestroyed" => {
                    update.destroyed = flag(&mut value);
                    "bDestroyed"
                }
                "AttachParent" => {
                    update.parent = reference(&mut value);
                    "AttachParent"
                }
                "Instigator" => {
                    update.instigator = reference(&mut value);
                    "Instigator"
                }
                "ProxyGameplayCueDamageMagnitude" => {
                    update.damage_magnitude = true;
                    "ProxyGameplayCueDamageMagnitude"
                }
                "Role" => {
                    update.resent = true;
                    return;
                }
                "Owner" => "Owner",
                "bTossedFromContainer" => "bTossedFromContainer",
                "SpawnedPickupLoot" => "SpawnedPickupLoot",
                "HitActor" if rpc => {
                    hit = reference(&mut value);
                    "RPC.HitActor"
                }
                "NonPlayerHitActor" if rpc => {
                    non_player_hit = reference(&mut value);
                    "RPC.NonPlayerHitActor"
                }
                "bIsFatal" if rpc => {
                    fatal = flag(&mut value);
                    "RPC.bIsFatal"
                }
                "NonPlayerbIsFatal" if rpc => {
                    non_player_fatal = flag(&mut value);
                    "RPC.NonPlayerbIsFatal"
                }
                _ => return,
            };
            *self.fields.entry(key).or_default() += 1;
            relevant = true;
        });
        if read.is_err() {
            self.malformed += 1;
            return;
        }
        if rpc {
            for (target, fatal) in [(hit, fatal), (non_player_hit, non_player_fatal)] {
                if let (Some(target @ 1..), Some(true)) = (target, fatal)
                    && self.add()
                {
                    self.fatal.entry(target).or_default().push((time, actor));
                }
            }
        } else if relevant && kind == Kind::Chest && self.add() {
            self.updates.entry(actor).or_default().push(update);
        }
    }
}

fn flag(value: &mut Bits<'_>) -> Option<bool> {
    (value.left() == 1).then(|| value.bit().ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_conflicts_and_excludes_unresolved_actor_references() {
        let states = [(7, 13), (8, 13), (9, 21)];
        let resolve = |id| {
            states
                .iter()
                .find(|(actor, _)| *actor == id)
                .map(|(_, state)| *state)
        };
        assert_eq!(resolve_candidate([7, 7, 8, 9, 10], resolve), [13, 21]);
        assert!(resolve_candidate([10, 11], resolve).is_empty());
        assert_eq!(
            assess(Some("broken"), Some(13), &[13, 21], &[]),
            Assessment::ConflictingEvidence
        );
        assert_eq!(
            assess(Some("broken"), Some(13), &[21], &[]),
            Assessment::ConflictingEvidence
        );
        assert_eq!(
            assess(Some("broken"), Some(13), &[13], &[]),
            Assessment::CorroboratedExistingBreak
        );
        assert_eq!(
            assess(Some("opened"), Some(13), &[21], &[]),
            Assessment::AlreadyOpened
        );
        assert_eq!(
            assess(None, None, &[], &[13]),
            Assessment::SupportHitCandidate
        );
    }

    #[test]
    fn reads_target_and_fatal_flag_in_the_same_rpc() {
        // Payload checksum bit + two packed fields + terminator, written least-significant bit first.
        fn pack(fields: &[(u32, usize)]) -> (Vec<u8>, usize) {
            let mut data = vec![0u8; 32];
            let mut offset = 1;
            for &(value, width) in fields {
                for bit in 0..width {
                    data[offset / 8] |= (((value >> bit) & 1) as u8) << (offset % 8);
                    offset += 1;
                }
            }
            (data, offset)
        }
        let (bytes, width) = pack(&[(2, 8), (16, 8), (60, 8), (4, 8), (2, 8), (1, 1), (0, 8)]);
        let mut probe = Probe::default();
        let field = |index| {
            ["NonPlayerHitActor", "NonPlayerbIsFatal"]
                .get(index)
                .copied()
        };
        probe.fields(
            66,
            10.0,
            Kind::Pawn,
            true,
            Bits::new(&bytes, width),
            field,
            false,
        );
        assert_eq!(probe.fatal[&30], [(10.0, 66)]);
        probe.fields(
            67,
            10.0,
            Kind::Pawn,
            true,
            Bits::new(&bytes, width - 1),
            field,
            false,
        );
        assert_eq!(probe.fatal[&30], [(10.0, 66)]);
    }
}

fn reference(value: &mut Bits<'_>) -> Option<u32> {
    if !(8..=40).contains(&value.left()) || !value.left().is_multiple_of(8) {
        return None;
    }
    let id = value.packed().ok()?;
    (value.left() == 0).then_some(id)
}

pub(crate) fn visit_fields<'a>(
    bits: &mut Bits<'_>,
    name: impl Fn(usize) -> Option<&'a str>,
    mut visit: impl FnMut(&str, Bits<'_>),
) -> WireResult<()> {
    bits.bit()?;
    for _ in 0..1024 {
        let handle = bits.packed()?;
        if handle == 0 {
            return Ok(());
        }
        let size = bits.packed()? as usize;
        let value = bits.slice(size)?;
        if size != 0
            && let Some(field) = name(handle as usize - 1)
        {
            visit(field, value);
        }
    }
    Err(Invalid("Límite de propiedades de diagnóstico."))
}
