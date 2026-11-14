/**
 * Gaia check. FRONTEND_SPEC §14.
 * Verdict, measured motion, and consistency are rendered as delivered. They are not recomputed.
 */
import { extent } from 'd3-array'
import { format } from 'd3-format'
import { scaleLinear } from 'd3-scale'
import { gaiaCopy, measuredMotionUnavailable, slugNote, verdictUnavailableExplanation } from '../../config/copy'
import type { Consistency, Gaia, GaiaSource, MeasuredPm, Meta } from '../../contract/types'
import { worldToPixel } from '../../core/wcs'
import { useWorkspaceStore } from '../../state/store'
import { VerdictMark } from '../../ui/VerdictMark'

const formatQuantity = format('.6~g')

const PLOT_W = 320
const PLOT_H = 220
const PLOT_MARGIN = { top: 18, right: 16, bottom: 32, left: 52 }

function quantity(value: number | null, empty: string): string {
  if (value === null || !Number.isFinite(value)) return empty
  return formatQuantity(value)
}

function withError(value: number, error: number): string {
  return `${formatQuantity(value)} ${gaiaCopy.plusMinus} ${formatQuantity(error)}`
}

function copyText(value: string): void {
  try {
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(value).catch(() => undefined)
  } catch {
    // Clipboard access can throw when the document is not focused.
  }
}

function comparisonReason(gaia: Gaia): string {
  if (gaia.measured_pm === null) return gaiaCopy.measuredMotionMissing
  return gaiaCopy.primaryHasNoProperMotion
}

function padExtent(low: number, high: number): [number, number] {
  if (low === high) {
    const pad = Math.max(Math.abs(low) * 0.15, 1)
    return [low - pad, high + pad]
  }
  const pad = (high - low) * 0.2
  return [low - pad, high + pad]
}

