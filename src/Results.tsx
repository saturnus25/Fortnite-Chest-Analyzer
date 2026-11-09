import { useI18n } from './i18n'
import type { Language } from './locales'
import { useMemo, useState } from 'react'
import { ArrowRight, Files, ListFilter, Truck, Wrench, X } from 'lucide-react'
import { gizmoNames, lootCategories } from './catalog'
import { categories, chestOpened, containerOf } from './containers'
import type { Category } from './containers'
import type { Metadata } from './data'
import { report } from './data'
import { actionLabel, clock, date, playerKey, playerLabel, positionLabel, shortFile, statusLabel, trustLabel, typeLabel } from './format'
import type { LootCategory, Opening, Result } from './types'
import { SectionTitle, Select, Table } from './ui'
import { valid } from './useAnalysis'
import { memberKey, memberOf, roles } from './squad'

export type View = 'overview' | 'matches' | 'events' | 'loot' | 'squad'
type Data = ReturnType<typeof report>

export function Matches({ results, selectedKey, select, navigate }: {
  results: Result[]; selectedKey: string; select: (key: string) => void; navigate: (view: View) => void
}) {
  const { t, num, detail } = useI18n()
  const selected = results.find(row => row.key === selectedKey)
  return <>
    <SectionTitle eyebrow={t('ARCHIVOS LOCALES')} title={t('Partidas')} count={t('{count} archivos', { count: results.length })} />
    {selected && <section className="panel match-detail">
      <div className="panel-title"><Files size={20} /><div><h3>{shortFile(selected.file)}</h3><p>{selected.file}</p></div>
        <button className="button ghost small close-match" type="button" onClick={() => select('')}><X size={15} /> {t('Cerrar detalle')}</button></div>
      <div className="detail-grid">
        <div><small>{t('Estado')}</small><strong>{t(statusLabel[selected.status])}</strong>{selected.source === 'report' && <small>{t('Informe importado')}</small>}</div>
        <div><small>{t('Versión')}</small><strong>{selected.branch?.replace('++Fortnite+Release-', '') ?? '—'}</strong></div>
        <div><small>{t('Grabación')}</small><strong>{date(selected.recordedAt)}</strong></div>
        <div><small>{t('Duración')}</small><strong>{clock(selected.durationMs == null ? null : selected.durationMs / 1000)}</strong></div>
        <div><small>{t('Nombre del grabador en el replay')}</small><strong>{selected.recorderName ?? t('Desconocido')}</strong></div>
        <div><small>{t('Cofres abiertos')}</small><strong>{valid(selected) ? num(selected.chests.filter(chestOpened).length) : '—'}</strong></div>
        <div><small>{t('Entregas de suministros observadas')}</small><strong>{selected.supplyDrops ? num(selected.supplyDrops.length) : '—'}</strong></div>
        <div><small>{t('Aperturas / rupturas / disparos')}</small><strong>{valid(selected)
          ? ['opened', 'broken', 'fired'].map(kind => selected.chests.filter(c => c.action === kind).length).join(' / ') : '—'}</strong></div>
      </div>
      {selected.detail && <p className="status-detail">{detail(selected.detail)}</p>}
      {valid(selected) && <div className="detail-actions">
        <button className="button ghost small" type="button" onClick={() => navigate('squad')}>{t('Ver escuadrón')} <ArrowRight size={15} /></button>
        <button className="button ghost small" type="button" onClick={() => navigate('events')}>{t('Ver dispensadores')} <ArrowRight size={15} /></button>
        <button className="button ghost small" type="button" onClick={() => navigate('loot')}>{t('Ver botín')} <ArrowRight size={15} /></button>
        <details><summary>{t('Datos técnicos')}</summary><p>Build {selected.build ?? '—'} · {t('Contenedor')} {selected.fileVersion ?? '—'} · {t('Motor de red')} {selected.engineNetworkVersion ?? '—'} ·
          {selected.engine === 'rust' ? 'Rust / WebAssembly · ' : selected.engine === 'legacy' ? `${t('Motor compatible')} · ` : ''}
          {t('{count} errores de paquete', { count: selected.skippedPackets ?? 0 })}</p>
          {!!selected.events?.length && <ul>{selected.events.map(event => <li key={event}>{event}</li>)}</ul>}
        </details>
      </div>}
    </section>}
    <Table rows={results} headers={[t('Archivo'), t('Fecha'), t('Duración'), t('Cofres abiertos'), t('Eventos'), t('Estado')]}
      empty={t('Las repeticiones importadas aparecerán aquí.')}
      row={r => <tr key={r.key}><td><button type="button" className="table-link" onClick={() => select(r.key)} title={r.file}>
        {shortFile(r.file)} <ArrowRight size={14} /></button></td><td>{date(r.recordedAt)}</td>
        <td>{clock(r.durationMs == null ? null : r.durationMs / 1000)}</td><td>{valid(r) ? num(r.chests.filter(chestOpened).length) : '—'}</td>
        <td>{valid(r) ? num(r.chests.length) : '—'}</td>
        <td><span className={`pill ${r.status}`} title={r.detail ? detail(r.detail) : undefined}>{t(statusLabel[r.status])}</span>{r.source === 'report' && <small>{t('Informe importado')}</small>}</td></tr>} />
  </>
}

