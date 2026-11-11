import { useI18n } from './i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Activity, ArrowDownToLine, BarChart3, ChevronRight, Crosshair, Files, FolderOpen,
  Gem, HardDrive, Layers3, PackageOpen, PanelTop, Power, ShieldCheck, Upload, Users, X } from 'lucide-react'
import { catalogIndex, readCatalog } from './catalog'
import type { Catalog } from './catalog'
import { exportCsv, exportJson, report } from './data'
import { basename } from './format'
import { directoryPicker, isImport, walk } from './imports'
import { Evidence, Matches } from './Results'
import { Overview } from './Overview'
import type { EvidencePreset, View } from './Results'
import { Squad } from './SquadView'
import { rosterLabels } from './squad'
import { Radar } from './ui'
import { errorText, formatNotice, useAnalysis } from './useAnalysis'
import { useReplayOverlay } from './useReplayOverlay'

const nav = [
  { id: 'overview', label: 'Resumen', Icon: BarChart3 },
  { id: 'matches', label: 'Partidas', Icon: Files },
  { id: 'squad', label: 'Escuadrón', Icon: Users },
  { id: 'events', label: 'Dispensadores', Icon: PackageOpen },
  { id: 'loot', label: 'Botín', Icon: Gem },
] as const
const aliasKey = 'fortnite-replay:aliases'
const shutdownPath = '/__fortnite_chest_analyzer/shutdown'
function loadAliases(): Record<string, string> {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(aliasKey) ?? '{}')
    if (entries && typeof entries === 'object' && !Array.isArray(entries))
      return Object.fromEntries(Object.entries(entries).filter(([key, value]) => key.startsWith('cuenta:') && typeof value === 'string'))
  } catch { /* optional local preferences */ }
  return {}
}

const emptyCatalog: Catalog = { rows: [], icons: new Map() }