function ComparisonPlot({
  gaiaPmra,
  gaiaPmdec,
  measured,
  consistency,
}: {
  gaiaPmra: number
  gaiaPmdec: number
  measured: MeasuredPm
  consistency: Consistency
}) {
  const xValues = [
    gaiaPmra,
    measured.pmra_mas_yr,
    measured.pmra_mas_yr - measured.pmra_err_mas_yr,
    measured.pmra_mas_yr + measured.pmra_err_mas_yr,
  ]
  const yValues = [
    gaiaPmdec,
    measured.pmdec_mas_yr,
    measured.pmdec_mas_yr - measured.pmdec_err_mas_yr,
    measured.pmdec_mas_yr + measured.pmdec_err_mas_yr,
  ]
  const xExtent = extent(xValues)
  const yExtent = extent(yValues)
  const xLow = xExtent[0]
  const xHigh = xExtent[1]
  const yLow = yExtent[0]
  const yHigh = yExtent[1]
  if (xLow === undefined || xHigh === undefined || yLow === undefined || yHigh === undefined) return null
  const [x0, x1] = padExtent(xLow, xHigh)
  const [y0, y1] = padExtent(yLow, yHigh)
  const xScale = scaleLinear().domain([x0, x1]).range([PLOT_MARGIN.left, PLOT_W - PLOT_MARGIN.right])
  const yScale = scaleLinear().domain([y0, y1]).range([PLOT_H - PLOT_MARGIN.bottom, PLOT_MARGIN.top])
  const gx = xScale(gaiaPmra)
  const gy = yScale(gaiaPmdec)
  const mx = xScale(measured.pmra_mas_yr)
  const my = yScale(measured.pmdec_mas_yr)
  const errLeft = xScale(measured.pmra_mas_yr - measured.pmra_err_mas_yr)
  const errRight = xScale(measured.pmra_mas_yr + measured.pmra_err_mas_yr)
  const errLow = yScale(measured.pmdec_mas_yr - measured.pmdec_err_mas_yr)
  const errHigh = yScale(measured.pmdec_mas_yr + measured.pmdec_err_mas_yr)
  const within = consistency.within_3_sigma ? gaiaCopy.within3SigmaYes : gaiaCopy.within3SigmaNo
  const alternative = [
    `${gaiaCopy.gaiaPoint} ${gaiaCopy.pmraAxis} ${formatQuantity(gaiaPmra)}, ${gaiaCopy.pmdecAxis} ${formatQuantity(gaiaPmdec)}`,
    `${gaiaCopy.measuredPoint} ${gaiaCopy.pmraAxis} ${withError(measured.pmra_mas_yr, measured.pmra_err_mas_yr)}, ${gaiaCopy.pmdecAxis} ${withError(measured.pmdec_mas_yr, measured.pmdec_err_mas_yr)}`,
    `${gaiaCopy.deltaPmra} ${formatQuantity(consistency.delta_pmra_mas_yr)}`,
    `${gaiaCopy.deltaPmdec} ${formatQuantity(consistency.delta_pmdec_mas_yr)}`,
    `${gaiaCopy.sigmaCombined} ${formatQuantity(consistency.sigma_combined_mas_yr)}`,
    within,
  ].join('. ')

  return (
    <div className="ws-gaia-plot-wrap">
      <svg
        className="ws-gaia-plot"
        data-gaia-plot="true"
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        role="img"
        aria-label={gaiaCopy.comparisonPlotLabel}
      >
        <line
          x1={PLOT_MARGIN.left}
          y1={PLOT_H - PLOT_MARGIN.bottom}
          x2={PLOT_W - PLOT_MARGIN.right}
          y2={PLOT_H - PLOT_MARGIN.bottom}
          className="ws-gaia-axis"
        />
        <line
          x1={PLOT_MARGIN.left}
          y1={PLOT_MARGIN.top}
          x2={PLOT_MARGIN.left}
          y2={PLOT_H - PLOT_MARGIN.bottom}
          className="ws-gaia-axis"
        />
        <text x={(PLOT_MARGIN.left + PLOT_W - PLOT_MARGIN.right) / 2} y={PLOT_H - 8} textAnchor="middle" className="ws-gaia-axis-label">
          {gaiaCopy.pmraAxis}
        </text>
        <text
          x={14}
          y={(PLOT_MARGIN.top + PLOT_H - PLOT_MARGIN.bottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(PLOT_MARGIN.top + PLOT_H - PLOT_MARGIN.bottom) / 2})`}
          className="ws-gaia-axis-label"
        >
          {gaiaCopy.pmdecAxis}
        </text>
        <line x1={gx} y1={gy} x2={mx} y2={my} className="ws-gaia-vector" />
        <circle cx={gx} cy={gy} r={5} className="ws-gaia-point" />
        <line x1={errLeft} y1={my} x2={errRight} y2={my} className="ws-gaia-error" />
        <line x1={mx} y1={errLow} x2={mx} y2={errHigh} className="ws-gaia-error" />
        <rect x={mx - 4.5} y={my - 4.5} width={9} height={9} className="ws-gaia-measured" />
      </svg>
      <p className="ws-sr">{alternative}</p>
      <ul className="ws-gaia-legend">
        <li>
          <span className="ws-gaia-swatch ws-gaia-swatch--gaia" aria-hidden="true" />
          {gaiaCopy.gaiaPoint}
        </li>
        <li>
          <span className="ws-gaia-swatch ws-gaia-swatch--measured" aria-hidden="true" />
          {gaiaCopy.measuredPoint}
        </li>
        <li>
          <span className="ws-gaia-swatch ws-gaia-swatch--vector" aria-hidden="true" />
          {gaiaCopy.differenceVector}
        </li>
      </ul>
      <dl className="ws-gaia-facts">
        <div>
          <dt>{gaiaCopy.deltaPmra}</dt>
          <dd className="ws-num">{formatQuantity(consistency.delta_pmra_mas_yr)}</dd>
        </div>
        <div>
          <dt>{gaiaCopy.deltaPmdec}</dt>
          <dd className="ws-num">{formatQuantity(consistency.delta_pmdec_mas_yr)}</dd>
        </div>
        <div>
          <dt>{gaiaCopy.sigmaCombined}</dt>
          <dd className="ws-num">{formatQuantity(consistency.sigma_combined_mas_yr)}</dd>
        </div>
      </dl>
      <p className="ws-gaia-line">{within}</p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="ws-num">{value}</dd>
    </div>
  )
}

export function GaiaPanel({ meta, gaia }: { meta?: Meta; gaia?: Gaia } = {}) {
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  const fov = useWorkspaceStore((state) => state.view.fov)
  const setView = useWorkspaceStore((state) => state.setView)
  const setFrameFocus = useWorkspaceStore((state) => state.setFrameFocus)
  const resolvedMeta = meta ?? dataset?.meta
  const resolvedGaia = gaia ?? dataset?.gaia
  if (!resolvedMeta || !resolvedGaia) return null
  return (
    <GaiaPanelView
      meta={resolvedMeta}
      gaia={resolvedGaia}
      onFocusSource={(source) => {
        setView({ ra: source.ra_deg, dec: source.dec_deg, fov })
        const pixel = worldToPixel(source.ra_deg, source.dec_deg, resolvedMeta.grid)
        if (!pixel) return
        setFrameFocus({ x: pixel.x, y: pixel.y })
      }}
    />
  )
}

function GaiaPanelView({
  meta,
  gaia,
  onFocusSource,
}: {
  meta: Meta
  gaia: Gaia
  onFocusSource: (source: GaiaSource) => void
}) {
  const note = slugNote(meta.slug)
  const unavailable = gaia.verdict === 'unavailable'
  const target = meta.target
  const processing = meta.processing
  const primary = gaia.sources.find((source) => source.is_primary) ?? null
  const gaiaPmra = primary?.pmra_mas_yr ?? null
  const gaiaPmdec = primary?.pmdec_mas_yr ?? null
  const showPlot =
    gaia.consistency !== null &&
    gaia.measured_pm !== null &&
    gaiaPmra !== null &&
    gaiaPmdec !== null

  return (
    <article className="ws-gaia">
      <header className="ws-gaia-block">
        <h2>
          <VerdictMark verdict={gaia.verdict} />
        </h2>
        <p className="ws-gaia-line">{gaia.verdict_detail}</p>
        {unavailable ? <p className="ws-gaia-line">{verdictUnavailableExplanation}</p> : null}
        {note ? <p className="ws-gaia-note">{note}</p> : null}
        {unavailable ? null : (
          <dl className="ws-gaia-facts">
            <Fact label={gaiaCopy.matchRadius} value={`${gaia.match_radius_arcsec} ${gaiaCopy.arcsec}`} />
            <Fact label={gaiaCopy.sourcesInCone} value={String(gaia.n_sources_in_cone)} />
          </dl>
        )}
      </header>

      {unavailable ? null : (
        <section className="ws-gaia-block" aria-label={gaiaCopy.targetMotion}>
          <h3>{gaiaCopy.targetMotion}</h3>
          <dl className="ws-gaia-facts">
            <Fact label={gaiaCopy.pmSource} value={target.pm_source} />
            <Fact label={gaiaCopy.pmReference} value={target.pm_reference ?? gaiaCopy.none} />
            <Fact label={gaiaCopy.pmraMasYr} value={quantity(target.pmra_mas_yr, gaiaCopy.none)} />
            <Fact label={gaiaCopy.pmdecMasYr} value={quantity(target.pmdec_mas_yr, gaiaCopy.none)} />
            <Fact label={gaiaCopy.parallaxMas} value={quantity(target.parallax_mas, gaiaCopy.none)} />
          </dl>
          {target.coord_epoch_assumed ? <p className="ws-gaia-note">{gaiaCopy.epochAssumedJ2000}</p> : null}
        </section>
      )}

      {unavailable ? null : (
        <section className="ws-gaia-block" data-block="measured-motion" aria-label={gaiaCopy.measuredMotion}>
          <h3>{gaiaCopy.measuredMotion}</h3>
          {gaia.measured_pm ? (
            <dl className="ws-gaia-facts">
              <Fact label={gaiaCopy.pmraMasYr} value={withError(gaia.measured_pm.pmra_mas_yr, gaia.measured_pm.pmra_err_mas_yr)} />
              <Fact
                label={gaiaCopy.pmdecMasYr}
                value={withError(gaia.measured_pm.pmdec_mas_yr, gaia.measured_pm.pmdec_err_mas_yr)}
              />
              <Fact label={gaiaCopy.framesUsed} value={String(gaia.measured_pm.n_frames_used)} />
              <Fact label={gaiaCopy.epochsUsed} value={String(gaia.measured_pm.n_epochs_used)} />
              <Fact label={gaiaCopy.baselineDays} value={formatQuantity(gaia.measured_pm.baseline_days)} />
              <Fact label={gaiaCopy.method} value={gaia.measured_pm.method} />
            </dl>
          ) : (
            <p className="ws-gaia-line">
              {measuredMotionUnavailable(processing.pm_fit_min_epochs, processing.pm_fit_min_baseline_days)}
            </p>
          )}
        </section>
      )}

      {unavailable ? null : (
        <section className="ws-gaia-block" aria-label={gaiaCopy.comparison}>
          <h3>{gaiaCopy.comparison}</h3>
          {showPlot && gaia.consistency && gaia.measured_pm && gaiaPmra !== null && gaiaPmdec !== null ? (
            <ComparisonPlot
              gaiaPmra={gaiaPmra}
              gaiaPmdec={gaiaPmdec}
              measured={gaia.measured_pm}
              consistency={gaia.consistency}
            />
          ) : (
            <p className="ws-gaia-line">{comparisonReason(gaia)}</p>
          )}
        </section>
      )}

      {unavailable ? null : (
        <section className="ws-gaia-block" data-block="sources" aria-label={gaiaCopy.sources}>
          <h3>{gaiaCopy.sources}</h3>
          <div className="ws-gaia-table-wrap">
            <table className="ws-gaia-table">
              <thead>
                <tr>
                  <th scope="col">{gaiaCopy.sourceId}</th>
                  <th scope="col">{gaiaCopy.photGMeanMag}</th>
                  <th scope="col">{gaiaCopy.parallaxMas}</th>
                  <th scope="col">{gaiaCopy.pmraMasYr}</th>
                  <th scope="col">{gaiaCopy.pmdecMasYr}</th>
                  <th scope="col">{gaiaCopy.separationArcsec}</th>
                  <th scope="col">{gaiaCopy.primary}</th>
                </tr>
              </thead>
              <tbody>
                {gaia.sources.map((source) => (
                  <tr key={source.source_id}>
                    <td>
                      <button
                        type="button"
                        className="ws-gaia-rowhit ws-num"
                        aria-label={`${gaiaCopy.centreOnSource} ${source.source_id}`}
                        onClick={() => onFocusSource(source)}
                      >
                        {source.source_id}
                      </button>
                      <button
                        type="button"
                        className="ws-pill liquid-glass-btn ws-gaia-copy"
                        aria-label={`${gaiaCopy.copy} ${source.source_id}`}
                        onClick={() => {
                          copyText(source.source_id)
                        }}
                      >
                        {gaiaCopy.copy}
                      </button>
                    </td>
                    <td className="ws-num">{quantity(source.phot_g_mean_mag, gaiaCopy.notAvailable)}</td>
                    <td className="ws-num">{quantity(source.parallax_mas, gaiaCopy.notAvailable)}</td>
                    <td className="ws-num">{quantity(source.pmra_mas_yr, gaiaCopy.notAvailable)}</td>
                    <td className="ws-num">{quantity(source.pmdec_mas_yr, gaiaCopy.notAvailable)}</td>
                    <td className="ws-num">{formatQuantity(source.separation_arcsec)}</td>
                    <td>{source.is_primary ? gaiaCopy.primary : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {unavailable ? null : (
        <details className="ws-gaia-block">
          <summary className="cursor-pointer select-none text-xs font-medium text-zinc-700 dark:text-white/75 hover:text-black dark:hover:text-[rgb(240,255,60)] transition-colors">
            {gaiaCopy.queryDetails}
          </summary>
          <dl className="ws-gaia-facts">
            <Fact label={gaiaCopy.executedUtc} value={gaia.query.executed_utc} />
            <Fact label={gaiaCopy.radiusArcsec} value={formatQuantity(gaia.query.radius_arcsec)} />
            <Fact label={gaiaCopy.table} value={gaia.query.table} />
            <Fact label={gaiaCopy.endpoint} value={gaia.query.endpoint} />
          </dl>
          <div className="ws-gaia-adql-row">
            <pre className="ws-adql">{gaia.query.adql}</pre>
            <button
              type="button"
              className="ws-pill liquid-glass-btn"
              onClick={() => {
                copyText(gaia.query.adql)
              }}
            >
              {gaiaCopy.copy}
            </button>
          </div>
        </details>
      )}

      {unavailable ? null : (
        <span className="ws-tip-anchor">
          <button type="button" className="ws-pill liquid-glass-btn" disabled title={gaiaCopy.rerunDisabledTooltip}>
            {gaiaCopy.rerunWithProperMotion}
          </button>
          <span className="ws-tip" role="tooltip">
            {gaiaCopy.rerunDisabledTooltip}
          </span>
        </span>
      )}
    </article>
  )
}
