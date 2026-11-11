import { useMemo } from 'react'
import { Package, PackageOpen } from 'lucide-react'
import { containerOf } from './containers'
import type { report } from './data'
import { typeLabel } from './format'
import { useI18n } from './i18n'
import { Table } from './ui'

type ContainerRow = {
  type: string; detected: number; opened: number | null; destroyed: number | null; destructionObserved: number; loot: number
  squad: number; other: number; missingAttribution: boolean
}

export function ContainerReport({ data }: { data: ReturnType<typeof report> }) {
  const { t, num, language, locale } = useI18n()
  const totals = useMemo(() => {
    const rows = new Map<string, ContainerRow>()
    let coverage = 0
    for (const match of data.matches) {
      if (!match.containers) continue
      coverage++
      for (const [type, counts] of Object.entries(match.containers)) {
        const row = rows.get(type) ?? {
          type, detected: 0, opened: null, destroyed: null, destructionObserved: 0, loot: 0,
          squad: 0, other: 0, missingAttribution: false,
        }
        row.detected += counts.detected
        if (counts.opened != null) row.opened = (row.opened ?? 0) + counts.opened
        if (counts.opened) {
          if (counts.openedBySquad == null || counts.openedByOther == null) row.missingAttribution = true
          else {
            row.squad += counts.openedBySquad
            row.other += counts.openedByOther
          }
        }
        row.destructionObserved += counts.destructionObserved
        if (counts.destroyed != null) row.destroyed = (row.destroyed ?? 0) + counts.destroyed
        rows.set(type, row)
      }
    }
    for (const { match, opening, items } of data.events) {
      if (!match.containers) continue
      const row = rows.get(opening.type)
      if (row) row.loot += items.length
    }
    return { rows: [...rows.values()], coverage }
  }, [data])
  const rows = [...totals.rows].sort((a, b) => typeLabel(a.type, language).localeCompare(typeLabel(b.type, language), locale))
  return <section className="panel insight treasure-report">
    <div className="panel-title"><PackageOpen size={20} /><div><h3>{t('Contenedores por clase')}</h3>
      <p>{t('{count} partidas con recuento de actores · Todo el replay', { count: totals.coverage })}</p></div></div>
    <p>{t('Vistos abiertos incluye a tu escuadrón, a otros equipos y los contenedores cuyo equipo no se pudo identificar. La gráfica superior cuenta eventos de apertura y ruptura en el alcance seleccionado.')}</p>
    {rows.some(row => row.missingAttribution) && <p>{t('Algunos informes importados solo guardan el total de abiertos. Vuelve a analizar las repeticiones originales para obtener el desglose por equipo.')}</p>}
    <p>{t('Los cofres normales y raros de aparición fija tienen su propia fila y se marcan con un borde amarillo.')}</p>
    <div className="treasure-details">
      <Table rows={rows}
        headers={[t('Clase'), t('Detectados'), t('Vistos abiertos'), t('Por tu escuadrón'), t('Por otros equipos'), t('Equipo sin identificar'), t('Destruidos'), t('Botín vinculado')]}
        empty={t('Sin recuento de contenedores disponible')}
        row={row => {
          const { fixed, image } = containerOf(row.type)
          const openedBy = (value: number) => row.opened == null || row.missingAttribution ? t('No determinado') : num(value)
          return <tr key={row.type}>
            <td><div className="item-cell">
              <span className={fixed ? 'container-thumb fixed' : 'container-thumb'} aria-hidden="true">
                {image ? <img src={`${import.meta.env.BASE_URL}images/containers/${image}.png`} alt="" width={44} height={44} />
                  : <Package size={18} />}
              </span>
              <span><strong>{typeLabel(row.type, language)}</strong><small>{row.type}</small></span>
            </div></td>
            <td>{num(row.detected)}</td><td>{row.opened == null ? t('No determinado') : num(row.opened)}</td>
            <td>{openedBy(row.squad)}</td><td>{openedBy(row.other)}</td><td>{openedBy((row.opened ?? 0) - row.squad - row.other)}</td>
            <td>{row.destroyed == null ? t('No determinado') : <>{num(row.destroyed)}
              <small>{t('Estado de destrucción en {count} de {total}', { count: row.destructionObserved, total: row.detected })}</small></>}</td>
            <td>{num(row.loot)}</td>
          </tr>
        }} />
    </div>
  </section>
}
