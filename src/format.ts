import { translate } from './locales'
import type { Language } from './locales'
import { containerOf } from './containers'
import type { Opening, Position, Status } from './types'

export const num = (n: number) => n.toLocaleString('es-ES')
export const clock = (seconds?: number | null) => seconds == null ? '—' :
  `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
export const date = (iso?: string | null) => iso ? iso.replace('T', ' ').slice(0, 16) : '—'
export const basename = (path: string) => path.split(/[\\/]/).at(-1) ?? path
export const shortFile = (path: string) => basename(path).replace(/^UnsavedReplay-/, '').replace(/\.replay$/i, '')
export const playerLabel = (opening: Opening, language: Language = 'es') => opening.player ??
  (opening.playerId != null && !opening.recorder
    ? translate(language, 'Jugador #{id}', { id: String(opening.playerId) })
    : translate(language, opening.recorder ? 'Jugador que grabó' : 'Desconocido'))
export const playerKey = (opening: Opening, key: string) => opening.playerId != null ? [key, opening.playerId].join(':') : 'unknown'
export const actionLabel = { opened: 'Apertura', broken: 'Ruptura con botín posible', fired: 'Disparo' }
export const metricDescription = {
  chestOpened: 'Aperturas de cofres identificados y recogidas de pósteres de espíritus. Incluye cofres enterrados.',
  chestAverage: 'Media de aperturas de cofres, incluidas las partidas con cero aperturas.',
  opened: 'Aperturas de cualquier contenedor, incluidos cofres, cajas de munición y entregas.',
  broken: 'Contenedores destruidos con indicios de que pudieron soltar botín.',
  fired: 'Activaciones de cañones de botín que expulsan objetos.',
  activations: 'Suma de aperturas, rupturas y disparos de cañones de botín.',
  linked: 'Objetos con evidencia del dispensador que los generó.',
  supplies: 'Drops de suministros que aparecen en la grabación, estén abiertos o cerrados.',
  inferred: 'Acciones atribuidas a un jugador por indicios de la grabación, sin confirmación directa.',
} as const
export const trustLabel = { confirmed: 'Confirmado', inferred: 'Inferido', unknown: 'Desconocido' }
export const statusLabel: Record<Status, string> = {
  complete: 'Analizada', partial: 'Parcial', unsupported: 'No compatible', error: 'Error', duplicate: 'Duplicada',
}

export function typeLabel(type: string, language: Language = 'es') {
  const container = containerOf(type)
  return container.category === 'unknown' ? type : translate(language, container.label)
}

export const positionLabel = (p: Position | null) => p ? [p.x, p.y, p.z].map(x => Math.round(x)).join(' / ') : '—'

export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function csv(rows: (string | number | boolean | null | undefined)[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    const original = value == null ? '' : String(value)
    const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+@\-]|^[\r\n\t]/.test(original) ? "'" + original : original
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n')
}



