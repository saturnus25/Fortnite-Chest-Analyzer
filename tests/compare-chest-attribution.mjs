import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

const [baselineFile, probeFile] = process.argv.slice(2)
if (!baselineFile || !probeFile) throw new Error('Usage: node tests/compare-chest-attribution.mjs baseline.jsonl probe.jsonl')

const load = async file => (await readFile(file, 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
const baseline = await load(baselineFile)
const observed = await load(probeFile)
const chestTypes = /^(?:Tiered_Chest_Athena|AlwaysSpawn_NormalChest|AlwaysSpawn_RareChest|Tiered_Chest_5_Child|B_TieredChest_Relics|B_Delilah_TieredChest_Relics_Variant[123]|B_Athena_BuriedChest_(?:Chest|RelicFinder))$/
const isTeam = event => event.teamRole === 'recorder' || event.teamRole === 'squad'
const count = (items, test) => items.filter(test).length
assert.equal(observed.length, baseline.length)

function summarize(matches) {
  const events = matches.flatMap(match => match.chests).filter(event => chestTypes.test(event.type))
  return {
    analyzed: count(matches, match => match.status === 'complete' || match.status === 'partial'),
    opened: count(events, event => event.action === 'opened'),
    broken: count(events, event => event.action === 'broken'),
    teamOpened: count(events, event => event.action === 'opened' && isTeam(event)),
    teamBroken: count(events, event => event.action === 'broken' && isTeam(event)),
    destroyedWithoutOpening: matches.reduce((sum, match) => sum + Object.entries(match.containers)
      .filter(([type]) => chestTypes.test(type))
      .reduce((n, [, counts]) => n + (counts.destroyedWithoutOpening ?? 0), 0), 0),
    duplicateIds: matches.reduce((sum, match) => sum + match.chests.length - new Set(match.chests.map(event => event.id)).size, 0),
  }
}

const comparisons = observed.map(({ chestProbe, ...result }, index) => {
  assert.equal(result.guid, baseline[index].guid, `Different replay at line ${index + 1}`)
  assert.ok(chestProbe, `Missing probe at line ${index + 1}`)
  return { chestProbe, result }
})
const cases = comparisons.flatMap(entry => entry.chestProbe.actors).filter(actor => chestTypes.test(actor.kind))
const existing = new Map()
const evidence = comparisons.reduce((fields, entry) => {
  for (const [field, total] of Object.entries(entry.chestProbe.fields)) fields[field] = (fields[field] ?? 0) + total
  return fields
}, {})
for (const actor of cases) existing.set(actor.assessment, (existing.get(actor.assessment) ?? 0) + 1)
console.log(JSON.stringify({
  baseline: summarize(baseline), observed: summarize(observed),
  changedReplays: count(comparisons, ({ result }, index) => !isDeepStrictEqual(result, baseline[index])),
  assessments: Object.fromEntries(existing),
  unresolvedWithDirectHit: count(cases, actor => actor.unassigned && actor.direct.length > 0),
  unresolvedWithLinkedLoot: count(cases, actor => actor.unassigned && actor.linkedLoot > 0),
  unresolvedWithParent: count(cases, actor => actor.unassigned && actor.parent != null),
  breakMatchesWithFullStateMarkers: count(cases, actor => actor.action === 'broken' && actor.state.resent && actor.state.openedChannel),
  truncatedReplays: count(comparisons, entry => entry.chestProbe.truncated),
  fields: evidence,
}, null, 2))
