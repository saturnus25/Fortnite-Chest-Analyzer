import { translate } from './locales'
import type { Language } from './locales'
import { chestOpened } from './containers'
import type { EventRow } from './data'
import type { Opening, Result, SquadMember } from './types'

export type Totals = { opened: number; chestOpened: number; broken: number; fired: number; linked: number; inferred: number }
export type ObservedName = { name: string; firstSeen: string | null; lastSeen: string | null; matches: number }
type RosterRow = Totals & { key: string; label: string; alias?: string | null; matches: number; recorder: boolean; stable: boolean; names: ObservedName[] }
export const memberKey = (member: SquadMember, match: Result) => member.accountKey
  ? `cuenta:${member.accountKey}` : `partida:${match.key}:${member.playerId}`
const blank = (): Totals => ({ opened: 0, chestOpened: 0, broken: 0, fired: 0, linked: 0, inferred: 0 })

export function rosterLabels(matches: Result[], aliases: Record<string, string>, language: Language = 'es') {
  const labels = new Map<string, string>()
  const recorded = new Map<string, string>()
  let count = 0
  for (const match of matches) for (const member of match.squad ?? []) {
    const key = memberKey(member, match)
    const latest = member.displayNames?.at(-1)?.name
    if (latest) recorded.set(key, latest)
    if (labels.has(key)) continue
    const fallback = member.recorder ? translate(language, 'Jugador que grabó')
      : member.accountKey ? translate(language, 'Compañero {id}', { id: String(++count) })
        : member.localLabel ?? member.alias ?? translate(language, 'Compañero sin ID estable')
    labels.set(key, fallback)
  }
  for (const [key, fallback] of labels) labels.set(key, aliases[key] ?? recorded.get(key) ?? fallback)
  return labels
}

export function memberOf(match: Result, opening: Opening) {
  return match.squad?.find(member => member.playerId === opening.playerId)
}

export function squadSummary(matches: Result[], events: EventRow[], labels: Map<string, string>, language: Language = 'es') {
  const totals = blank()
  const roster = new Map<string, RosterRow>()
  const active = new Set(matches.map(match => match.key))
  const histories = new Map<string, Map<string, ObservedName>>()
  for (const match of matches) {
    for (const member of match.squad ?? []) {
      const key = memberKey(member, match)
      const row = roster.get(key) ?? {
        ...blank(), key, label: labels.get(key) ?? translate(language, 'Desconocido'),
        alias: member.alias, matches: 0, recorder: false, stable: Boolean(member.accountKey), names: [],
      }
      row.recorder ||= member.recorder
      row.matches++
      roster.set(key, row)
      const observed = histories.get(key) ?? new Map<string, ObservedName>()
      histories.set(key, observed)
      for (const name of new Set(member.displayNames?.map(entry => entry.name))) {
        const stamp = match.recordedAt ?? null
        const previous = observed.get(name) ?? { name, firstSeen: stamp, lastSeen: stamp, matches: 0 }
        previous.matches++
        previous.firstSeen ??= stamp
        previous.lastSeen = stamp ?? previous.lastSeen
        observed.set(name, previous)
      }
    }
  }
  for (const row of roster.values()) {
    row.names = [...(histories.get(row.key)?.values() ?? [])]
  }
  function add(target: Totals, { opening, items }: EventRow) {
    target[opening.action]++
    if (chestOpened(opening)) target.chestOpened++
    target.linked += items.length
    if (opening.attribution === 'inferred') target.inferred++
  }
  for (const event of events) {
    if (!active.has(event.match.key) || !['recorder', 'squad'].includes(event.opening.teamRole)) continue
    const member = memberOf(event.match, event.opening)
    if (!member) continue
    const row = roster.get(memberKey(member, event.match))
    if (!row) continue
    add(row, event)
    add(totals, event)
  }
  return {
    totals, members: [...roster.values()].sort((a, b) => Number(b.recorder) - Number(a.recorder) || a.label.localeCompare(b.label, language)),
    withRoster: matches.filter(match => match.squadEvidence).length,
  }
}

export const activations = (row: Totals) => row.opened + row.broken + row.fired
export const roles = { recorder: 'Grabador', squad: 'Compañero', other: 'Otro equipo', unknown: 'Sin atribución de equipo' }