export default function App() {
  const { language, setLanguage, t, detail } = useI18n()
  const [view, setView] = useState<View>('overview')
  const [preset, setPreset] = useState<EvidencePreset>()
  const [matchKey, setMatchKey] = useState('')
  const [aliases, setAliases] = useState(loadAliases)
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog)
  const [dragging, setDragging] = useState(false)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [hostState, setHostState] = useState<'unavailable' | 'ready' | 'closing' | 'closed' | 'error'>('unavailable')
  const folder = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const assets = useRef<HTMLInputElement>(null)
  const { results, progress, message, setMessage, analyze, cancel } = useAnalysis()
  const overlay = useReplayOverlay(language, setMessage)
  const busy = picking || progress !== null || hostState === 'closing' || hostState === 'closed'

  useEffect(() => () => { for (const url of catalog.icons.values()) URL.revokeObjectURL(url) }, [catalog])
  useEffect(() => {
    if (location.hostname !== '127.0.0.1') return
    const controller = new AbortController()
    void fetch(shutdownPath, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (response.status === 204 && response.headers.get('X-Fortnite-Chest-Analyzer') === 'portable') setHostState('ready')
      })
      .catch(() => { /* The static web build does not have a portable launcher. */ })
    return () => controller.abort()
  }, [])
  const meta = useMemo(() => catalogIndex(catalog, language), [catalog, language])
  const data = useMemo(() => report(results), [results])
  const labels = useMemo(() => rosterLabels(data.matches, aliases, language), [data.matches, aliases, language])
  const usableMatchKey = data.matches.some(m => m.key === matchKey) ? matchKey : ''

  async function shutdownLocalServers() {
    if (!window.confirm(t('¿Cerrar los servidores locales de Fortnite Chest Analyzer? Exporta antes los resultados que quieras guardar.'))) return
    setHostState('closing')
    try {
      const response = await fetch(shutdownPath, {
        method: 'POST', headers: { 'X-Fortnite-Chest-Analyzer': 'shutdown' }, signal: AbortSignal.timeout(5000),
      })
      if (response.status !== 204) throw new Error('Shutdown request failed')
      cancel()
      setHostState('closed')
    } catch {
      setHostState('error')
    }
  }

  function setAlias(key: string, label: string) {
    const next = { ...aliases }
    if (label) next[key] = label
    else delete next[key]
    setAliases(next)
    try { localStorage.setItem(aliasKey, JSON.stringify(next)) } catch { /* session-only preference */ }
  }

  async function pickFolder() {
    if (busy) return
    const promise = directoryPicker()
    if (!promise) { folder.current?.click(); return }
    setPicking(true)
    try {
      const directory = await promise
      const inputs = await walk(directory)
      setView('overview')
      void analyze(inputs)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (error instanceof DOMException && ['SecurityError', 'NotAllowedError'].includes(error.name)) folder.current?.click()
      else setMessage(errorText(error))
    } finally { setPicking(false) }
  }

  function fromInput(event: ChangeEvent<HTMLInputElement>) {
    const inputs = [...event.currentTarget.files ?? []].filter(file => isImport(file.name))
      .map(file => ({ file, path: file.webkitRelativePath || file.name }))
    event.currentTarget.value = ''
    setView('overview')
    void analyze(inputs)
  }

  async function fromAssets(event: ChangeEvent<HTMLInputElement>) {
    const inputs = [...event.currentTarget.files ?? []]
    event.currentTarget.value = ''
    if (!inputs.length) return
    setCatalogBusy(true)
    try {
      const next = await readCatalog(inputs)
      setCatalog(next)
      setMessage({ kind: 'catalog', records: next.rows.length, icons: next.icons.size })
    } catch (error) { setMessage(errorText(error)) }
    finally { setCatalogBusy(false) }
  }

  return <div className="layout">
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => setView('overview')}>
        <span className="brand-icon"><Crosshair size={23} strokeWidth={2.2} /></span>
        <span><strong>Chest Analyzer</strong><small>{t('FORTNITE / TELEMETRÍA')}</small></span>
      </button>
      <div className="nav-title">{t('ESPACIO DE ANÁLISIS')}</div>
      <nav aria-label={t('Secciones')}>
        {nav.map(({ id, label, Icon }) => <button type="button" key={id} className={view === id ? 'nav active' : 'nav'}
          aria-current={view === id ? 'page' : undefined} onClick={() => { setPreset(undefined); setView(id) }}>
          <Icon size={18} /> {t(label)}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav" type="button" onClick={() => assets.current?.click()} disabled={catalogBusy}>
          <Layers3 size={18} /> {t('Catálogo local')}
        </button>
        <div className="local"><ShieldCheck size={17} /> <span><b>{t('Procesamiento local')}</b><small>{t('Archivos en tu dispositivo')}</small></span></div>
      </div>
    </aside>
    <main>
      <header className={hostState === 'unavailable' ? 'topbar' : 'topbar portable-topbar'}>
        <div className="breadcrumb"><span>{t('Analizador')}</span><ChevronRight size={14} /> <strong>{t(nav.find(n => n.id === view)!.label)}</strong></div>
        <div className="exports">
          <select className="language-select" aria-label={t('Idioma')} value={language}
            onChange={event => setLanguage(event.currentTarget.value === 'es' ? 'es' : 'en')}>
            <option value="es" lang="es">Español</option><option value="en" lang="en">English</option>
          </select>
          <button type="button" className="button ghost small" disabled={!results.length} onClick={() => exportCsv(results, data, meta, labels)}>
            <ArrowDownToLine size={15} /> CSV
          </button>
          <button type="button" className="button ghost small" disabled={!results.length} onClick={() => exportJson(results, data, catalog, meta, labels)}>
            <ArrowDownToLine size={15} /> JSON
          </button>
          {overlay.available && <button type="button" className="button ghost small" onClick={() => void overlay.open()}
            disabled={hostState === 'closing' || hostState === 'closed'}>
            <PanelTop size={15} /> {t(overlay.active ? 'Ajustar overlay' : 'Overlay de cofres')}
          </button>}
          {overlay.active && <button type="button" className="button ghost small" onClick={() => void overlay.close()}>
            <X size={15} /> {t('Cerrar overlay')}
          </button>}
          {hostState !== 'unavailable' && <button type="button" className="button ghost small" onClick={() => void shutdownLocalServers()}
            disabled={hostState === 'closing' || hostState === 'closed'}>
            <Power size={15} /> {t('Cerrar servidores locales')}
          </button>}
        </div>
      </header>
      <div className="content">
        {overlay.active && <p className="notice" role="status"><PanelTop size={16} />{t('Mantén abierta esta pestaña mientras usas el overlay. Puedes minimizar el navegador.')}</p>}
        {hostState === 'closed' && <p className="notice" role="status"><Power size={16} />{t('Servidores locales cerrados. Ya puedes cerrar esta pestaña.')}</p>}
        {hostState === 'error' && <p className="notice" role="alert"><Power size={16} />{t('No se pudo confirmar el cierre. Vuelve a intentarlo o cierra las ventanas del lanzador.')}</p>}
        <input ref={folder} hidden type="file" multiple {...{ webkitdirectory: '' }} onChange={fromInput} data-testid="folder-input" />
        <input ref={files} hidden type="file" multiple accept=".replay,.zip,.csv,.json" onChange={fromInput} data-testid="file-input" />
        <input ref={assets} hidden type="file" multiple {...{ webkitdirectory: '' }} onChange={fromAssets} data-testid="asset-input" />
        <section className={`hero ${results.length ? 'compact' : ''} ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
          onDrop={e => {
            e.preventDefault(); setDragging(false)
            if (busy) return
            setView('overview')
            void analyze([...e.dataTransfer.files].filter(file => isImport(file.name)).map(file => ({ file, path: file.name })))
          }}>
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot" /> {t('ANALIZADOR DE REPETICIONES')}</div>
            <h1>Fortnite Chest <span>Analyzer</span></h1>
            <p>{t('Explora aperturas, cajas de munición, cañones de botín y las recompensas que tu repetición permite vincular.')}</p>
            <div className="hero-actions">
              <button type="button" className="button primary" disabled={busy} onClick={() => void pickFolder()}>
                <FolderOpen size={18} /> {t('Seleccionar carpeta')}
              </button>
              <button type="button" className="button ghost" disabled={busy} onClick={() => files.current?.click()}>
                <Upload size={17} /> {t('Importar archivos')}
              </button>
            </div>
            <div className="hero-note"><HardDrive size={14} /> {t('.REPLAY, .ZIP, .CSV y .JSON')} <span>·</span> {t('Incluye subcarpetas')} <span>·</span> {t('Procesado en el navegador')}</div>
          </div>
          {!results.length && <Radar />}
        </section>
        {picking && <p className="notice" role="status"><FolderOpen size={16} /> {t('Buscando repeticiones en la carpeta…')}</p>}
        {progress && <section className="progress panel" aria-live="polite">
          <div className="progress-head"><div><strong>{progress.phase === 'scan' ? t('Preparando importación') : t('Procesando archivos')}</strong>
            <small title={progress.file}>{basename(progress.file)}</small></div>
            <div className="progress-controls">{progress.total > 0 && <span>{progress.done} / {progress.total}{progress.active > 1 && <small>{t('{active} en paralelo', { active: progress.active })}</small>}</span>}
              <button className="button ghost small" type="button" onClick={cancel}><X size={15} /> {t('Cancelar')}</button></div>
          </div>
          <progress value={progress.total ? progress.done : undefined} max={progress.total || 1} aria-label={t('Progreso de análisis')} />
        </section>}
        {message && <p className="notice" role="status"><Activity size={16} />{typeof message === 'string' ? detail(message) : formatNotice(message, t)}</p>}
        {view === 'overview' && <Overview data={data} results={results} catalog={catalog} meta={meta}
          openCategory={(category, squad) => { setPreset({ category, squad }); setMatchKey(''); setView('events') }}
          inspect={key => { setMatchKey(key); setView('matches') }}
          openLoot={extraction => { setPreset(extraction ? { extraction } : undefined); setMatchKey(''); setView('loot') }}
          openSquad={() => { setMatchKey(''); setView('squad') }} />}
        {view === 'squad' && <Squad data={data} matchKey={usableMatchKey} select={setMatchKey} labels={labels} onAlias={setAlias} />}
        {view === 'matches' && <Matches results={results} selectedKey={matchKey} select={setMatchKey}
          navigate={next => { setPreset(undefined); setView(next) }} />}
        {(view === 'events' || view === 'loot') && <Evidence key={view + (preset?.category ?? '') + (preset?.extraction ? '|extraction' : '')} view={view} data={data} preset={preset}
          matchKey={usableMatchKey} select={setMatchKey} meta={meta} labels={labels} />}
        <footer><span>Fortnite Chest Analyzer</span><span>{t('Imágenes de Fortnite © Epic Games')} · <a href={import.meta.env.BASE_URL + 'licenses/fortnite-artwork.txt'} target="_blank" rel="noreferrer">{t('Créditos de imágenes')}</a></span><span>{t('Herramienta independiente · Sin afiliación a Epic Games')}</span></footer>
      </div>
    </main>
  </div>
}





