import type { Catalog } from './catalog'
import { catalogIndex } from './catalog'
import { chestOpened } from './containers'
import { actionLabel, csv, playerLabel, saveFile, statusLabel, trustLabel } from './format'
import { isPirateShopAccess } from './treasure'
import type { Loot, Opening, Result } from './types'
import { valid } from './useAnalysis'
import { memberKey, memberOf, roles, squadSummary } from './squad'

export type EventRow = { match: Result; opening: Opening; items: Loot[] }
export type LootRow = { match: Result; item: Loot; opening?: Opening }
export type Metadata = ReturnType<typeof catalogIndex>

export function report(results: Result[]) {
  const events: EventRow[] = []
  const loot: LootRow[] = []
  const matches = results.filter(valid).sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''))
  for (const match of matches) {
    const links = new Map<string, Loot[]>()
    const openings = new Map(match.chests.map(opening => [opening.id, opening]))
    for (const item of match.items) {
      const opening = item.chestId ? openings.get(item.chestId) : undefined
      loot.push({ match, item, opening })
      if (!opening) continue
      const items = links.get(opening.id) ?? []
      items.push(item)
      links.set(opening.id, items)
    }
    for (const opening of match.chests) events.push({ match, opening, items: links.get(opening.id) ?? [] })
  }
  return { events, loot, matches }
}

export function exportJson(results: Result[], data: ReturnType<typeof report>, catalog: Catalog, meta: Metadata, labels: Map<string, string>) {
  const matches = results.map(match => ({
    ...match, cofresAbiertos: valid(match) ? match.chests.filter(chestOpened).length : null,
    squad: match.squad?.map(member => ({ ...member, localLabel: labels.get(memberKey(member, match)) })),
    items: match.items.map(item => {
      const { icon: _icon, ...metadata } = meta(item, match)
      return { ...item, metadata }
    }),
  }))
  saveFile('fortnite-replay-analysis.json', JSON.stringify({
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    tokenPirata: { fuente: 'catalogo-local', estado: catalog.rows.some(row => row.special === 'pirate-token')
      ? 'catalogo-importado' : 'desconocido',
      coincidenciasPlantilla: data.matches.reduce((total, match) => total +
        (match.treasures?.filter(prize => isPirateShopAccess(match.branch, prize.templateId)).length ?? 0), 0),
      partidasConDatos: data.matches.filter(match => match.treasures !== undefined).length,
    },
    escuadron: squadSummary(data.matches, data.events, labels),
    matches,
  }, null, 2), 'application/json')
}

