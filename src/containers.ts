import type { Opening } from './types'

export const categories = {
  chest: 'Cofres',
  ammo: 'Cajas de munición',
  cannon: 'Cañones de botín',
  supply: 'Entregas de suministros',
  other: 'Otros contenedores',
  unknown: 'Clases sin clasificar',
} as const
export type Category = keyof typeof categories
type Container = { category: Category; label: string }

// These classes were read from the 43.00 recordings. Keep the exact class in every
// row and leave unfamiliar blueprints unclassified until their mapping is verified.
const classes: Record<string, Container> = {
  Tiered_Chest_Athena: { category: 'chest', label: 'Cofre normal' },
  AlwaysSpawn_NormalChest: { category: 'chest', label: 'Cofre normal · aparición fija' },
  AlwaysSpawn_RareChest: { category: 'chest', label: 'Cofre raro · aparición fija' },
  Tiered_Chest_5_Child: { category: 'chest', label: 'Cofre de nivel 5' },
  B_TieredChest_Relics: { category: 'chest', label: 'Cofre de reliquias' },
  B_Delilah_TieredChest_Relics_Variant1: { category: 'chest', label: 'Cofre de reliquias · variante 1' },
  B_Delilah_TieredChest_Relics_Variant2: { category: 'chest', label: 'Cofre de reliquias · variante 2' },
  B_Athena_BuriedChest_Chest: { category: 'chest', label: 'Cofre enterrado' },
  B_Athena_BuriedChest_RelicFinder: { category: 'chest', label: 'Cofre enterrado · RelicFinder' },
  B_SpritePosters_Booty_Chest: { category: 'chest', label: 'Cofre de espíritu' },
  B_SpritePosters_Booty_Chest_Variant1: { category: 'chest', label: 'Cofre de espíritu · variante 1' },
  Tiered_Ammo_Athena: { category: 'ammo', label: 'Caja de munición' },
  Tiered_Short_Ammo_3_Parent: { category: 'ammo', label: 'Caja de munición baja' },
  BGA_LootCannon_StandardChest_Pirate: { category: 'cannon', label: 'Cañón de botín pirata' },
  BGA_LootCannonDuck_Child: { category: 'cannon', label: 'Cañón de botín · DuckRace' },
  AthenaSupplyDrop: { category: 'supply', label: 'Entrega de suministros' },
  AthenaSupplyDrop_PoolDust: { category: 'supply', label: 'Entrega de suministros · PoolDust' },
  AthenaSupplyDrop_Vault: { category: 'supply', label: 'Entrega de suministros · Vault' },
  FoodBox_Produce_Athena: { category: 'other', label: 'Caja de alimentos' },
  Barrel_FishingRod_Container_Athena: { category: 'other', label: 'Barril de cañas de pescar' },
}

export function containerOf(type: string): Container {
  const name = type.split('.').at(-1)?.replace(/_C$/, '') ?? type
  return Object.hasOwn(classes, name) ? classes[name] : { category: 'unknown', label: type }
}
export const chestOpened = (opening: Opening) => opening.action === 'opened' && containerOf(opening.type).category === 'chest'

