import { actionLabel, statusLabel, trustLabel } from './format'
import { roles } from './squad'
import type { DisplayName, GizmoObservation, Loot, Opening, Position, Result, SquadMember, Status, TreasureAward } from './types'

type Row = Record<string, unknown>
const MAX_REPORT = 256 * 1024 ** 2
const MAX_MATCHES = 10_000
const MAX_RECORDS = 1_000_000

const obj = (value: unknown): Row => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Registro de informe inválido.')
  return value as Row
}
const string = (value: unknown, max = 4096) => typeof value === 'string' && value.length <= max ? value : null
const required = (value: unknown) => {
  const text = string(value)
  if (!text) throw new Error('Falta un identificador o un nombre de archivo en el informe.')
  return text
}
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const boolean = (value: unknown) => typeof value === 'boolean' ? value : null
const list = (value: unknown, limit = MAX_RECORDS): unknown[] => {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Lista de registros inválida o demasiado grande.')
  return value
}
const enumValue = <T extends string>(value: unknown, labels: Record<T, string>, fallback: T): T =>
  typeof value === 'string' && Object.hasOwn(labels, value) ? value as T : fallback
const invert = <T extends string>(labels: Record<T, string>, value: string, fallback: T): T =>
  (Object.keys(labels) as T[]).find(key => labels[key] === value) ?? fallback

function pos(value: unknown): Position | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { x, y, z } = value as Row
  if ([x, y, z].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9)) return { x, y, z } as Position
  return null
}

function times(value: unknown) {
  const n = number(value)
  if (n == null || n < 0 || n > 86_400) throw new Error("Marca temporal inválida en el informe.")
  return n
}

function sanitizeOpening(value: unknown): Opening {
  const row = obj(value)
  if (typeof row.action !== "string" || !Object.hasOwn(actionLabel, row.action)) throw new Error("Acción de dispensador desconocida.")
  return {
    id: required(row.id), type: required(row.type), time: times(row.time), position: pos(row.position),
    player: string(row.player, 120), playerId: count(row.playerId), recorder: row.recorder === true,
    attribution: enumValue(row.attribution, trustLabel, 'unknown'), teamRole: enumValue(row.teamRole, roles, 'unknown'),
    action: enumValue(row.action, actionLabel, 'opened'), evidence: string(row.evidence) ?? 'Evidencia ausente en el informe',
  }
}

function sanitizeLoot(value: unknown, index: number, chests: Set<string>): Loot {
  const row = obj(value)
  const candidate = string(row.chestId)
  const sourceEvidence = string(row.sourceEvidence, 150)
  const chestId = candidate && sourceEvidence && chests.has(candidate) ? candidate : null
  const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? obj(row.metadata) : undefined
  return {
    actor: count(row.actor) ?? index + 1, itemId: required(row.itemId), observedAt: times(row.observedAt),
    position: pos(row.position), stack: count(row.stack), pickedUp: boolean(row.pickedUp), fromContainer: boolean(row.fromContainer),
    chestId, sourceEvidence: chestId ? sourceEvidence : null,
    metadata: meta ? {
      name: string(meta.name, 200) ?? undefined, rarity: string(meta.rarity, 80) ?? undefined,
      special: meta.special === 'pirate-token' ? 'pirate-token' : undefined,
      category: meta.category === 'gizmo' || meta.category === 'extraction-consumable' ? meta.category : undefined,
    } : undefined,
  }
}

function sanitizeMember(value: unknown): SquadMember {
  const row = obj(value)
  const playerId = count(row.playerId)
  if (playerId == null) throw new Error('Falta el identificador de un integrante del escuadrón.')
  const displayNames = row.displayNames == null ? [] : list(row.displayNames, 64).map(value => {
    const name = obj(value)
    return { name: required(name.name), observedAt: times(name.observedAt) } satisfies DisplayName
  })
  return {
    playerId, alias: string(row.alias, 120), recorder: row.recorder === true, accountKey: hex(row.accountKey, 64),
    displayNames, localLabel: string(row.localLabel, 120) ?? undefined,
    evidence: string(row.evidence) ?? 'Informe importado',
  }
}

function sanitizeGizmo(value: unknown): GizmoObservation {
  const row = obj(value)
  const actor = count(row.actor)
  const kind = row.kind
  if (actor == null || kind !== 'extractor' && kind !== 'lucky-locator' && kind !== 'smuggler-key')
    throw new Error('Artilugio sin actor o con tipo no compatible.')
  return { actor, kind, observedAt: times(row.observedAt), class: required(row.class), itemId: required(row.itemId) }
}

function sanitizeTreasure(value: unknown): TreasureAward {
  const row = obj(value)
  const actor = count(row.actor)
  if (actor == null || actor === 0) throw new Error('Premio del tesoro sin identificador de actor.')
  return { actor, observedAt: times(row.observedAt), templateId: string(row.templateId, 128),
    sourceActor: count(row.sourceActor), sourceType: string(row.sourceType, 512),
    playerId: count(row.playerId), player: string(row.player, 120), fromDestruction: boolean(row.fromDestruction) }
}

