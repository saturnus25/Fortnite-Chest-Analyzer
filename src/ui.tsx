import { useI18n } from './i18n'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Archive, ArrowDown, ArrowDownUp, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'


export function Select({ label, value, change, children }: {
  label: string; value: string; change: (value: string) => void; children: ReactNode
}) {
  return <label className="field"><span>{label}</span><select value={value} onChange={e => change(e.target.value)}>{children}</select></label>
}

export type TableHeader = {
  label: string
  sort: { direction?: 'ascending' | 'descending'; change: () => void }
}

export function Table<T>({ rows, headers, row, empty }: {
  rows: T[]; headers: (string | TableHeader)[]; row: (item: T) => ReactNode; empty: string
}) {
  const { t } = useI18n()
  const [page, setPage] = useState(0)
  const size = 25
  const last = Math.max(0, Math.ceil(rows.length / size) - 1)
  const current = Math.min(page, last)
  if (!rows.length) return <div className="panel blank table-blank"><Archive size={23} /><p>{empty}</p></div>
  return <div className="panel table-panel">
    <div className="table-scroll"><table><thead><tr>{headers.map(header => {
      if (typeof header === 'string') return <th scope="col" key={header}>{header}</th>
      const { label, sort } = header
      const Icon = sort.direction === 'ascending' ? ArrowUp : sort.direction === 'descending' ? ArrowDown : ArrowDownUp
      return <th scope="col" key={label} aria-sort={sort.direction}>
        <button type="button" className="sort-header" onClick={() => { setPage(0); sort.change() }}>
          {label}<Icon size={13} aria-hidden="true" />
        </button>
      </th>
    })}</tr></thead>
      <tbody>{rows.slice(current * size, (current + 1) * size).map(row)}</tbody></table></div>
    <div className="pagination"><span>{t('{first}–{last} de {total}', { first: current * size + 1, last: Math.min(rows.length, (current + 1) * size), total: rows.length })}</span>
      <div><button className="button ghost small" type="button" aria-label={t('Página anterior')} disabled={!current} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
        <button className="button ghost small" type="button" aria-label={t('Página siguiente')} disabled={current >= last} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button></div></div>
  </div>
}

export function SectionTitle({ eyebrow, title, count }: { eyebrow: string; title: string; count: string }) {
  return <div className="section-title"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
    <span className="pill neutral">{count}</span></div>
}

export function Metric({ label, value, description, hint, Icon }: {
  label: string; value: string; description: string; hint?: string; Icon: LucideIcon
}) {
  const { t } = useI18n()
  return <div className="panel metric"><span className="metric-icon"><Icon size={18} /></span><p>{label}</p>
    <strong>{value}</strong><small>{t(description)}</small>{hint && <small className="metric-hint">{hint}</small>}</div>
}

export function MetricGuide({ label, entries }: {
  label: string; entries: ReadonlyArray<{ label: string; description: string }>
}) {
  const { t } = useI18n()
  return <details className="metric-guide">
    <summary>{label}</summary>
    <dl>{entries.map(entry => <div key={entry.label}><dt>{t(entry.label)}</dt><dd>{t(entry.description)}</dd></div>)}</dl>
  </details>
}

export function Radar() {
  return <svg className="radar" viewBox="0 0 360 250" aria-hidden="true">
    <defs>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#91bd9a" strokeOpacity=".14" /></pattern>
      <radialGradient id="fade"><stop stopColor="white" /><stop offset="1" stopColor="black" /></radialGradient>
      <mask id="fade-grid"><rect width="360" height="250" fill="url(#fade)" /></mask>
    </defs>
    <rect width="360" height="250" fill="url(#grid)" mask="url(#fade-grid)" />
    <g transform="translate(180 122)" fill="none" stroke="#9be57e">
      <circle r="93" opacity=".17" /><circle r="75" opacity=".24" strokeDasharray="3 6" />
      <circle r="57" opacity=".29" /><path d="M-114 0H114M0-108V108" opacity=".14" />
      <path d="M-109-64V-86h23M109-64v-22H86M-109 64v22h23M109 64v22H86" opacity=".6" />
      <g strokeWidth="2.1" strokeLinejoin="round">
        <path d="M-36-10 0-30 36-10 0 10Z M-36-10v36L0 47l36-21v-36 M0 10v37 M-18-20l36 20v18l-9 5V5" fill="#101d17" />
        <path d="m-28 20 11 6m36 3 9-5" opacity=".65" />
      </g>
      <circle cx="64" cy="-39" r="3" fill="#b8f59a" /><circle cx="-84" cy="39" r="2.5" fill="#b8f59a" />
      <path d="M-116 105h36m160 0h36" opacity=".45" />
    </g>
    <g fill="#9acf91" fontFamily="monospace" fontSize="9" letterSpacing="2"><text x="40" y="21">REPLAY / SIGNAL</text><text x="248" y="237">LOCAL DECODE</text></g>
  </svg>
}


