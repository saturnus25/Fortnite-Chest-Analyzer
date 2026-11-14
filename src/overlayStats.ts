import { gizmoNames } from './catalog'
import { chestOpened, containerOf } from './containers'
import { translate } from './locales'
import { memberKey } from './squad'
import { gizmoFromTemplate, squadRewardOpenings, squadRewardTemplates, treasureName } from './treasure'
import type { SquadRewardKind } from './treasure'
import type { Result } from './types'

const roles = ['recorder', 'mates', 'team'] as const
type Role = typeof roles[number]
type RoleCounts = Record<Role, number | null> & { unassigned: number }
type Ranked = { key: string; name: string | null; nameTime: number; opened: number }
const maxRankings = 12

type MatchStats = {
  start: number; end: number; counts: RoleCounts; players: Ranked[]; rewards: Map<SquadRewardKind, number>
  records: Map<string, number>; actors: Map<string, number>
}
const cache = new WeakMap<Result, MatchStats>()

function countByName<T>(entries: readonly T[], nameOf: (entry: T) => string) {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const name = nameOf(entry)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

function matchStats(match: Result): MatchStats {
  const cached = cache.get(match)
  if (cached) return cached

  const roster = new Map(match.squad?.map(member => [member.playerId, member]))
  const recorder = [...roster.values()].find(member => member.recorder)
  const recorderKnown = Boolean(match.recorderName || recorder)
  const teamKnown = Boolean(match.squadEvidence && roster.size)
  const matesKnown = teamKnown && [...roster.values()].some(member => !member.recorder)
  const date = match.recordedAt
  const recorded = date ? Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? date : `${date}Z`) : NaN
  const start = Number.isFinite(recorded) ? recorded : match.fileModifiedAt ?? -Infinity
  const end = Number.isFinite(recorded) ? start + Math.max(0, match.durationMs ?? 0) : start
  const unassigned = Object.entries(match.containers ?? {}).reduce((sum, [type, data]) =>
    sum + (containerOf(type).category === 'chest' ? data.destroyedWithoutOpening ?? 0 : 0), 0)
  const counts: RoleCounts = { recorder: recorderKnown ? 0 : null, mates: matesKnown ? 0 : null, team: null, unassigned }
  const players = new Map<string, Ranked>()
  for (const member of roster.values()) {
    const observed = member.displayNames?.reduce<{ name: string; observedAt: number } | undefined>(
      (latest, entry) => entry.name && (!latest || entry.observedAt >= latest.observedAt) ? entry : latest, undefined)
    const key = memberKey(member, match)
    players.set(key, { key, name: observed?.name || member.alias || null, nameTime: start + (observed?.observedAt ?? 0) * 1000, opened: 0 })
  }
  for (const event of match.chests) {
    const broken = event.action === 'broken' && containerOf(event.type).category === 'chest'
    if (!chestOpened(event) && !broken) continue
    if (broken && event.teamRole === 'unknown') counts.unassigned++
    if (event.teamRole === 'recorder') counts.recorder = (counts.recorder ?? 0) + 1
    else if (event.teamRole === 'squad') counts.mates = (counts.mates ?? 0) + 1
    else continue
    const member = (event.playerId == null ? undefined : roster.get(event.playerId)) ?? (event.teamRole === 'recorder' ? recorder : undefined)
    const key = member ? memberKey(member, match) : event.teamRole === 'recorder' ? `recorder:${match.key}` : null
    if (!key) continue
    const name = event.player || (event.teamRole === 'recorder' ? match.recorderName ?? null : null)
    const row = players.get(key) ?? { key, name: null, nameTime: -Infinity, opened: 0 }
    const time = start + (Number.isFinite(event.time) ? event.time : 0) * 1000
    if (name && (!row.name || time > row.nameTime)) {
      row.name = name
      row.nameTime = time
    }
    row.opened++
    players.set(key, row)
  }
  if (counts.recorder != null && (teamKnown || counts.mates != null)) counts.team = counts.recorder + (counts.mates ?? 0)

  const value = {
    start, end, counts, players: [...players.values()],
    rewards: new Map([...squadRewardOpenings(match)].map(([kind, openings]) => [kind, openings.length])),
    records: countByName(match.treasures ?? [], prize => {
      const gizmo = gizmoFromTemplate(match.branch, prize.templateId)
      return gizmo ? gizmoNames[gizmo] : treasureName(match.branch, prize.templateId) ?? 'Premio sin identificar'
    }),
    actors: countByName(match.gizmos ?? [], observation => gizmoNames[observation.kind]),
  }
  cache.set(match, value)
  return value
}

