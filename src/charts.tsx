import { useI18n } from './i18n'
import { useState } from 'react'
import { Activity, BarChart3, Gem } from 'lucide-react'
import { date, shortFile } from './format'
import type { Opening, Result } from './types'

const actions = ['opened', 'broken', 'fired'] as const
const names = { opened: 'Aperturas', broken: 'Rupturas', fired: 'Disparos' }
export type Bars = { key: string; label: string; counts: Record<Opening['action'], number> }
export const actionCount = (row: Bars) => actions.reduce((n, kind) => n + row.counts[kind], 0)

function niceScale(n: number) {
  if (n <= 4) return 4
  const unit = 10 ** Math.floor(Math.log10(n / 4))
  return Math.ceil(n / (4 * unit)) * unit * 4
}

export function ActionChart({ title, subtitle, rows, onSelect }: {
  title: string; subtitle: string; rows: Bars[]; onSelect?: (key: string) => void
}) {
  const { t, num } = useI18n()
  const max = niceScale(rows.reduce((n, row) => Math.max(n, actionCount(row)), 0))
  return <section className="panel insight">
    <div className="panel-title"><BarChart3 size={20} /><div><h3>{title}</h3><p>{subtitle}</p></div></div>
    <div className="legend">{actions.map(kind => <span key={kind}><i className={kind} />{t(names[kind])}</span>)}</div>
    <div className="chart-axis" aria-hidden="true"><span>0</span><span>{num(max / 2)}</span><span>{num(max)}</span></div>
    <div className="action-chart">
      {rows.map(row => {
        const total = actionCount(row)
        const description = actions.map(kind => `${t(names[kind])} ${num(row.counts[kind])}`).join(' · ')
        const contents = <>
          <div className="stack-label"><span>{row.label}</span><strong>{num(total)}</strong></div>
          <div className="stack-track" aria-hidden="true">
            {actions.map(kind => <i key={kind} className={kind} style={{ width: `${row.counts[kind] / max * 100}%` }} />)}
          </div>
        </>
        return onSelect
          ? <button className="stack-row" key={row.key} type="button" onClick={() => onSelect(row.key)}
            aria-label={`${row.label}. ${description}. ${t('Ver detalle.')}`} title={description}>{contents}</button>
          : <div className="stack-row" key={row.key} role="img" aria-label={`${row.label}. ${description}.`} title={description}>{contents}</div>
      })}
    </div>
  </section>
}

export function MatchChart({ points, inspect }: { points: { match: Result; count: number }[]; inspect: (key: string) => void }) {
  const { t, num, language } = useI18n()
  const [focus, setFocus] = useState<number | null>(null)
  const active = Math.min(focus ?? points.length - 1, points.length - 1)
  const point = points[active]
  const average = points.length ? points.reduce((n, row) => n + row.count, 0) / points.length : 0
  const max = niceScale(points.reduce((n, row) => Math.max(n, row.count), 0))
  const width = 470, startX = 44, endX = 451, baseY = 143, topY = 16
  const x = (i: number) => points.length === 1 ? (startX + endX) / 2 : startX + (endX - startX) * i / (points.length - 1)
  const y = (count: number) => baseY - (baseY - topY) * count / max
  const line = points.map((row, index) => `${x(index)},${y(row.count)}`).join(' ')
  const label = (stamp: string | null | undefined) => {
    if (!stamp) return t('Fecha desconocida')
    const month = stamp.slice(5, 7), day = stamp.slice(8, 10)
    return language === 'es' ? `${day}/${month}` : `${month}/${day}`
  }
  return <section className="panel insight match-chart">
    <div className="panel-title"><Activity size={20} /><div><h3>{t('Cofres abiertos por partida')}</h3>
      <p>{t('Una marca por partida · línea discontinua para la media')}</p></div></div>
    {point ? <>
      <svg viewBox={`0 0 ${width} 165`} role="img" aria-label={t('Aperturas de cofres por partida con eje desde cero')}>
        {[0, 1, 2, 3, 4].map(tick => {
          const value = max * tick / 4
          return <g key={tick}><line x1={startX} x2={endX} y1={y(value)} y2={y(value)} className="chart-grid" />
            <text x={startX - 8} y={y(value) + 4} textAnchor="end">{num(value)}</text></g>
        })}
        {points.length > 1 && <polygon points={`${startX},${baseY} ${line} ${endX},${baseY}`} className="chart-area" />}
        <line x1={startX} x2={endX} y1={y(average)} y2={y(average)} className="chart-average" />
        {points.length > 1 && <polyline points={line} className="chart-line" />}
        <line x1={x(active)} x2={x(active)} y1={topY} y2={baseY} className="chart-focus" />
        <circle cx={x(active)} cy={y(point.count)} r="5" className="chart-dot" />
        <rect x={startX} width={endX - startX} height={baseY - topY} y={topY} fill="transparent"
          onPointerMove={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            const index = Math.round((event.clientX - rect.left) / rect.width * (points.length - 1))
            setFocus(Math.max(0, Math.min(points.length - 1, index)))
          }} />
        <text x={startX} y={159}>{label(points[0].match.recordedAt)}</text>
        {points.length > 1 && <text x={endX} y={159} textAnchor="end">{label(points.at(-1)?.match.recordedAt)}</text>}
      </svg>
      {points.length > 1 && <input type="range" aria-label={t('Recorrer partidas del gráfico')} min={0} max={points.length - 1}
        value={active} onChange={event => setFocus(Number(event.target.value))} />}
      <div className="chart-readout">
        <div><strong>{t('{count} cofres', { count: point.count })}</strong><small>{date(point.match.recordedAt)} · {shortFile(point.match.file)}</small></div>
        <button className="button ghost small" type="button" onClick={() => inspect(point.match.key)}>{t('Ver partida')}</button>
      </div>
    </> : <p className="blank">{t('Este alcance todavía no tiene partidas con datos de cofres.')}</p>}
  </section>
}

export function LootCoverage({ linked, total, inspect }: { linked: number; total: number; inspect: () => void }) {
  const { t, locale } = useI18n()
  const share = total ? linked / total : 0
  return <section className="panel insight coverage">
    <div className="panel-title"><Gem size={20} /><div><h3>{t('Origen de los objetos')}</h3><p>{t('Todos los objetos observados en las partidas importadas')}</p></div></div>
    <div className="coverage-value">{total ? new Intl.NumberFormat(locale, { style: 'percent' }).format(share) : '—'}
      <span> {t('con origen vinculado')}</span></div>
    <div className="coverage-bar" role="img" aria-label={t('{linked} vinculados de {total} observados', { linked, total })}>
      <i style={{ width: `${share * 100}%` }} />
    </div>
    <div className="coverage-labels"><span><i />{t('{count} vinculados', { count: linked })}</span><span><i />{t('{count} sin origen resuelto', { count: total - linked })}</span></div>
    <button className="button ghost small" type="button" onClick={inspect}>{t('Explorar botín')}</button>
  </section>
}

