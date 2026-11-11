import type { Opening } from './types'

export const categories = {
  chest: 'Cofres',
  poster: 'Pósteres de espíritus',
  ammo: 'Cajas de munición',
  cannon: 'Cañones de botín',
  supply: 'Entregas de suministros',
  other: 'Otros contenedores',
  unknown: 'Clases sin clasificar',
} as const
export type Category = keyof typeof categories
type Container = { category: Category; label: string; fixed?: boolean; activityLabel?: string; image?: string }

// These classes were read from the 43.00 recordings. Keep the exact class in every
// row and leave unfamiliar blueprints unclassified until their mapping is verified.
const classes: Record<string, Container> = {
  Tiered_Chest_Athena: { category: 'chest', label: 'Cofre normal', activityLabel: 'Cofre normal · aparición variable', image: 'chest' },
  AlwaysSpawn_NormalChest: { category: 'chest', label: 'Cofre normal · aparición fija', fixed: true, image: 'chest' },
  Tiered_Chest_5_Child: { category: 'chest', label: 'Cofre raro', activityLabel: 'Cofre raro · aparición variable', image: 'rare' },
  AlwaysSpawn_RareChest: { category: 'chest', label: 'Cofre raro · aparición fija', fixed: true, image: 'rare' },
  B_TieredChest_Relics: { category: 'chest', label: 'Cofre de reliquias', activityLabel: 'Cofres de reliquias · todas las variantes', image: 'relic' },
  B_Delilah_TieredChest_Relics_Variant1: { category: 'chest', label: 'Cofre de reliquias · variante 1', activityLabel: 'Cofres de reliquias · todas las variantes', image: 'relic-jeweled' },
  B_Delilah_TieredChest_Relics_Variant2: { category: 'chest', label: 'Cofre de reliquias · variante 2', activityLabel: 'Cofres de reliquias · todas las variantes', image: 'relic-cursed' },
  B_Delilah_TieredChest_Relics_Variant3: { category: 'chest', label: 'Cofre de reliquias · variante 3', activityLabel: 'Cofres de reliquias · todas las variantes', image: 'relic-liquid-gold' },
  B_Athena_BuriedChest_Chest: { category: 'chest', label: 'Cofre enterrado', image: 'chest' },
  B_Athena_BuriedChest_RelicFinder: { category: 'chest', label: 'Cofre enterrado de espíritu', image: 'relic' },
  B_SpritePosters_Booty_Chest: { category: 'poster', label: 'Póster de espíritu', image: 'poster' },
  B_SpritePosters_Booty_Chest_Variant1: { category: 'poster', label: 'Póster de espíritu · variante 1', image: 'poster' },
  Tiered_Ammo_Athena: { category: 'ammo', label: 'Caja de munición', image: 'ammo' },
  Tiered_Short_Ammo_3_Parent: { category: 'ammo', label: 'Caja de munición baja' },
  Athena_Prop_Recreation_Cooler: { category: 'other', label: 'Nevera' },
  Athena_Prop_Recreation_Cooler_RandomColor: { category: 'other', label: 'Nevera · variante de color' },
  Athena_Prop_Utility_ToolBox_02: { category: 'other', label: 'Caja de herramientas' },
  Athena_Prop_Commerce_CashRegister: { category: 'other', label: 'Caja registradora' },
  BGA_LootCannon_StandardChest_Pirate: { category: 'cannon', label: 'Cañón de botín pirata' },
  BGA_LootCannonDuck_Child: { category: 'cannon', label: 'Cañón de botín · DuckRace' },
  AthenaSupplyDrop: { category: 'supply', label: 'Entrega de suministros', image: 'supply' },
  AthenaSupplyDrop_PoolDust: { category: 'supply', label: 'Entrega de suministros · PoolDust', image: 'supply' },
  AthenaSupplyDrop_Vault: { category: 'supply', label: 'Entrega de suministros · Vault', image: 'supply' },
  FoodBox_Produce_Athena: { category: 'other', label: 'Caja de alimentos', image: 'food' },
  Barrel_FishingRod_Container_Athena: { category: 'other', label: 'Barril de cañas de pescar', image: 'barrel' },
}

export const chestActivityLabels = [...new Set(Object.values(classes)
  .filter(container => container.category === 'chest')
  .map(container => container.activityLabel ?? container.label))]

export function containerOf(type: string): Container {
  const name = type.split('.').at(-1)?.replace(/_C$/, '') ?? type
  return Object.hasOwn(classes, name) ? classes[name] : { category: 'unknown', label: type }
}
// Picking up a Sprite Poster counts as an opening under the project's counting rule.
export const chestOpened = (opening: Opening) => opening.action === 'opened'
  && ['chest', 'poster'].includes(containerOf(opening.type).category)