export function exportCsv(results: Result[], data: ReturnType<typeof report>, meta: Metadata, labels: Map<string, string>) {
  const columns = ['tipo_registro', 'partida', 'estado', 'detalle', 'version', 'segundos', 'accion', 'id_dispensador', 'clase',
    'jugador', 'id_jugador_replay', 'grabador', 'atribucion', 'evidencia_evento', 'x', 'y', 'z',
    'id_objeto', 'nombre_catalogo', 'rareza_catalogo', 'cantidad', 'recogido', 'desde_contenedor',
    'evidencia_origen', 'premio_catalogo', 'rol_equipo', 'huella_cuenta', 'nombre_local']
  const dataColumns = columns.length
  columns.push('registro_partida', 'actor_objeto', 'datos_partida', 'nombres_partida',
    'cofres_abiertos', 'apertura_suministro_seg', 'suministro_abierto', 'suministro_genero_objetos', 'categoria_objeto', 'actor_origen', 'premio_desde_ruptura')
  const rows: Parameters<typeof csv>[0] = [columns]
  const add = (match: Result, row: typeof rows[number], extra: typeof rows[number] = []) =>
    rows.push([...Array.from({ length: dataColumns }, (_, i) => row[i]), match.key,
      ...Array.from({ length: columns.length - dataColumns - 1 }, (_, i) => extra[i])])
  for (const match of results) {
    const { chests: _chests, items: _items, squad: _squad, supplyDrops, gizmos, treasures, ...snapshot } = match
    add(match, ['partida', match.file, statusLabel[match.status], match.detail, match.branch],
      [undefined, JSON.stringify({ ...snapshot, supplyDrops: supplyDrops && [], gizmos: gizmos && [], treasures: treasures && [] }),
        undefined, valid(match) ? match.chests.filter(chestOpened).length : undefined])
  }
  for (const { match, opening } of data.events) {
    const member = memberOf(match, opening)
    add(match, [
      'dispensador', match.file, statusLabel[match.status], '', match.branch, opening.time, actionLabel[opening.action],
    opening.id, opening.type, opening.player, opening.playerId, opening.recorder, trustLabel[opening.attribution],
      opening.evidence, opening.position?.x, opening.position?.y, opening.position?.z,
      null, null, null, null, null, null, null, null, roles[opening.teamRole], member?.accountKey,
      member ? labels.get(memberKey(member, match)) : null,
    ])
  }
  for (const { match, opening, item } of data.loot) {
    const m = meta(item, match)
    const member = opening ? memberOf(match, opening) : undefined
    add(match, ['objeto', match.file, statusLabel[match.status], '', match.branch, item.observedAt, '', item.chestId,
      opening?.type, opening ? playerLabel(opening) : '', opening?.playerId, opening?.recorder, '', '',
      item.position?.x, item.position?.y, item.position?.z, item.itemId, m.name, m.rarity, item.stack, item.pickedUp,
      item.fromContainer, item.sourceEvidence, m.special, opening ? roles[opening.teamRole] : null,
      member?.accountKey, member ? labels.get(memberKey(member, match)) : null], [item.actor, undefined, undefined, undefined, undefined, undefined, undefined, m.category])
  }
  for (const match of data.matches) for (const member of match.squad ?? []) {
    const row: (string | number | boolean | null | undefined)[] = ['escuadron', match.file, statusLabel[match.status], '', match.branch]
    row[9] = member.alias; row[10] = member.playerId; row[11] = member.recorder; row[13] = member.evidence
    row[25] = member.recorder ? 'Grabador' : 'Compañero'; row[26] = member.accountKey
    row[27] = labels.get(memberKey(member, match))
    add(match, row, [undefined, undefined, JSON.stringify(member.displayNames ?? [])])
  }
  for (const match of data.matches) for (const drop of match.supplyDrops ?? []) {
    const row: typeof rows[number] = ['suministro', match.file, statusLabel[match.status], '', match.branch,
      drop.observedAt, '', drop.id, drop.type]
    row[13] = drop.opened ? 'Opened' : undefined
    row[14] = drop.position?.x
    row[15] = drop.position?.y
    row[16] = drop.position?.z
    add(match, row, [undefined, undefined, undefined, undefined, drop.openedAt, drop.opened, drop.spawnedPickups])
  }
  for (const match of data.matches) for (const gizmo of match.gizmos ?? []) {
    const row: typeof rows[number] = ['artilugio', match.file, statusLabel[match.status], '', match.branch,
      gizmo.observedAt, '', undefined, gizmo.class]
    row[13] = 'Actor replicado'
    row[17] = gizmo.itemId
    add(match, row, [gizmo.actor, undefined, undefined, undefined, undefined, undefined, undefined, gizmo.kind])
  }
  for (const match of data.matches) for (const prize of match.treasures ?? []) {
    const row: typeof rows[number] = ['premio_tesoro', match.file, statusLabel[match.status], '', match.branch, prize.observedAt,
      undefined, undefined, prize.sourceType, prize.player, prize.playerId]
    row[13] = prize.templateId ? 'bSuccess + PrizeTemplateId' : 'bSuccess'
    row[17] = prize.templateId
    row[24] = isPirateShopAccess(match.branch, prize.templateId) ? 'pirate-token' : undefined
    add(match, row, [prize.actor, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      prize.sourceActor, prize.fromDestruction])
  }
  saveFile('fortnite-replay-analysis.csv', csv(rows), 'text/csv;charset=utf-8')
}




