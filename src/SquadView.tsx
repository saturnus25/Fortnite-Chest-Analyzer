import { useI18n } from './i18n'
import { useMemo, useState } from 'react'
import { Activity, Gem, PackageOpen, Users } from 'lucide-react'
import type { report } from './data'
import { date, metricDescription, shortFile } from './format'
import { activations, squadSummary } from './squad'
import { Metric, MetricGuide, SectionTitle, Select, Table } from './ui'
import { ActionChart } from './charts'

const columns = [
  { key: 'matches', label: 'Partidas', description: 'Partidas seleccionadas en las que figura el integrante.' },
  { key: 'chestOpened', label: 'Cofres abiertos', description: metricDescription.chestOpened },
  { key: 'opened', label: 'Todas las aperturas', description: metricDescription.opened },
  { key: 'broken', label: 'Rupturas', description: metricDescription.broken },
  { key: 'fired', label: 'Disparos', description: metricDescription.fired },
  { key: 'linked', label: 'Botín vinculado', description: metricDescription.linked },
  { key: 'inferred', label: 'Inferidos', description: metricDescription.inferred },
] as const

type Sort = { key: typeof columns[number]['key']; direction: 'ascending' | 'descending' }

export function Squad({ data, matchKey, select, labels, onAlias }: {
  data: ReturnType<typeof report>; matchKey: string; select: (key: string) => void
  labels: Map<string, string>; onAlias: (key: string, label: string) => void
}) {
  const { t, num, language } = useI18n()
  const matches = useMemo(() => matchKey ? data.matches.filter(match => match.key === matchKey) : data.matches,
    [matchKey, data.matches])
  const summary = useMemo(() => squadSummary(matches, data.events, labels, language), [matches, data.events, labels, language])
  const { totals, members, withRoster } = summary
  const [sort, setSort] = useState<Sort>()
  const sortedMembers = useMemo(() => {
    if (!sort) return members
    const sign = sort.direction === 'ascending' ? 1 : -1
    return [...members].sort((a, b) => sign * (a[sort.key] - b[sort.key]))
  }, [members, sort])
  const headers = [t('Integrante / nombre local'), t('Nombres registrados'), ...columns.map(({ key, label }) => ({
    label: t(label),
    sort: {
      direction: sort?.key === key ? sort.direction : undefined,
      change: () => setSort(current => ({
        key, direction: current?.key === key && current.direction === 'descending' ? 'ascending' : 'descending',
      })),
    },
  }))]
  const count = (n: number) => members.length ? num(n) : '—'
  const average = withRoster ? num(totals.chestOpened / withRoster, { maximumFractionDigits: 1 }) : '—'
  return <>
    <SectionTitle eyebrow={t('ACTIVIDAD DEL EQUIPO')} title={t('Escuadrón')} count={t('{count} partidas con equipo identificado', { count: withRoster })} />
    <section className="panel filters squad-filter">
      <Select label={t('Partida')} value={matchKey} change={select}>
        <option value="">{t('Todas las partidas')}</option>
        {data.matches.map(match => <option key={match.key} value={match.key}>{shortFile(match.file)}</option>)}
      </Select>
      <p>{t('Los totales incluyen las acciones atribuidas al jugador que grabó y a sus compañeros en las partidas seleccionadas.')}</p>
    </section>
    <div className="metrics">
      <Metric label={t('Integrantes')} Icon={Users} value={count(members.length)} description="Jugadores identificados. Un mismo ID de cuenta se agrupa entre partidas." />
      <Metric label={t('Cofres por partida')} Icon={PackageOpen} value={average} description={metricDescription.chestAverage}
        hint={t('{count} aperturas de cofres del equipo', { count: totals.chestOpened })} />
      <Metric label={t('Activaciones del equipo')} Icon={Activity} value={count(activations(totals))} description={metricDescription.activations}
        hint={t('{opened} aperturas · {broken} rupturas · {fired} disparos', totals)} />
      <Metric label={t('Botín vinculado al equipo')} Icon={Gem} value={count(totals.linked)} description={metricDescription.linked} />
    </div>
    <div className="charts squad-charts">
      <ActionChart title={t('Actividad por integrante')} subtitle={t('Los seis integrantes con más actividad en este alcance')}
        rows={[...members].sort((a, b) => activations(b) - activations(a)).slice(0, 6)
          .map(row => ({ key: row.key, label: row.label, counts: row }))} />
      <section className="panel info-panel">
        <div className="panel-title"><Users size={18} /><div><h3>{t('Identidad entre partidas')}</h3><p>{t('Nombres en cada grabación')}</p></div></div>
        <p>{t('Se agrupa por cuenta. El historial conserva los nombres visibles que aparecen en las repeticiones, incluso si cambian.')}</p>
        <p>{t('Puedes asignar un nombre local a cada cuenta estable. Pulsa Intro o sal del campo para guardarlo en este navegador.')}</p>
      </section>
    </div>
    {members.length > 0 && <div className="squad-table-tools">
      <MetricGuide label={t('Qué significa cada columna')} entries={columns} />
      <p>{t('Selecciona un encabezado numérico para ordenar. Púlsalo de nuevo para invertir el orden.')}</p>
    </div>}
    <Table key={matchKey} rows={sortedMembers} headers={headers}
      empty={t('Importa una repetición con datos del grabador y su equipo para ver el desglose.')}
      row={row => <tr key={row.key}>
        <td>{row.stable ? <input className="alias" aria-label={t('Nombre local de {name}', { name: row.label })} key={row.label}
          defaultValue={row.label} maxLength={48}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
          onBlur={event => {
            const value = event.currentTarget.value.trim()
            if (value !== row.label) onAlias(row.key, value)
          }} /> : <strong>{row.label}</strong>}
          <small>{row.recorder ? t('Grabador') : t('Compañero')} · {row.stable ? `ID ${row.key.slice(-8)}` : t('ID local a la partida')}
            {matchKey && !row.names.length && row.alias ? ` · ${t('Alias en el replay {name}', { name: row.alias })}` : ''}</small>
        </td>
        <td>{row.names.length === 0 ? t('Desconocidos') : row.names.length === 1 ? <bdi>{row.names[0].name}</bdi>
          : <details><summary>{t('{count} nombres registrados', { count: row.names.length })}</summary><ul className="inline-items">
            {row.names.map(item => <li key={item.name}><bdi>{item.name}</bdi>
              <small>{t('{count} partidas · {from} a {to}', { count: item.matches, from: date(item.firstSeen), to: date(item.lastSeen) })}</small></li>)}
          </ul></details>}</td>
        {columns.map(({ key }) => <td key={key}>{num(row[key])}</td>)}
      </tr>} />
  </>
}



