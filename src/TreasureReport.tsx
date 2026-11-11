import { Target } from 'lucide-react'
import { useI18n } from './i18n'
import { clock, shortFile, typeLabel } from './format'
import { gizmoFromTemplate, isPirateShopAccess, treasureName } from './treasure'
import type { Result } from './types'
import { Table } from './ui'

export function TreasureReport({ matches, catalogMatches }: { matches: Result[]; catalogMatches: number }) {
  const { t, language } = useI18n()
  const covered = matches.filter(match => match.treasures !== undefined).length
  const rows = matches.flatMap(match => (match.treasures ?? [])
    .filter(prize => !gizmoFromTemplate(match.branch, prize.templateId)).map(prize => ({ match, prize })))
  const pirateMatches = rows.filter(({ match, prize }) => isPirateShopAccess(match.branch, prize.templateId)).length

  return <section className="panel insight treasure-report">
    <div className="treasure-header">
      <div className="panel-title"><Target size={20} /><div><h3>{t('Recompensas especiales')}</h3>
        <p>Pirate Shop Access · {t('Todo el replay')}</p></div></div>
      <span className={`pill ${pirateMatches ? 'complete' : 'neutral'}`}>{pirateMatches
        ? t('{count} coincidencias de plantilla', { count: pirateMatches })
        : covered ? t('Sin coincidencias en lo grabado') : t('Sin datos de premios')}</span>
    </div>
    <p>{t('La plantilla exacta identifica el premio en la repetición. La acreditación en la cuenta de Epic queda sin determinar.')}</p>
    <p className="treasure-template"><code>DelilahPrize:PirateAccount</code> · {t('{count} partidas con lectura de premios', { count: covered })}</p>
    {catalogMatches > 0 && <p>{t('{count} coincidencias de catálogo en objetos del suelo, registradas por separado.', { count: catalogMatches })}</p>}
    {rows.length > 0 && <details className="treasure-details">
      <summary>{t('Ver premios observados ({count})', { count: rows.length })}</summary>
      <Table rows={rows} headers={[t('Premio / plantilla'), t('Partida / momento'), t('Contenedor de origen'), t('Jugador registrado')]}
        empty={t('Sin datos de premios')}
        row={({ match, prize }) => <tr key={`${match.key}:${prize.actor}`}>
          <td><strong>{t(treasureName(match.branch, prize.templateId) ?? 'Premio sin identificar')}</strong>
            <small>{prize.templateId ?? t('Plantilla desconocida')}</small></td>
          <td><strong>{clock(prize.observedAt)}</strong><small>{shortFile(match.file)}{match.source === 'report' ? ` · ${t('Informe importado')}` : ''}</small></td>
          <td>{prize.sourceType ? typeLabel(prize.sourceType, language) : t('Desconocido')}
            {prize.sourceActor != null && <small>{t('Actor #{id}', { id: String(prize.sourceActor) })}</small>}
            {prize.fromDestruction && <small>{t('Ruptura')}</small>}</td>
          <td>{prize.player ? <bdi>{prize.player}</bdi> : prize.playerId != null ? t('Jugador #{id}', { id: String(prize.playerId) }) : t('Desconocido')}</td>
        </tr>} />
    </details>}
  </section>
}
