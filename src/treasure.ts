import type { Analysis, TreasureAward } from './types'

const gizmoRewardTemplates = [
  ['DelilahPrize:dpid_item10', 'extractor'],
  ['DelilahPrize:dpid_item13', 'lucky-locator'],
  ['DelilahPrize:dpid_item9', 'smuggler-key'],
] as const
const pirateTemplate = 'DelilahPrize:PirateAccount'
export const squadRewardTemplates = [...gizmoRewardTemplates, [pirateTemplate, 'pirate-token']] as const

export type SquadRewardKind = typeof squadRewardTemplates[number][1]

const treasureBranch = '++Fortnite+Release-43.00'

// Fortnite's 43.00 DelilahTreasureHuntGameplay asset defines these reward templates.
const templateNames = new Map([
  [pirateTemplate.toLowerCase(), 'Pirate Shop Access'],
  ['delilahprize:dpid_item15', 'Mochila Lil’ Uzi Crew'],
  ['delilahprize:dpid_item16', 'Pista de improvisación London'],
])

const gizmoTemplates = new Map<string, typeof gizmoRewardTemplates[number][1]>(
  gizmoRewardTemplates.map(([template, kind]) => [template.toLowerCase(), kind]),
)

export function gizmoFromTemplate(branch?: string | null, template?: string | null) {
  return branch === treasureBranch && template ? gizmoTemplates.get(template.toLowerCase()) : undefined
}

export function isPirateShopAccess(branch?: string | null, template?: string | null) {
  return branch === treasureBranch && template?.toLowerCase() === pirateTemplate.toLowerCase()
}

export function treasureName(branch?: string | null, template?: string | null) {
  return branch === treasureBranch && template ? templateNames.get(template.toLowerCase()) : undefined
}


// Each source opening can award at most one prize, shared by the whole squad.
// These are observed acquisitions. Replay coverage does not establish a final total.
export function squadRewardOpenings(match: Pick<Analysis, 'branch' | 'status' | 'squad' | 'treasures'>) {
  const rewards = new Map<SquadRewardKind, TreasureAward[]>()
  if (match.branch !== treasureBranch || !['complete', 'partial'].includes(match.status)) return rewards
  const squad = new Set(match.squad?.map(member => member.playerId))
  const sources = new Map<number, TreasureAward[]>()
  for (const prize of match.treasures ?? []) {
    if (prize.sourceActor == null || prize.sourceActor <= 0) continue
    const entries = sources.get(prize.sourceActor) ?? []
    entries.push(prize)
    sources.set(prize.sourceActor, entries)
  }
  for (const entries of sources.values()) {
    const templates = new Set(entries.flatMap(prize => prize.templateId ? [prize.templateId.toLowerCase()] : []))
    // Contradictory templates for the same opening cannot be counted safely.
    if (templates.size !== 1) continue
    const prize = entries.find(prize => prize.templateId && prize.playerId != null && squad.has(prize.playerId))
    if (!prize) continue
    const kind = isPirateShopAccess(match.branch, prize.templateId)
      ? 'pirate-token' : gizmoFromTemplate(match.branch, prize.templateId)
    if (!kind) continue
    const openings = rewards.get(kind) ?? []
    openings.push(prize)
    rewards.set(kind, openings)
  }
  return rewards
}
