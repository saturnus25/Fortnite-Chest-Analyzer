import { useMemo } from 'react'
import { Wrench } from 'lucide-react'
import { gizmoIcons, gizmoNames } from './catalog'
import { clock, shortFile } from './format'
import { useI18n } from './i18n'
import { gizmoFromTemplate, squadRewardOpenings } from './treasure'
import type { GizmoKind, Result, TreasureAward } from './types'
import { Table } from './ui'

const kinds = Object.keys(gizmoNames) as GizmoKind[]

export function GizmoReport({ matches }: { matches: Result[] }) {
  const { t, num } = useI18n()
  const { seen, rewards, acquired } = useMemo(() => {
    const seen = new Map<GizmoKind, number>()
    const acquired = new Map<GizmoKind, number>()
    const rewards = new Map<GizmoKind, { match: Result; prize: TreasureAward }[]>()
    for (const match of matches) {
      for (const [kind, openings] of squadRewardOpenings(match)) {
        if (kind !== 'pirate-token') acquired.set(kind, (acquired.get(kind) ?? 0) + openings.length)
      }
      for (const observation of match.gizmos ?? [])
        seen.set(observation.kind, (seen.get(observation.kind) ?? 0) + 1)
      for (const prize of match.treasures ?? []) {
        const kind = gizmoFromTemplate(match.branch, prize.templateId)
        if (!kind) continue
        const rows = rewards.get(kind) ?? []
        rows.push({ match, prize })
        rewards.set(kind, rows)
      }
    }
    return { seen, rewards, acquired }
  }, [matches])
  const rows = [...rewards.values()].flat()
  return <section className="panel insight treasure-report">
    <div className="panel-title"><Wrench size={20} /><div><h3>{t('Artilugios · Evidencia de recompensa')}</h3>
      <p>{t('Todo el replay')}</p></div></div>
    <p><strong>{t('Premios de tu escuadrón')}.</strong> {t('Cuántas veces se vio que el premio le tocó a tu equipo. Cuenta una vez por apertura, aunque se registre para varios compañeros.')}</p>
    <p><strong>{t('Registros de premio')}.</strong> {t('Cuántas veces aparece identificado el premio en la grabación, incluidos otros equipos. Una misma apertura puede dejar varios registros.')}</p>
    <p>{t('Ejemplo. Si una apertura deja 3 registros del mismo artilugio para tu equipo, verás 3 registros y 1 premio de tu escuadrón.')}</p>
    <p>{t('Actores observados indica cuántas instancias del artilugio se detectaron en el replay. No determinado indica que faltan datos para calcular la cifra.')}</p>
    <div className="treasure-details">
      <Table rows={kinds}
        headers={[t('Tipo de objeto'), t('Actores observados'), t('Registros de premio'), t('Premios de tu escuadrón')]}
        empty={t('No determinado')}
        row={kind => <tr key={kind}>
          <td><div className="item-cell gizmo-cell"><img src={gizmoIcons[kind]} alt="" width={48} height={48} />
            <strong>{t(gizmoNames[kind])}</strong></div></td>
          <td>{seen.has(kind) ? num(seen.get(kind)!) : t('No determinado')}</td>
          <td>{rewards.has(kind) ? `${num(rewards.get(kind)!.length)} · ${t('Confirmado')}` : t('No determinado')}</td>
          <td>{acquired.has(kind)
            ? t('Adquisiciones observadas · {count}', { count: acquired.get(kind)! }) : t('No determinado')}</td>
        </tr>} />
    </div>
    {rows.length > 0 && <details className="treasure-details">
      <summary>{t('Ver premios observados ({count})', { count: rows.length })}</summary>
      <Table rows={rows} headers={[t('Premio / plantilla'), t('Partida / momento')]} empty={t('No determinado')}
        row={({ match, prize }) => <tr key={`${match.key}:${prize.actor}`}>
          <td>{t(gizmoNames[gizmoFromTemplate(match.branch, prize.templateId)!])}<small>{prize.templateId}</small></td>
          <td>{clock(prize.observedAt)}<small>{shortFile(match.file)}{match.source === 'report' ? ` · ${t('Informe importado')}` : ''}</small></td>
        </tr>} />
    </details>}
  </section>
}
