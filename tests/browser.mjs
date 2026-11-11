import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'

const root = process.cwd()
const work = resolve(root, '.research')
const demos = resolve(process.env.REPLAY_SAMPLES ?? 'Demos')
const samples = (await readdir(demos)).filter(file => file.endsWith('.replay')).sort()
const edge = process.env.REPLAY_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
await mkdir(work, { recursive: true })
const browser = await chromium.launchPersistentContext(await mkdtemp(resolve(work, 'browser-profile-')), {
  executablePath: edge, locale: 'es-ES', headless: true, timeout: 15000, viewport: { width: 1440, height: 1000 },
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  let workerCount = 0
  page.on('worker', () => workerCount++)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 12 })
    Object.defineProperty(navigator, 'deviceMemory', { value: 8 })
  })
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) }); page.on('requestfailed', req => console.error('request failed', req.url(), req.failure()))
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  const external = []
  const url = new URL(process.env.REPLAY_URL ?? 'http://127.0.0.1:5182/')
  await page.route('**/*', route => {
    const request = new URL(route.request().url())
    if (request.origin === url.origin || ['blob:', 'data:'].includes(request.protocol)) return route.continue()
    external.push(request.origin)
    return route.abort()
  })
  await page.goto(url.href)
  await page.getByRole('heading', { name: 'Fortnite Chest Analyzer' }).waitFor()
  const csvPath = resolve(work, 'browser-export.csv')
  const all = process.argv.includes('--all')
  if (all) {
    await page.getByTestId('folder-input').setInputFiles(demos)
    await page.getByRole('status').filter({ hasText: '100 archivos procesados' }).waitFor({ timeout: 900_000 })
  } else {
    const filename = samples[0]
    const replay = await readFile(resolve(demos, filename))
    const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false })
    await zip.add('nivel/subcarpeta/duplicado.replay', new Uint8ArrayReader(replay), { level: 0 })
    await zip.add('nivel/roto.replay', new Uint8ArrayReader(new Uint8Array(35)), { level: 0 })
    await zip.add('nivel/otra-partida.replay', new Uint8ArrayReader(await readFile(resolve(demos, samples[1]))), { level: 0 })
    const zipPath = resolve(work, 'fixture.zip')
    await writeFile(zipPath, await zip.close())
    await page.getByTestId('file-input').setInputFiles([resolve(demos, filename), zipPath])
    await page.getByRole('status').filter({ hasText: '4 archivos procesados' }).waitFor({ timeout: 160_000 }).catch(async error => { console.error(await page.locator('body').innerText()); throw error })
    await page.getByRole('button', { name: 'Partidas', exact: true }).click()
    await page.getByText('Duplicada', { exact: true }).waitFor({ timeout: 5_000 })
    await page.getByText('Error', { exact: true }).waitFor()
    await page.getByRole('button', { name: filename.replace('UnsavedReplay-', '').replace('.replay', ''), exact: true }).click()
    await page.getByRole('button', { name: 'Ver dispensadores' }).click()
    await page.getByLabel('Acción').selectOption('fired')
    await page.getByRole('cell', { name: /SpawnedPickupLoot/ }).first().waitFor({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Botín', exact: true }).click()
    await page.getByRole('cell', { name: /bTossedFromContainer|SpawnedPickupLoot/ }).first().waitFor()
    await page.getByLabel('Origen').selectOption('unlinked')
    await page.getByRole('cell', { name: /Contenedor indeterminado|Desconocido/ }).first().waitFor()
    await page.getByRole('button', { name: 'Escuadrón', exact: true }).click()
    assert.equal(await page.locator('tbody tr').count(), 4)
    await page.getByLabel('Partida').selectOption('')
    assert.equal(await page.locator('tbody tr').count(), 5)
    assert(await page.getByRole('columnheader', { name: 'Nombres registrados' }).isVisible())
    const guide = page.getByText('Qué significa cada columna', { exact: true })
    await guide.click()
    await page.getByText('Contenedores destruidos con indicios de que pudieron soltar botín.').waitFor()
    await guide.click()
    const sortable = ['Partidas', 'Cofres abiertos', 'Todas las aperturas', 'Rupturas', 'Disparos', 'Botín vinculado', 'Inferidos']
    for (const [index, label] of sortable.entries()) {
      const button = page.getByRole('table').getByRole('button', { name: label, exact: true })
      const column = page.getByRole('columnheader', { name: label, exact: true })
      for (const direction of ['descending', 'ascending']) {
        await button.click()
        assert.equal(await column.getAttribute('aria-sort'), direction)
        assert.equal(await page.locator('th[aria-sort]').count(), 1)
        const values = (await page.locator(`tbody td:nth-child(${index + 3})`).allTextContents())
          .map(text => Number(text.replace(/\D/g, '')))
        const sign = direction === 'ascending' ? 1 : -1
        assert.deepEqual(values, [...values].sort((a, b) => sign * (a - b)))
      }
    }
    const alias = page.getByRole('textbox', { name: /Nombre local de/ }).nth(1)
    await alias.fill('Compañero de prueba')
    await alias.press('Enter')
    await page.getByLabel('Nombre local de Compañero de prueba', { exact: true }).waitFor()
    await page.evaluate(() => localStorage.removeItem('fortnite-replay:aliases'))
    const downloadCsv = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV', exact: true }).click()
    const csvOutput = await downloadCsv
    assert.equal(csvOutput.suggestedFilename(), 'fortnite-replay-analysis.csv')
    await csvOutput.saveAs(csvPath)
  }
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  const output = await downloading
  const file = resolve(work, all ? 'browser-all.json' : 'browser-result.json')
  await output.saveAs(file)
  const data = JSON.parse(await readFile(file, 'utf8'))
  const usable = data.matches.filter(match => ['complete', 'partial'].includes(match.status))
  console.log(JSON.stringify({ matches: data.matches.length, usable: usable.length,
    statuses: data.matches.map(match => ({ status: match.status, detail: match.detail })).slice(0, 6),
    events: usable.flatMap(match => match.chests).length,
    linked: usable.flatMap(match => match.items).filter(item => item.chestId).length }))
  assert(usable.length >= 2)
  assert(workerCount >= 2)
  assert(usable.every(match => match.engine === 'rust'))
  const containerCounts = usable.flatMap(match => Object.values(match.containers))
  assert(containerCounts.some(row => row.opened != null && row.detected > row.opened))
  assert(containerCounts.some(row => row.destroyed > 0))
  assert(containerCounts.every(row => (row.opened === null || row.opened <= row.detected) && row.destructionObserved <= row.detected
    && (row.destroyed === null ? row.destructionObserved === 0 : row.destroyed <= row.destructionObserved)))
  assert(usable.some(match => match.supplyDrops.some(drop => drop.type.startsWith('AthenaSupplyDrop'))))
  assert(usable.every(match => match.squad.every(member => member.displayNames.length > 0)))
  if (all) {
    assert(data.escuadron.members.some(member => member.names.length > 1))
    await page.getByRole('heading', { name: 'Contenedores por clase' }).waitFor()
    const gizmoPanel = page.getByRole('heading', { name: 'Artilugios · Evidencia de recompensa' }).locator('xpath=ancestor::section')
    await gizmoPanel.getByRole('row').filter({ hasText: /Extractor portátil.*22.*No determinado/ }).waitFor()
    await gizmoPanel.screenshot({ path: resolve(work, 'gizmos-localized.png') })
    const rewards = usable.flatMap(match => match.treasures)
    assert.deepEqual(rewards.map(reward => reward.templateId).sort(), ['DelilahPrize:dpid_item15', 'DelilahPrize:dpid_item16'])
    assert(rewards.every(reward => reward.sourceActor && reward.playerId))
    assert.equal(data.tokenPirata.coincidenciasPlantilla, 0)
    await page.getByText('Ver premios observados (2)', { exact: true }).click()
    await page.getByText('DelilahPrize:dpid_item15', { exact: true }).waitFor()
    await page.getByText('DelilahPrize:dpid_item16', { exact: true }).waitFor()
    const gizmos = usable.flatMap(match => match.gizmos)
    assert(gizmos.some(row => row.class === 'B_RelicExtractor_C'))
    assert(gizmos.some(row => row.class === 'B_LuckyLocator_C'))
    assert(usable.some(match => match.items.some(item => item.itemId === 'WID_RelicExtractor_Consumable'
      && item.chestId && item.metadata.category === 'extraction-consumable')))
    await page.getByRole('button', { name: /Artilugios y extractores/ }).click()
    await page.getByRole('heading', { name: 'Actores de artilugios observados' }).waitFor()
    await page.getByRole('cell', { name: 'B_RelicExtractor_C', exact: true }).first().waitFor()
    await page.getByRole('cell', { name: /WID_RelicExtractor_Consumable/ }).first().waitFor()
    await page.getByRole('textbox', { name: 'Objeto', exact: true }).fill('WID_LuckyLocator')
    await page.getByRole('cell', { name: 'B_LuckyLocator_C', exact: true }).first().waitFor()
    assert.equal(await page.getByRole('cell', { name: 'B_RelicExtractor_C', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Escuadrón', exact: true }).click()
    const next = page.getByRole('button', { name: 'Página siguiente' })
    const previous = page.getByRole('button', { name: 'Página anterior' })
    await next.click()
    assert(await previous.isEnabled())
    await page.getByRole('button', { name: 'Cofres abiertos', exact: true }).click()
    assert(await previous.isDisabled())
    const first = await page.locator('tbody tr').first().locator('td').nth(3).innerText()
    assert.equal(Number(first.replace(/\D/g, '')), Math.max(...data.escuadron.members.map(member => member.chestOpened)))
  }
  assert(usable.some(match => match.squad.length === 4))
  assert(usable.some(match => match.chests.some(event => event.teamRole === 'squad')))
  const { totals, members } = data.escuadron
  assert.equal(totals.opened, members.reduce((count, member) => count + member.opened, 0))
  assert(members.some(member => member.matches >= 2 && member.stable && !member.recorder))
  assert(usable.some(match => match.chests.some(event => event.action === 'fired')))
  assert(usable.some(match => match.items.some(item => item.sourceEvidence === 'SpawnedPickupLoot')))
  assert(usable.every(match => match.items.every(item => !item.chestId || item.sourceEvidence)))
  if (!all) {
    await page.getByRole('button', { name: 'Resumen', exact: true }).click()
    await page.getByText('Cofres por partida', { exact: true }).waitFor()
    await page.getByText('Media de aperturas de cofres, incluidas las partidas con cero aperturas.').waitFor()
    await page.getByText('Mi escuadrón incluye las acciones atribuidas a ti o a tus compañeros.').waitFor()
    await page.getByText('Qué significan las aperturas, rupturas y disparos', { exact: true }).click()
    await page.getByText('Activaciones de cañones de botín que expulsan objetos.').waitFor()
    await page.getByRole('button', { name: 'Todo el replay', exact: true }).click()
    await page.getByText(/Todo el replay incluye lo que captó la grabación/).waitFor()
    await page.getByRole('button', { name: /Entregas de suministros\. Aperturas/ }).click()
    await page.getByRole('heading', { name: 'Entregas observadas en el replay' }).waitFor()
    await page.getByLabel('Idioma').selectOption('en')
    assert.equal(await page.locator('html').getAttribute('lang'), 'en')
    await page.getByRole('heading', { name: 'Supply drops observed in the replay' }).waitFor()
    await page.getByRole('status').filter({ hasText: '4 files processed' }).waitFor()
    await page.getByRole('button', { name: 'Squad', exact: true }).click()
    await page.getByRole('button', { name: 'Chests opened', exact: true }).click()
    assert.equal(await page.getByRole('columnheader', { name: 'Chests opened' }).getAttribute('aria-sort'), 'descending')
    await page.getByLabel('Language').selectOption('es')
    assert.equal(await page.getByRole('columnheader', { name: 'Cofres abiertos' }).getAttribute('aria-sort'), 'descending')
    assert.equal(await page.locator('tbody tr').count(), 5)
    await page.getByLabel('Idioma').selectOption('en')
    await page.reload()
    assert.equal(await page.getByLabel('Language').inputValue(), 'en')
    await page.getByLabel('Language').selectOption('es')
    for (const imported of [file, csvPath]) {
      await page.reload()
      await page.getByTestId('file-input').setInputFiles(imported)
      await page.getByRole('status').filter({ hasText: '1 archivo procesado' }).waitFor()
      const reexporting = page.waitForEvent('download')
      await page.getByRole('button', { name: 'JSON', exact: true }).click()
      const roundTrip = JSON.parse(await readFile(await (await reexporting).path(), 'utf8'))
      assert.deepEqual(roundTrip.escuadron.totals, data.escuadron.totals)
      const importedMatches = roundTrip.matches.filter(match => ['complete', 'partial'].includes(match.status))
      assert.equal(importedMatches.length, usable.length)
      for (const [index, match] of importedMatches.entries()) {
        const original = usable[index]
        assert.equal(match.source, 'report')
        assert.equal(match.guid.toLowerCase(), original.guid.toLowerCase())
        assert.deepEqual(match.chests, original.chests)
        assert.deepEqual(match.supplyDrops, original.supplyDrops)
        assert.deepEqual(match.containers, original.containers)
        assert.deepEqual(match.gizmos, original.gizmos)
        assert.deepEqual(match.squad.map(member => member.displayNames), original.squad.map(member => member.displayNames))
        assert.deepEqual(match.items, original.items)
      }
      await page.getByTestId('file-input').setInputFiles(imported === file ? csvPath : file)
      await page.getByRole('status').filter({ hasText: 'duplicados excluidos' }).waitFor()
      assert.match(await page.getByText('Resumen de partidas').locator('..').locator('..').innerText(), /2 partidas/)
    }
  }
  if (!all) {
    const branch = '++Fortnite+Release-43.00'
    const template = 'DelilahPrize:PirateAccount'
    const fixture = { schemaVersion: 1, matches: [
      { file: 'Synthetic 43.00.replay', status: 'complete', branch, chests: [], items: [], treasures: [
        { actor: 1, observedAt: 20, templateId: template },
        { actor: 2, observedAt: 21, templateId: template + '_Other' },
        { actor: 4, observedAt: 25, templateId: 'DelilahPrize:dpid_item10' },
      ] },
      { file: 'Synthetic other version.replay', status: 'complete', branch: '++Fortnite+Release-44.00', chests: [], items: [],
        treasures: [{ actor: 3, observedAt: 22, templateId: template }] },
    ] }
    await page.reload()
    await page.getByTestId('file-input').setInputFiles({
      name: 'synthetic-treasure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
    })
    await page.getByText('1 coincidencias de plantilla', { exact: true }).waitFor()
    const gizmoPanel = page.getByRole('heading', { name: 'Artilugios · Evidencia de recompensa' }).locator('xpath=ancestor::section')
    await gizmoPanel.getByRole('row').filter({ hasText: /Extractor portátil.*1 · Confirmado.*No determinado/ }).waitFor()
    const csvEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV', exact: true }).click()
    const prizeCsv = await readFile(await (await csvEvent).path())
    await page.reload()
    await page.getByTestId('file-input').setInputFiles({ name: 'synthetic-treasure.csv', mimeType: 'text/csv', buffer: prizeCsv })
    await page.getByText('1 coincidencias de plantilla', { exact: true }).waitFor()
    await page.getByText('Ver premios observados (3)', { exact: true }).click()
    assert.equal(await page.getByRole('cell', { name: /Premio sin identificar/ }).count(), 2)
    await page.getByText('Ver premios observados (3)', { exact: true }).click()
    await page.getByRole('button', { name: 'Partidas', exact: true }).click()
    await page.getByRole('button', { name: /Synthetic 43\.00/ }).click()
    const acquisitions = page.getByRole('region', { name: 'Adquisiciones del escuadrón' })
    assert.equal(await acquisitions.getByText('No determinado', { exact: true }).count(), 4)
    assert.equal(await acquisitions.getByText('Plantilla observada en un premio de cofre', { exact: true }).count(), 2)
    await page.getByRole('button', { name: /Synthetic other version/ }).click()
    assert.equal(await acquisitions.getByText('No determinado', { exact: true }).count(), 4)
    assert.equal(await acquisitions.getByText('Plantilla observada en un premio de cofre', { exact: true }).count(), 0)
    await page.getByLabel('Idioma').selectOption('en')
    assert.equal(await page.getByRole('region', { name: 'Squad acquisitions' })
      .getByText('Undetermined', { exact: true }).count(), 4)
    await page.getByLabel('Language').selectOption('es')

    const squad = [101, 102, 103, 104].map(playerId => ({
      playerId, recorder: playerId === 101, evidence: 'TeamIndex',
    }))
    const notices = sourceActor => squad.map((member, i) => ({
      actor: sourceActor * 10 + i, observedAt: 30 + i, templateId: 'DelilahPrize:dpid_item10',
      sourceActor, playerId: member.playerId,
    }))
    const shared = { schemaVersion: 1, matches: [
      { file: 'Shared one.replay', status: 'complete', branch, chests: [], items: [], squad,
        gizmos: [
          { actor: 710, observedAt: 10, kind: 'sprite-locator', class: 'B_RelicFinder_C', itemId: 'WID_RelicFinder' },
          { actor: 711, observedAt: 11, kind: 'golden-firework', class: 'B_FlameCeleb_BaseWeapon_C', itemId: 'WID_FlameCeleb_Consumable_S43' },
        ], treasures: notices(500) },
      { file: 'Shared two.replay', status: 'partial', branch, chests: [], items: [], squad,
        treasures: [...notices(500), ...notices(501)] },
      { file: 'Shared mixed.replay', status: 'complete', branch, chests: [], items: [], squad,
        treasures: [
          { actor: 6000, observedAt: 40, templateId: template, sourceActor: 600, playerId: 102 },
          { actor: 6001, observedAt: 41, templateId: template, sourceActor: 600, playerId: 103 },
          { actor: 6010, observedAt: 42, templateId: 'DelilahPrize:dpid_item13', sourceActor: 601, playerId: 999 },
          { actor: 6020, observedAt: 43, templateId: 'DelilahPrize:dpid_item9', sourceActor: 602 },
          { actor: 6030, observedAt: 44, templateId: 'DelilahPrize:dpid_item10', playerId: 101 },
          { actor: 6040, observedAt: 45, templateId: 'DelilahPrize:dpid_item10', sourceActor: 604, playerId: 101 },
          { actor: 6041, observedAt: 46, templateId: 'DelilahPrize:dpid_item13', sourceActor: 604, playerId: 102 },
        ] },
      { file: 'Poster sources.replay', status: 'complete', branch, items: [], squad,
        chests: [
          ['poster-base', 'B_SpritePosters_Booty_Chest'],
          ['poster-variant', 'B_SpritePosters_Booty_Chest_Variant1'],
          ['sprite-buried', 'B_Athena_BuriedChest_RelicFinder'],
          ['rare-random', 'Tiered_Chest_5_Child'],
          ['rare-fixed', 'AlwaysSpawn_RareChest'],
        ].map(([id, type], i) => ({ id, type, time: 50 + i, action: 'opened', evidence: 'SearchingPawn',
          playerId: 101, recorder: true, attribution: 'confirmed', teamRole: 'recorder' })),
        treasures: [620, 621, 622].map((sourceActor, i) => ({
          actor: 6200 + i, sourceActor, playerId: 102, observedAt: 50 + i, templateId: 'DelilahPrize:dpid_item10',
        })) },
      { file: 'Shared other version.replay', status: 'complete', branch: '++Fortnite+Release-44.00',
        chests: [], items: [], squad, treasures: notices(500) },
    ] }
    await page.reload()
    await page.getByTestId('file-input').setInputFiles({
      name: 'shared-rewards.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(shared)),
    })
    await page.getByRole('status').filter({ hasText: '1 archivo procesado' }).waitFor()
    const catalogPanel = page.getByRole('heading', { name: 'Artilugios · Evidencia de recompensa' }).locator('xpath=ancestor::section')
    assert.equal(await catalogPanel.getByRole('img').count(), 0) // Decorative art has an empty alt.
    assert.equal(await catalogPanel.locator('img').count(), 9)
    await page.waitForFunction(() => [...document.querySelectorAll('.gizmo-cell img')]
      .every(image => image.complete && image.naturalWidth > 0))
    assert.equal(await catalogPanel.getByText('Artilugios sin identificar', { exact: true }).count(), 0)
    await catalogPanel.getByText('Acelerador de extracción', { exact: true }).waitFor()
    await catalogPanel.getByText('Potenciador de lugar de extracción', { exact: true }).waitFor()
    await catalogPanel.getByText('Calabaza de picoteo', { exact: true }).waitFor()
    await page.getByLabel('Idioma').selectOption('en')
    const englishCatalog = page.getByRole('heading', { name: 'Gizmos · Reward evidence' }).locator('xpath=ancestor::section')
    await englishCatalog.getByText('Extraction Accelerator', { exact: true }).waitFor()
    await englishCatalog.getByText('Sprite Locator', { exact: true }).waitFor()
    await englishCatalog.getByText("Snack-O'-Lantern", { exact: true }).waitFor()
    await page.getByLabel('Language').selectOption('es')
    const sharedCsvEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV', exact: true }).click()
    const sharedCsv = await readFile(await (await sharedCsvEvent).path())
    for (const roundTrip of [false, true]) {
      if (roundTrip) {
        await page.reload()
        await page.getByTestId('file-input').setInputFiles({
          name: 'shared-rewards.csv', mimeType: 'text/csv', buffer: sharedCsv,
        })
        await page.getByRole('status').filter({ hasText: '1 archivo procesado' }).waitFor()
      }
      await page.getByRole('button', { name: 'Partidas', exact: true }).click()
      await page.getByRole('button', { name: 'Shared one', exact: false }).click()
      const rewards = page.getByRole('region', { name: 'Adquisiciones del escuadrón' })
      const extractor = rewards.locator('.detail-grid > div').filter({ hasText: 'Extractor portátil' })
      assert.equal(await extractor.locator('strong').innerText(), 'Adquisiciones observadas · 1')
      await extractor.getByText('Ver aperturas de origen', { exact: true }).click()
      assert.equal(await extractor.getByText('Actor #500', { exact: true }).count(), 1)
      await page.getByRole('button', { name: 'Shared two', exact: false }).click()
      assert.equal(await extractor.locator('strong').innerText(), 'Adquisiciones observadas · 2')
      await extractor.getByText('Ver aperturas de origen', { exact: true }).click()
      assert.equal(await extractor.locator('li').count(), 2)
      await page.screenshot({ path: resolve(work, 'squad-reward-openings.png') })
      await page.getByRole('button', { name: 'Shared mixed', exact: false }).click()
      assert.equal(await rewards.getByText('No determinado', { exact: true }).count(), 3)
      const pirate = rewards.locator('.detail-grid > div').filter({ hasText: 'Token pirata' })
      assert.equal(await pirate.locator('strong').innerText(), 'Adquisiciones observadas · 1')
      await page.getByRole('button', { name: 'Shared other version', exact: false }).click()
      assert.equal(await rewards.getByText('No determinado', { exact: true }).count(), 4)
    }
    await page.getByRole('button', { name: 'Poster sources', exact: false }).click()
    const posterAcquisitions = page.getByRole('region', { name: 'Adquisiciones del escuadrón' })
    await posterAcquisitions.getByText('Adquisiciones observadas · 3', { exact: true }).waitFor()
    const posterRow = page.getByRole('button', { name: 'Poster sources', exact: false }).locator('xpath=ancestor::tr')
    assert.equal(await posterRow.locator('td').nth(3).innerText(), '5')
    await page.getByRole('button', { name: 'Ver dispensadores', exact: true }).click()
    await page.getByText('Póster de espíritu', { exact: true }).waitFor()
    await page.getByText('Cofre enterrado de espíritu', { exact: true }).waitFor()
    await page.getByText('Cofre raro', { exact: true }).waitFor()
    await page.getByText('Cofre raro · aparición fija', { exact: true }).waitFor()
    await page.getByLabel('Categoría').selectOption('poster')
    assert.equal(await page.locator('tbody tr').count(), 2)
    await page.getByLabel('Categoría').selectOption('')
    await page.getByLabel('Idioma').selectOption('en')
    await page.getByText('Sprite Poster', { exact: true }).waitFor()
    await page.getByText('Buried Sprite Chest', { exact: true }).waitFor()
    await page.getByText('Rare Chest', { exact: true }).waitFor()
    await page.getByLabel('Language').selectOption('es')
    await page.getByRole('button', { name: 'Partidas', exact: true }).click()
    await page.getByRole('button', { name: 'Shared two', exact: false }).click()
    await page.getByLabel('Idioma').selectOption('en')
    assert.equal(await page.getByRole('region', { name: 'Squad acquisitions' })
      .getByText('Observed acquisitions · 2', { exact: true }).count(), 1)
    await page.getByLabel('Language').selectOption('es')
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  await page.getByRole('button', { name: 'Resumen', exact: true }).click()
  await page.screenshot({ path: resolve(work, 'dashboard-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(work, 'dashboard-mobile.png') })
  assert.deepEqual(await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return []
    return [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12).map(el => [el.tagName, el.getAttribute("class"), Math.round(el.getBoundingClientRect().right)])
  }), [])
} finally {
  await browser.close()
}










