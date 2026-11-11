import type { Language } from './locales'
import type { GizmoKind, LootCategory } from './types'

// ItemName FText keys resolved against the game's Spanish locres, build 43.00 CL 59596594.
// These bundled images and names need no network access during replay analysis.
export const gameItems = [
  {
    "id": "WID_RelicExtractor",
    "kind": "extractor",
    "category": "gizmo",
    "name": {
      "es": "Extractor portátil",
      "en": "Portable Extractor"
    },
    "icon": "images/gizmos/wid_relicextractor.png"
  },
  {
    "id": "WID_LuckyLocator",
    "kind": "lucky-locator",
    "category": "gizmo",
    "name": {
      "es": "Localizador de la suerte",
      "en": "Lucky Locator"
    },
    "icon": "images/gizmos/wid_luckylocator.png"
  },
  {
    "id": "WID_SmugglerExtractionKey_Gizmo",
    "kind": "smuggler-key",
    "category": "gizmo",
    "name": {
      "es": "Acelerador de extracción",
      "en": "Extraction Accelerator"
    },
    "icon": "images/gizmos/wid_smugglerextractionkey_gizmo.png"
  },
  {
    "id": "WID_RelicFinder",
    "kind": "sprite-locator",
    "category": "gizmo",
    "name": {
      "es": "Localizador de espíritus",
      "en": "Sprite Locator"
    },
    "icon": "images/gizmos/wid_relicfinder.png"
  },
  {
    "id": "WID_FlameCeleb_Consumable_S43",
    "kind": "golden-firework",
    "category": "gizmo",
    "name": {
      "es": "Fuegos artificiales dorados",
      "en": "Golden Firework"
    },
    "icon": "images/gizmos/wid_flameceleb_consumable_s43.png"
  },
  {
    "id": "WID_RelicExtractor_Consumable",
    "kind": "extractor",
    "category": "extraction-consumable",
    "name": {
      "es": "Extractor portátil",
      "en": "Portable Extractor"
    },
    "icon": "images/gizmos/wid_relicextractor_consumable.png"
  },
  {
    "id": "WID_ExtractionSiteBooster",
    "kind": "site-booster",
    "category": "gizmo",
    "name": {
      "es": "Potenciador de lugar de extracción",
      "en": "Extraction Site Booster"
    },
    "icon": "images/gizmos/wid_extractionsitebooster.png"
  },
  {
    "id": "WID_ExtractionSiteBooster_Consumable",
    "kind": "site-booster",
    "category": "extraction-consumable",
    "name": {
      "es": "Potenciador de lugar de extracción",
      "en": "Extraction Site Booster"
    },
    "icon": "images/gizmos/wid_extractionsitebooster_consumable.png"
  },
  {
    "id": "WID_JunkFoodBucket_Gizmo",
    "kind": "snack-lantern",
    "category": "gizmo",
    "name": {
      "es": "Calabaza de picoteo",
      "en": "Snack-O'-Lantern"
    },
    "icon": "images/gizmos/wid_junkfoodbucket_gizmo.png"
  },
  {
    "id": "WID_LLamaSupplyDropRadioGizmo",
    "kind": "llama-drop",
    "category": "gizmo",
    "name": {
      "es": "Entrega de suministros de llama",
      "en": "Llama Supply Drop"
    },
    "icon": "images/gizmos/wid_llamasupplydropradiogizmo.png"
  },
  {
    "id": "WID_SpicyTaco_Gizmo",
    "kind": "spicy-taco",
    "category": "gizmo",
    "name": {
      "es": "Tacos picantes",
      "en": "Spicy Taco"
    },
    "icon": "images/gizmos/wid_spicytaco_gizmo.png"
  }
] satisfies {
  id: string
  kind: GizmoKind
  category: LootCategory
  name: Record<Language, string>
  icon: string
}[]
