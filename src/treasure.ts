const treasureBranch = '++Fortnite+Release-43.00'

// Fortnite's 43.00 DelilahTreasureHuntGameplay asset defines these reward templates.
const templateNames = new Map([
  ['delilahprize:pirateaccount', 'Pirate Shop Access'],
  ['delilahprize:dpid_item15', 'Mochila Lil’ Uzi Crew'],
  ['delilahprize:dpid_item16', 'Pista de improvisación London'],
])

export function isPirateShopAccess(branch?: string | null, template?: string | null) {
  return branch === treasureBranch && template?.toLowerCase() === 'delilahprize:pirateaccount'
}

export function treasureName(branch?: string | null, template?: string | null) {
  return branch === treasureBranch && template ? templateNames.get(template.toLowerCase()) : undefined
}