function period(matches: MatchStats[], latestNames: Map<string, Ranked>) {
  const totals: Record<Role, { total: number | null; games: number }> = {
    recorder: { total: null, games: 0 }, mates: { total: null, games: 0 }, team: { total: null, games: 0 },
  }
  const rewards = new Map<SquadRewardKind, number>()
  const records = new Map<string, number>()
  const actors = new Map<string, number>()
  const players = new Map<string, Ranked>()
  for (const match of matches) {
    for (const role of roles) {
      const count = match.counts[role]
      if (count == null) continue
      totals[role].total = (totals[role].total ?? 0) + count
      totals[role].games++
    }
    for (const [kind, count] of match.rewards) rewards.set(kind, (rewards.get(kind) ?? 0) + count)
    for (const [name, count] of match.records) records.set(name, (records.get(name) ?? 0) + count)
    for (const [name, count] of match.actors) actors.set(name, (actors.get(name) ?? 0) + count)
    for (const player of match.players) {
      players.set(player.key, { ...player, opened: (players.get(player.key)?.opened ?? 0) + player.opened })
    }
  }
  const labeled = (spanish: string, count: number | null) => ({ spanish, english: translate('en', spanish), count })
  const observed = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => labeled(name, count))
  return {
    matches: matches.length, ...totals, unassigned: matches.reduce((sum, match) => sum + match.counts.unassigned, 0),
    rewards: squadRewardTemplates.map(([, kind]) => {
      const spanish = kind === 'pirate-token' ? 'Token pirata' : gizmoNames[kind]
      return labeled(spanish, rewards.get(kind) ?? null)
    }),
    rewardRecords: observed(records),
    gizmoActors: observed(actors),
    top: [...players.values()].map(player => ({ ...player, name: latestNames.get(player.key)?.name ?? null }))
      .filter(player => player.opened > 0 || player.name)
      .sort((a, b) => b.opened - a.opened || (a.name ?? '').localeCompare(b.name ?? '')).slice(0, maxRankings)
      .map(({ name, opened }) => ({ name: name ? [...name].slice(0, 24).join('') : null, opened })),
  }
}

export function overlayStats(results: Result[], startedAt: number) {
  const matches = results.filter(match => match.status === 'complete' || match.status === 'partial')
    .map(matchStats).sort((a, b) => a.start - b.start)
  const latestNames = new Map<string, Ranked>()
  for (const match of matches) for (const player of match.players) {
    const previous = latestNames.get(player.key)
    if (player.name && (!previous || player.nameTime >= previous.nameTime)) latestNames.set(player.key, player)
  }
  return {
    history: period(matches, latestNames),
    session: period(matches.filter(match => match.end >= startedAt), latestNames),
    last: matches.at(-1)?.counts ?? null,
  }
}

export function compactOverlayResult(match: Result): Result {
  const { status, key, file, size, hash, guid, live } = match
  const compact = { status, key, file, size, hash, guid, live, detail: null, items: [], chests: [] }
  // Keep the statistics and deduplication keys after Fortnite rotates the file out.
  if (status === 'complete' || status === 'partial') cache.set(compact, matchStats(match))
  return compact
}