function hex(value: unknown, length: number) {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/i.test(value) ? value.toLowerCase() : null
}

function match(value: unknown): Result {
  const row = obj(value)
  if (typeof row.status !== 'string' || !Object.hasOwn(statusLabel, row.status)) throw new Error('Estado de partida desconocido.')
  const chests = list(row.chests, 100_000).map(sanitizeOpening)
  const ids = new Set(chests.map(opening => opening.id))
  if (ids.size !== chests.length) throw new Error('El informe repite identificadores de dispensadores dentro de una partida.')
  const items = list(row.items, 100_000).map((item, index) => sanitizeLoot(item, index, ids))
  if (new Set(items.map(item => item.actor)).size !== items.length) throw new Error('El informe repite identificadores de objetos.')
  const treasures = row.treasures == null ? undefined : list(row.treasures, 20_000).map(sanitizeTreasure)
  if (treasures && new Set(treasures.map(prize => prize.actor)).size !== treasures.length)
    throw new Error('El informe repite actores de premios del tesoro.')
  const schema = row.schema == null ? undefined : Object.fromEntries(Object.entries(obj(row.schema)).slice(0, 10_000)
    .map(([key, fields]) => [key, list(fields, 65_536).flatMap(field => string(field, 512) ?? [])]))
  return {
    key: string(row.key) ?? '', file: required(row.file), size: count(row.size) ?? 0, source: 'report',
    importKey: string(row.importKey, 128) ?? undefined, hash: hex(row.hash, 64) ?? undefined, guid: hex(row.guid, 32),
    status: row.status as Status, detail: string(row.detail), branch: string(row.branch, 120),
    engine: row.engine === 'rust' || row.engine === 'legacy' ? row.engine : undefined,
    build: count(row.build) ?? undefined, fileVersion: count(row.fileVersion) ?? undefined,
    networkVersion: count(row.networkVersion) ?? undefined, engineNetworkVersion: count(row.engineNetworkVersion) ?? undefined,
    durationMs: count(row.durationMs) ?? undefined, recordedAt: string(row.recordedAt, 32),
    encrypted: boolean(row.encrypted) ?? undefined, compressed: boolean(row.compressed) ?? undefined,
    frames: count(row.frames) ?? undefined, skippedPackets: count(row.skippedPackets) ?? undefined,
    chestActorsObserved: count(row.chestActorsObserved) ?? undefined, recorderName: string(row.recorderName, 120) ?? undefined,
    recorderTeam: count(row.recorderTeam), squadEvidence: string(row.squadEvidence, 120),
    supplyDrops: row.supplyDrops == null ? undefined : list(row.supplyDrops, 20_000).map(value => {
      const drop = obj(value)
      return { id: required(drop.id), type: required(drop.type), observedAt: times(drop.observedAt), opened: drop.opened === true,
        openedAt: drop.openedAt == null ? null : times(drop.openedAt), position: pos(drop.position), spawnedPickups: boolean(drop.spawnedPickups) }
    }),
    gizmos: row.gizmos == null ? undefined : list(row.gizmos, 20_000).map(sanitizeGizmo),
    treasures,
    squad: row.squad == null ? [] : list(row.squad, 512).map(sanitizeMember), chests, items, schema,
    events: row.events == null ? undefined : list(row.events, 200).flatMap(event => string(event) ?? []),
  }
}

export async function importReport(file: File): Promise<Result[]> {
  if (file.size > MAX_REPORT) throw new Error('El informe supera el límite de 256 MiB.')
  const bytes = await file.arrayBuffer()
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const matches = /\.csv$/i.test(file.name) ? readCsv(text) : readJson(text)
  if (!matches.length) throw new Error('El informe no contiene partidas.')
  if (matches.some(entry => !entry.guid && !entry.hash && !entry.importKey)) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
    matches.forEach((entry, i) => { entry.importKey ??= `report:${fingerprint}:${i}` })
  }
  return matches
}

function readJson(text: string) {
  const data = obj(JSON.parse(text))
  if (data.schemaVersion !== 1) throw new Error('Versión de informe JSON no compatible.')
  return list(data.matches, MAX_MATCHES).map(match)
}

function* csvRecords(text: string): Generator<string[], void, void> {
  let i = 0
  let records = 0
  while (i < text.length) {
    const row: string[] = []
    while (true) {
      let value: string
      if (text[i] === '"') {
        let start = ++i
        const parts: string[] = []
        while (true) {
          const quote = text.indexOf('"', i)
          if (quote < 0) throw new Error('Comillas sin cerrar en el CSV.')
          i = quote + 1
          if (text[i] !== '"') {
            parts.push(text.slice(start, quote))
            break
          }
          parts.push(text.slice(start, quote + 1))
          start = ++i
        }
        value = parts.join('')
      } else {
        const start = i
        while (i < text.length && !',\r\n'.includes(text[i])) i++
        value = text.slice(start, i)
      }
      row.push(value.startsWith("'") && /^[\s\uFEFF]*[=+@\-]|^[\r\n\t]/.test(value.slice(1)) ? value.slice(1) : value)
      if (row.length > 128) throw new Error('Demasiadas columnas en el CSV.')
      if (text[i] !== ',') break
      i++
    }
    if (text[i] === '\r') { i++; if (text[i] === '\n') i++ }
    else if (text[i] === '\n') i++
    else if (i !== text.length) throw new Error('Separador CSV inválido.')
    if (row.length === 1 && !row[0]) continue
    if (++records > MAX_RECORDS) throw new Error('El CSV supera el límite de un millón de filas.')
    yield row
  }
}

