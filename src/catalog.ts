import { gameItems } from './gameItems'
import type { Language } from './locales'
import type { GizmoKind, Loot, LootCategory, Result } from './types'

export type Meta = { id: string; name?: string; rarity?: string; branch?: string; icon?: string; special?: 'pirate-token'; category?: LootCategory }
export type Catalog = { rows: Meta[]; icons: Map<string, string> }

export const lootCategories = {
  gizmo: 'Artilugio de la rueda',
  'extraction-consumable': 'Consumible de extracción',
} satisfies Record<LootCategory, string>

export const gizmoNames = {
  "extractor": "Extractor portátil",
  "lucky-locator": "Localizador de la suerte",
  "smuggler-key": "Acelerador de extracción",
  "sprite-locator": "Localizador de espíritus",
  "golden-firework": "Fuegos artificiales dorados",
  "site-booster": "Potenciador de lugar de extracción",
  "snack-lantern": "Calabaza de picoteo",
  "llama-drop": "Entrega de suministros de llama",
  "spicy-taco": "Tacos picantes",
} satisfies Record<GizmoKind, string>

export const gizmoIcons = Object.fromEntries(gameItems
  .filter(item => item.category === 'gizmo')
  .map(item => [item.kind, import.meta.env.BASE_URL + item.icon])) as Record<GizmoKind, string>

const extractionItems = new Map(gameItems.map(item => [
  '++Fortnite+Release-43.00\n' + item.id.toLowerCase(), item,
]))

export async function readCatalog(files: File[]): Promise<Catalog> {
  const rows: Meta[] = []
  const images: File[] = []
  for (const file of files) {
    if (/\.(png|webp|jpe?g|avif)$/i.test(file.name) && file.size <= 8 * 1024 ** 2) images.push(file)
    if (!/^(?:catalogo|catalog|items)\.json$/i.test(file.name) || file.size > 8 * 1024 ** 2) continue
    const input: unknown = JSON.parse(await file.text())
    if (!Array.isArray(input)) throw new Error(`${file.name} debe contener una lista de objetos.`)
    for (const item of input as Meta[]) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) continue
      rows.push({
        id: item.id,
        name: typeof item.name === 'string' ? item.name : undefined,
        rarity: typeof item.rarity === 'string' ? item.rarity : undefined,
        branch: typeof item.branch === 'string' ? item.branch : undefined,
        icon: typeof item.icon === 'string' ? item.icon : undefined,
        special: item.special === 'pirate-token' && typeof item.branch === 'string' && item.branch.trim()
          ? 'pirate-token' : undefined,
        category: item.category === 'gizmo' && typeof item.branch === 'string' && item.branch.trim()
          ? 'gizmo' : undefined,
      })
    }
  }
  if (images.length === 0 && rows.length === 0) throw new Error('No se encontraron imágenes compatibles ni un catálogo JSON.')
  const icons = new Map<string, string>()
  for (const image of images) {
    const key = image.name.toLowerCase()
    if (icons.has(key)) continue
    icons.set(key, URL.createObjectURL(image))
  }
  return { rows, icons }
}

export function catalogIndex(catalog: Catalog, language: Language = 'es') {
  const index = new Map(catalog.rows.map(row => [`${row.branch ?? ''}\n${row.id.toLowerCase()}`, row]))
  return (item: Loot, match: Result) => {
    const id = item.itemId.toLowerCase()
    const key = `${match.branch ?? ''}\n${id}`
    const row = index.get(key) ?? index.get(`\n${id}`)
    const known = extractionItems.get(key)
    const icon = row?.icon ? catalog.icons.get(row.icon.toLowerCase())
      : catalog.icons.size ? ['png', 'webp', 'jpg', 'jpeg', 'avif'].map(ext => catalog.icons.get(`${id}.${ext}`)).find(Boolean) : undefined
    return { name: row?.name ?? (known?.name ? known.name[language] : item.metadata?.name), rarity: row?.rarity ?? item.metadata?.rarity, icon: icon ?? (known ? import.meta.env.BASE_URL + known.icon : undefined),
      special: row?.special ?? item.metadata?.special, category: known?.category ?? row?.category ?? item.metadata?.category }
  }
}


