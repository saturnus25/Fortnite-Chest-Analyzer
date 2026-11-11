export type Status = 'complete' | 'partial' | 'unsupported' | 'error' | 'duplicate'
export type Position = { x: number; y: number; z: number }
export type Opening = {
  id: string; type: string; time: number; position: Position | null
  playerId: number | null; player: string | null; recorder: boolean
  attribution: 'confirmed' | 'inferred' | 'unknown'
  teamRole: 'recorder' | 'squad' | 'other' | 'unknown'
  action: 'opened' | 'broken' | 'fired'; evidence: string
}
export type LootCategory = 'gizmo' | 'extraction-consumable'
export type Loot = {
  actor: number; itemId: string; observedAt: number; position: Position | null
  stack: number | null; pickedUp: boolean | null; fromContainer: boolean | null
  chestId: string | null; sourceEvidence: string | null
  metadata?: { name?: string; rarity?: string; special?: 'pirate-token'; category?: LootCategory }
}
export type DisplayName = { name: string; observedAt: number }
export type SquadMember = {
  playerId: number; alias: string | null; recorder: boolean; accountKey: string | null; evidence: string; displayNames?: DisplayName[]; localLabel?: string
}
export type SupplyDrop = {
  id: string; type: string; observedAt: number; opened: boolean; openedAt: number | null
  position: Position | null; spawnedPickups: boolean | null
}
export type GizmoKind = 'extractor' | 'lucky-locator' | 'smuggler-key' | 'sprite-locator'
  | 'golden-firework' | 'site-booster' | 'snack-lantern' | 'llama-drop' | 'spicy-taco'
export type GizmoObservation = { actor: number; observedAt: number; class: string; itemId: string; kind: GizmoKind }
export type TreasureAward = {
  actor: number; observedAt: number; templateId: string | null
  sourceActor: number | null; sourceType: string | null
  playerId: number | null; player: string | null; fromDestruction: boolean | null
}
export type ContainerCounts = {
  detected: number; opened: number | null; destroyed: number | null; destructionObserved: number
  openedBySquad?: number; openedByOther?: number
}
export type Analysis = {
  status: Status; detail: string | null; engine?: 'rust' | 'legacy'; legacyRequired?: boolean
  branch?: string | null; build?: number; fileVersion?: number; networkVersion?: number
  engineNetworkVersion?: number; guid?: string | null; durationMs?: number
  recordedAt?: string | null; encrypted?: boolean; compressed?: boolean
  frames?: number; skippedPackets?: number; chestActorsObserved?: number; recorderName?: string
  squad?: SquadMember[]; squadEvidence?: string | null; recorderTeam?: number | null
  chests: Opening[]; items: Loot[]; containers?: Record<string, ContainerCounts>; supplyDrops?: SupplyDrop[]; gizmos?: GizmoObservation[]; treasures?: TreasureAward[]; schema?: Record<string, string[]>; events?: string[]
}
export type Result = Analysis & { key: string; file: string; size: number; hash?: string; source?: 'report'; importKey?: string }
export type Input = { file: File; path: string }
export type Job =
  | { command: 'report'; file: File }
  | { command: 'list'; file: File; sourceId: string }
  | { command: 'replay'; file: File; entry?: number; sourceId?: string; knownHashes: string[]; base: string }
export type ZipEntry = { index: number; path: string }
export type WorkerReply =
  | { result: Analysis; hash: string; size: number }
  | { entries: ZipEntry[] }
  | { report: Result[] }
  | { error: string }






