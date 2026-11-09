import { useI18n } from './i18n'
import { useMemo, useState } from 'react'
import { Archive, ArrowRight, CircleHelp, FolderOpen, Gem, PackageOpen, Truck, Users, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ActionChart, LootCoverage, MatchChart } from './charts'
import type { Catalog } from './catalog'
import { categories, chestOpened, containerOf } from './containers'
import type { Category } from './containers'
import type { Metadata, report } from './data'
import { metricDescription } from './format'
import { TreasureReport } from './TreasureReport'
import type { Result } from './types'
import { Metric, MetricGuide, SectionTitle } from './ui'

const actionGuide = [
  { label: 'Aperturas', description: metricDescription.opened },
  { label: 'Rupturas', description: metricDescription.broken },
  { label: 'Disparos', description: metricDescription.fired },
]

export function Overview({ data, results, catalog, meta, openCategory, inspect, openLoot, openSquad }: {
  data: ReturnType<typeof report>; results: Result[]; catalog: Catalog; meta: Metadata
  openCategory: (category: Category, squad: boolean) => void
  inspect: (key: string) => void; openLoot: (extraction?: boolean) => void; openSquad: () => void
}) {
  const { t, num } = useI18n()
  const [squad, setSquad] = useState(true)
  const derived = useMemo(() => {
    const squadMatches = data.matches.filter(match => match.squadEvidence && match.squad?.length)
    const scoped = squad && squadMatches.length > 0
    const matches = scoped ? squadMatches : data.matches
    const counts = new Map(matches.map(match => [match.key, 0]))
    const rows = Object.entries(categories).map(([key, label]) => ({ key, label, counts: { opened: 0, broken: 0, fired: 0 } }))
    const byCategory = new Map(rows.map(row => [row.key, row]))
    let chestCount = 0, linked = 0, total = 0
    for (const { match, opening, items } of data.events) {
      if (!counts.has(match.key) || scoped && !['recorder', 'squad'].includes(opening.teamRole)) continue
      byCategory.get(containerOf(opening.type).category)!.counts[opening.action]++
      total++
      linked += items.length
      if (chestOpened(opening)) {
        chestCount++
        counts.set(match.key, counts.get(match.key)! + 1)
      }
    }
    const drops = data.matches.flatMap(match => match.supplyDrops ?? [])
    return {
      scoped, squadMatches, chestCount, linked, total,
      rows: rows.filter(row => row.key !== 'unknown' || Object.values(row.counts).some(Boolean)),
      points: matches.map(match => ({ match, count: counts.get(match.key)! })),
      drops, covered: data.matches.filter(match => match.supplyDrops !== undefined).length,
      openedDrops: drops.filter(drop => drop.opened).length,
      timedDrops: drops.filter(drop => drop.openedAt != null).length,
      allLinked: data.loot.filter(row => row.opening).length,
    }
  }, [data, squad])
  const hasMapping = catalog.rows.some(row => row.special === 'pirate-token') || data.loot.some(row => row.item.metadata?.special === 'pirate-token')
  const tokens = useMemo(() => hasMapping
    ? data.loot.filter(({ match, item }) => meta(item, match).special === 'pirate-token').length : 0, [data, hasMapping, meta])

  const extraction = useMemo(() => {
    const gizmos = data.matches.reduce((total, match) => total + (match.gizmos?.length ?? 0), 0)
    let consumables = 0
    for (const { match, item } of data.loot) {
      const category = meta(item, match).category
      if (category === 'extraction-consumable') consumables++
    }
    return { gizmos, consumables }
  }, [data, meta])

  if (!data.matches.length) return <>
    <SectionTitle eyebrow={t('PRIMEROS PASOS')} title={t('Tu informe de partida')} count={results.length ? t('Revisa el estado en Partidas') : t('Esperando archivos')} />
    <div className="quickstart">
      <QuickStep Icon={FolderOpen} number="01" title={t('Importa tus archivos')} text={t('Selecciona la carpeta de Fortnite o arrastra archivos REPLAY, ZIP, CSV o JSON.')} />
      <QuickStep Icon={Users} number="02" title={t('Revisa tu escuadrón')} text={t('Consulta los nombres de cada partida y las estadísticas acumuladas de tus compañeros.')} />
      <QuickStep Icon={Gem} number="03" title={t('Explora el botín')} text={t('Filtra por contenedor, jugador o partida y comprueba la evidencia del origen.')} />
    </div>
  </>

  const points = derived.points
  const average = points.length ? num(derived.chestCount / points.length, { maximumFractionDigits: 1 }) : '—'
  const partial = results.filter(r => r.status === 'partial').length
  return <>
    <div className="overview-head">
      <SectionTitle eyebrow={t('ESTADÍSTICAS OBSERVADAS')} title={t('Resumen de partidas')}
        count={[t('{count} partidas', { count: data.matches.length }), partial ? t('{count} parciales', { count: partial }) : ''].filter(Boolean).join(' · ')} />
      <div className="scope" role="group" aria-label={t('Alcance del resumen')}>
        <button type="button" disabled={!derived.squadMatches.length} aria-pressed={derived.scoped} onClick={() => setSquad(true)}>
          <Users size={16} /> {t('Mi escuadrón')}
        </button>
        <button type="button" aria-pressed={!derived.scoped} onClick={() => setSquad(false)}>{t('Todo el replay')}</button>
      </div>
    </div>
    <p className="scope-note">{derived.scoped
      ? t('Mi escuadrón incluye las acciones atribuidas a ti o a tus compañeros.')
      : t('Todo el replay incluye lo que captó la grabación, también acciones de otros equipos o sin jugador identificado.')}</p>
    <div className="metrics summary-metrics">
      <Metric label={t('Cofres por partida')} Icon={PackageOpen} value={average} description={metricDescription.chestAverage}
        hint={t('{opened} aperturas en {matches} partidas', { opened: derived.chestCount, matches: points.length })} />
      <Metric label={t('Activaciones observadas')} Icon={Archive} value={num(derived.total)} description={metricDescription.activations} />
      <Metric label={t('Botín vinculado')} Icon={Gem} value={num(derived.linked)} description={metricDescription.linked} />
      <Metric label={t('Entregas observadas')} Icon={Truck} value={derived.covered ? num(derived.drops.length) : '—'}
        description={metricDescription.supplies}
        hint={derived.covered ? t('{count} con estado abierto · Todo el replay', { count: derived.openedDrops }) : t('Datos de entregas no incluidos en estos informes')} />
    </div>
    <MetricGuide label={t('Qué significan las aperturas, rupturas y disparos')} entries={actionGuide} />
    <div className="insight-grid">
      <MatchChart points={points} inspect={inspect} />
      <ActionChart title={t('Actividad por tipo de contenedor')}
        subtitle={t('Compara las acciones y pulsa un tipo para ver sus clases')}
        rows={derived.rows.map(row => ({ ...row, label: t(row.label) }))} onSelect={key => openCategory(key as Category, derived.scoped)} />
    </div>
    <div className="insight-grid secondary-insights">
      <LootCoverage linked={derived.allLinked} total={data.loot.length} inspect={() => openLoot()} />
      <section className="panel insight quick-links">
        <div className="panel-title"><CircleHelp size={20} /><div><h3>{t('Explora el informe')}</h3><p>{t('Más detalles sobre los datos de las partidas')}</p></div></div>
        <button type="button" onClick={openSquad}><Users size={18} /><span><b>{t('Escuadrón')}</b><small>{t('Desglose por integrante e historial de nombres')}</small></span><ArrowRight size={16} /></button>
        <button type="button" onClick={() => openCategory('supply', false)}><Truck size={18} /><span><b>{t('Entregas de suministros')}</b>
          <small>{derived.covered ? t('{count} aperturas con minuto observado', { count: derived.timedDrops }) : t('Consultar disponibilidad por partida')}</small></span><ArrowRight size={16} /></button>
        <button type="button" onClick={() => openLoot(true)}><Wrench size={18} /><span><b>{t('Artilugios y extractores')}</b>
          <small>{extraction.gizmos ? t('{gizmos} actores de artilugio · {consumables} consumibles', extraction)
            : extraction.consumables ? t('{count} consumibles de extracción observados', { count: extraction.consumables })
              : t('Consultar identificaciones y cobertura')}</small></span><ArrowRight size={16} /></button>
      </section>
    </div>
    <TreasureReport matches={data.matches} catalogMatches={tokens} />
  </>
}

function QuickStep({ Icon, number, title, text }: { Icon: LucideIcon; number: string; title: string; text: string }) {
  return <section className="panel quick-step"><div><Icon size={22} /><span>{number}</span></div><h3>{title}</h3><p>{text}</p></section>
}