function readCsv(text: string) {
  const records = csvRecords(text)
  const header = records.next().value
  if (!header || !['tipo_registro', 'partida', 'estado'].every(name => header.includes(name)))
    throw new Error('El CSV debe ser un informe exportado por Fortnite Chest Analyzer.')
  const column = new Map(header.map((name, index) => [name, index]))
  const drafts: Row[] = []
  const byId = new Map<string, Row>()
  for (const row of records) {
    const get = (name: string) => row[column.get(name) ?? -1] ?? ''
    const n = (name: string) => get(name) === '' ? null : number(Number(get(name)))
    const b = (name: string) => get(name) === 'true' ? true : get(name) === 'false' ? false : null
    const kind = get('tipo_registro')
    const file = get('partida')
    const id = get('registro_partida') || file
    if (kind === 'partida') {
      if (drafts.length >= MAX_MATCHES) throw new Error('Demasiadas partidas en el CSV.')
      const status = invert<Status>(statusLabel, get('estado'), 'unsupported')
      const snapshot = get('datos_partida') ? obj(JSON.parse(get('datos_partida'))) : {}
      const draft = { ...snapshot, file, status, detail: get('detalle') || null, branch: get('version') || null,
        chests: [], items: [], squad: [] }
      drafts.push(draft)
      const previous = byId.get(id)
      if (previous && status !== 'duplicate' && previous.status !== 'duplicate')
        throw new Error('Varias partidas del CSV antiguo comparten el mismo nombre. Usa la exportación JSON para distinguirlas.')
      if (!previous || previous.status === 'duplicate') byId.set(id, draft)
      continue
    }
    const draft = byId.get(id)
    if (!draft) throw new Error('Una fila del CSV no tiene su partida asociada.')
    const position = { x: n('x'), y: n('y'), z: n('z') }
    if (kind === 'dispensador') (draft.chests as Row[]).push({
      id: get('id_dispensador'), type: get('clase'), time: n('segundos'), position,
      player: get('jugador') || null, playerId: n('id_jugador_replay'), recorder: b('grabador'),
      attribution: invert(trustLabel, get('atribucion'), 'unknown'), evidence: get('evidencia_evento'),
      action: invert(actionLabel as Record<string, string>, get('accion'), ''), teamRole: invert(roles, get('rol_equipo'), 'unknown'),
    })
    else if (kind === 'objeto') (draft.items as Row[]).push({
      actor: n('actor_objeto'), itemId: get('id_objeto'), observedAt: n('segundos'), position, stack: n('cantidad'),
      pickedUp: b('recogido'), fromContainer: b('desde_contenedor'), chestId: get('id_dispensador'),
      sourceEvidence: get('evidencia_origen'), metadata: {
        name: get('nombre_catalogo') || undefined, rarity: get('rareza_catalogo') || undefined, special: get('premio_catalogo'),
        category: get('categoria_objeto'),
      },
    })
    else if (kind === 'suministro') ((draft.supplyDrops ??= []) as Row[]).push({
      id: get('id_dispensador'), type: get('clase'), observedAt: n('segundos'), position,
      openedAt: n('apertura_suministro_seg'), opened: b('suministro_abierto'), spawnedPickups: b('suministro_genero_objetos'),
    })
    else if (kind === 'artilugio') ((draft.gizmos ??= []) as Row[]).push({
      actor: n('actor_objeto'), class: get('clase'), observedAt: n('segundos'),
      itemId: get('id_objeto'), kind: get('categoria_objeto'),
    })
    else if (kind === 'premio_tesoro') ((draft.treasures ??= []) as Row[]).push({
      actor: n('actor_objeto'), observedAt: n('segundos'), templateId: get('id_objeto') || null,
      sourceActor: n('actor_origen'), sourceType: get('clase') || null,
      playerId: n('id_jugador_replay'), player: get('jugador') || null, fromDestruction: b('premio_desde_ruptura'),
    })
    else if (kind === 'escuadron') (draft.squad as Row[]).push({
      playerId: n('id_jugador_replay'), alias: get('jugador'), recorder: b('grabador'),
      accountKey: get('huella_cuenta'), evidence: get('evidencia_evento'), localLabel: get('nombre_local'),
      displayNames: get('nombres_partida') ? JSON.parse(get('nombres_partida')) : [],
    })
    else throw new Error('Tipo de fila CSV desconocido.')
  }
  return drafts.map(match)
}