export type EvidencePreset = { category?: Category; squad?: boolean; extraction?: boolean }
type LootFilter = LootCategory | 'extraction' | ''

export function Evidence({ view, data, matchKey, select, meta, labels, preset }: {
  view: 'events' | 'loot'; data: Data; matchKey: string; select: (key: string) => void; meta: Metadata; labels: Map<string, string>
  preset?: EvidencePreset
}) {
  const { t, language, locale } = useI18n()
  const [player, setPlayer] = useState(preset?.squad ? '$squad' : '')
  const [category, setCategory] = useState<Category | ''>(preset?.category ?? '')
  const [type, setType] = useState('')
  const [action, setAction] = useState('')
  const [query, setQuery] = useState('')
  const [origin, setOrigin] = useState(preset?.extraction ? 'all' : 'linked')
  const [lootFilter, setLootFilter] = useState<LootFilter>(preset?.extraction ? 'extraction' : '')
  const types = useMemo(() => [...new Set(data.events.map(row => row.opening.type))]
    .sort((a, b) => typeLabel(a, language).localeCompare(typeLabel(b, language), locale)), [data, language, locale])
  const people = useMemo(() => {
    const members = new Map<string, string>()
    for (const match of data.matches) for (const member of match.squad ?? []) {
      const key = memberKey(member, match)
      members.set(key, labels.get(key) ?? t('Compañero'))
    }
    for (const { match, opening } of data.events) {
      if (!memberOf(match, opening) && opening.playerId != null)
        members.set(playerKey(opening, match.key), playerLabel(opening, language))
    }
    return [...members].sort(([, a], [, b]) => a.localeCompare(b, locale))
  }, [data, labels, language, locale, t])
  const filtersKey = [matchKey, player, category, type, action, query, origin, lootFilter].join('|')
  const search = query.trim().toLowerCase()
  const searchItem = (item: Parameters<Metadata>[0], match: Result) =>
    !search || [item.itemId, meta(item, match).name, meta(item, match).rarity].some(x => x?.toLowerCase().includes(search))
  const passes = (match: Result, opening?: Opening) =>
    (!matchKey || match.key === matchKey) && (!category || opening && containerOf(opening.type).category === category)
    && (!type || opening?.type === type) && (!action || opening?.action === action)
    && (!player || (opening && passesPlayer(match, opening)))
  function passesPlayer(match: Result, opening: Opening) {
    if (player === '$recorder') return opening.recorder
    if (player === '$squad') return opening.teamRole === 'squad' || opening.teamRole === 'recorder'
    const member = memberOf(match, opening)
    return (member ? memberKey(member, match) : playerKey(opening, match.key)) === player
  }
  const events = view === 'events' ? data.events.filter(({ match, opening, items }) =>
    passes(match, opening) && (!search || items.some(item => searchItem(item, match)))) : []
  const loot = view === 'loot' ? data.loot.filter(({ match, item, opening }) =>
    passes(match, opening) && searchItem(item, match)
    && (origin === 'all' || (origin === 'linked' ? opening : !opening))
    && (!lootFilter || (lootFilter === 'extraction' ? meta(item, match).category : meta(item, match).category === lootFilter))) : []

  return <>
    <SectionTitle eyebrow={t('EVIDENCIA POR ACTOR')} title={view === 'events' ? t('Dispensadores') : t('Botín observado')}
      count={t('{count} filas', { count: view === 'events' ? events.length : loot.length })} />
    <section className="panel filters">
      <div className="filter-heading"><ListFilter size={17} /><strong>{t('Filtros')}</strong>
        <button className="text-button" type="button" onClick={() => {
          select(''); setPlayer(''); setCategory(''); setType(''); setAction(''); setQuery(''); setOrigin('linked'); setLootFilter('')
        }}>{t('Restablecer')}</button>
      </div>
      <div className="filter-grid">
        <Select label={t('Partida')} value={matchKey} change={select}>
          <option value="">{t('Todas las partidas')}</option>
          {data.matches.map(match => <option key={match.key} value={match.key}>{shortFile(match.file)}</option>)}
        </Select>
        <Select label={t('Jugador')} value={player} change={setPlayer}>
          <option value="">{t('Todos los jugadores')}</option><option value="$recorder">{t('Jugador que grabó')}</option><option value="$squad">{t('Mi escuadrón')}</option>
          {people.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </Select>
        <Select label={t('Categoría')} value={category} change={value => { setCategory(value as Category | ''); setType('') }}>
          <option value="">{t('Todas las categorías')}</option>
          {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
        </Select>
        <Select label={t('Clase')} value={type} change={setType}>
          <option value="">{t('Todos los tipos')}</option>
          {types.filter(id => !category || containerOf(id).category === category).map(id => <option key={id} value={id}>{typeLabel(id, language)} · {id}</option>)}
        </Select>
        <Select label={t('Acción')} value={action} change={setAction}>
          <option value="">{t('Todas las acciones')}</option>
          {Object.entries(actionLabel).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
        </Select>
        <label className="field"><span>{t('Objeto')}</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Nombre o ID interno')} /></label>
        {view === 'loot' && <>
          <Select label={t('Origen')} value={origin} change={setOrigin}>
            <option value="linked">{t('Con vínculo a dispensador')}</option><option value="unlinked">{t('Origen sin resolver')}</option><option value="all">{t('Todos los orígenes')}</option>
          </Select>
          <Select label={t('Tipo de objeto')} value={lootFilter} change={value => {
            setLootFilter(value as LootFilter)
            if (value) setOrigin('all')
          }}>
            <option value="">{t('Todos los objetos')}</option><option value="extraction">{t('Artilugios y extractores')}</option>
            <option value="gizmo">{t('Artilugios de la rueda')}</option><option value="extraction-consumable">{t('Consumibles de extracción')}</option>
          </Select>
        </>}
      </div>
    </section>
    {view === 'loot' && (lootFilter === 'extraction' || lootFilter === 'gizmo')
      && <GizmoSightings matches={data.matches} matchKey={matchKey} search={search} />}
    {view === 'loot' && lootFilter && <h3 className="subheading">{t('Objetos observados en el suelo')}</h3>}
    {view === 'events' && category === 'supply' && <SupplySightings matches={data.matches} matchKey={matchKey} />}
    {view === 'events' ? <Table key={`events|${filtersKey}`} rows={events}
      headers={[t('Partida / momento'), t('Dispensador'), t('Acción'), t('Jugador'), t('Posición XYZ (cm)'), t('Botín vinculado')]}
      empty={t('No hay activaciones que coincidan con estos filtros.')}
      row={({ match, opening, items }) => <tr key={match.key + opening.id}>
        <td><strong>{clock(opening.time)}</strong><small>{shortFile(match.file)}</small></td>
        <td><strong>{typeLabel(opening.type, language)}</strong><small>{opening.type}</small></td>
        <td>{t(actionLabel[opening.action])}<small>{t(opening.evidence)}</small></td>
        <td>{squadLabel(match, opening, labels, language)}<small>{t(trustLabel[opening.attribution])} · {t(roles[opening.teamRole])}</small></td>
        <td>{positionLabel(opening.position)}</td>
        <td>{items.length ? <details><summary>{t('{count} objetos', { count: items.length })}</summary><ul className="inline-items">
          {items.map(item => <li key={item.actor}>{meta(item, match).name ?? item.itemId}</li>)}</ul></details> : t('Sin vínculo verificado')}</td>
      </tr>} />
      : <Table key={`loot|${filtersKey}`} rows={loot}
        headers={[t('Objeto / ID interno'), t('Rareza'), t('Partida / momento'), t('Origen'), t('Recogido')]}
        empty={origin === 'linked' ? t('No hay objetos vinculados en este filtro. Puedes consultar los objetos de origen sin resolver.')
          : t('No hay objetos observados que coincidan con estos filtros.')}
        row={({ item, match, opening }) => {
          const m = meta(item, match)
          return <tr key={`${match.key}:${item.actor}`}><td><div className="item-cell">
            {m.icon && <img src={m.icon} alt="" loading="lazy" />}
            <span><strong>{m.name ?? item.itemId}</strong>{m.name && <small>{item.itemId}</small>}
              {m.category && <small>{t(lootCategories[m.category])}</small>}
              {m.special && <small>{t('Token pirata · Catálogo')}</small>}</span></div></td>
            <td>{m.rarity ?? t('Desconocida')}</td><td><strong>{clock(item.observedAt)}</strong><small>{shortFile(match.file)}</small></td>
            <td>{opening ? typeLabel(opening.type, language) : item.fromContainer === true ? t('Contenedor indeterminado') : t('Desconocido')}
              {item.sourceEvidence && <small>{item.sourceEvidence}</small>}</td>
            <td>{item.pickedUp === true ? t('Sí') : item.pickedUp === false ? t('No en el estado observado') : t('Desconocido')}</td>
          </tr>
        }} />}
  </>
}

function squadLabel(match: Result, opening: Opening, labels: Map<string, string>, language: Language) {
  const member = memberOf(match, opening)
  if (member?.displayNames?.length && opening.player) return opening.player
  return (member ? labels.get(memberKey(member, match)) : undefined) ?? playerLabel(opening, language)
}





function GizmoSightings({ matches, matchKey, search }: { matches: Result[]; matchKey: string; search: string }) {
  const { t } = useI18n()
  const selected = matches.filter(match => !matchKey || match.key === matchKey)
  const rows = selected.flatMap(match => (match.gizmos ?? [])
    .filter(gizmo => !search || [t(gizmoNames[gizmo.kind]), gizmoNames[gizmo.kind], gizmo.itemId, gizmo.class].some(value => value.toLowerCase().includes(search)))
    .map(gizmo => ({ match, gizmo })))
  const covered = selected.some(match => match.gizmos !== undefined)
  return <section className="supply-section">
    <div className="supply-heading"><Wrench size={19} /><div><h3>{t('Artilugios de la rueda observados')}</h3>
      <p>{t('Actores que la repetición llegó a grabar. La primera observación no indica cuándo se obtuvieron o usaron. Solo se aplican los filtros de partida y objeto a esta tabla.')}</p></div></div>
    <Table key={`${matchKey}|${search}`} rows={rows} headers={[t('Artilugio / ID interno'), t('Clase del actor'), t('Partida'), t('Primera observación')]}
      empty={covered ? t('No hay actores de artilugio identificados para esta selección.') : t('Estos informes no incluyen observaciones de artilugios de la rueda.')}
      row={({ match, gizmo }) => <tr key={`${match.key}:${gizmo.actor}`}>
        <td><strong>{t(gizmoNames[gizmo.kind])}</strong><small>{gizmo.itemId}</small></td>
        <td>{gizmo.class}</td><td>{shortFile(match.file)}</td><td>{clock(gizmo.observedAt)}</td>
      </tr>} />
  </section>
}

function SupplySightings({ matches, matchKey }: { matches: Result[]; matchKey: string }) {
  const { t, language } = useI18n()
  const rows = matches.filter(match => !matchKey || match.key === matchKey)
    .flatMap(match => (match.supplyDrops ?? []).map(drop => ({ match, drop })))
  return <section className="supply-section">
    <div className="supply-heading"><Truck size={19} /><div><h3>{t('Entregas observadas en el replay')}</h3>
      <p>{t('Una aparición y una apertura son observaciones separadas. Esta lista incluye todos los equipos.')}</p></div></div>
    <Table key={matchKey} rows={rows} headers={[t('Partida'), t('Clase'), t('Primera observación'), t('Estado'), t('Posición XYZ (cm)')]}
      empty={t('Estas partidas no contienen entregas de suministros reconocidas.')}
      row={({ match, drop }) => <tr key={match.key + drop.id}>
        <td>{shortFile(match.file)}</td><td><strong>{typeLabel(drop.type, language)}</strong><small>{drop.type}</small></td>
        <td>{clock(drop.observedAt)}</td>
        <td>{drop.openedAt != null ? t('Abierta · {time}', { time: clock(drop.openedAt) }) : drop.opened ? t('Observada ya abierta') : t('Sin apertura registrada')}</td>
        <td>{positionLabel(drop.position)}</td>
      </tr>} />
    <h3 className="subheading">{t('Activaciones según los filtros')}</h3>
  </section>
}

