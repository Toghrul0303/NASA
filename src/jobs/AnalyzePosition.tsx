/**
 * "Analyze this position" panel. Size choices are exactly 0.05, 0.1, and 0.2 degrees.
 */
import { useEffect, useId, useState } from 'react'
import { env } from '../config/env'
import { tier2Copy, tier2SizeLabel } from '../config/copy'
import {
  DEFAULT_SIZE_DEG,
  INVALID_SIZE_BODY,
  SAFE_TIER2_PRESET,
  SIZE_DEG_CHOICES,
  TIER2_PRESETS,
  buildJobRequest,
  type JobRequest,
  type JobRequestOptions,
  type SizeDeg,
  type Tier2Preset,
  type Tier2PresetId,
} from '../core/tier2'
import type { MockJobState } from '../api/tier2Client'
import { useWorkspaceStore, type Tier2Body } from '../state/store'
import { JobErrors } from './JobErrors'
import { JobProgress } from './JobProgress'

function formatCoord(value: number): string {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function presetBody(preset: Tier2Preset, sizeDeg: SizeDeg): JobRequest {
  if (preset.body.size_deg === sizeDeg) return preset.body
  const options: JobRequestOptions = {}
  if ('name' in preset.body) options.name = preset.body.name ?? null
  if ('pmra_mas_yr' in preset.body) options.pmraMasYr = preset.body.pmra_mas_yr ?? null
  if ('pmdec_mas_yr' in preset.body) options.pmdecMasYr = preset.body.pmdec_mas_yr ?? null
  return buildJobRequest(preset.body.ra_deg, preset.body.dec_deg, sizeDeg, options)
}

export function AnalyzePosition({ ra, dec, onClose }: { ra: number; dec: number; onClose: () => void }) {
  const [sizeDeg, setSizeDeg] = useState<SizeDeg>(DEFAULT_SIZE_DEG)
  const [presetId, setPresetId] = useState<Tier2PresetId | null>(SAFE_TIER2_PRESET.id)
  const [mockState, setMockState] = useState<MockJobState | ''>('')
  const job = useWorkspaceStore((state) => state.job)
  const submitTier2 = useWorkspaceStore((state) => state.submitTier2)
  const retryTier2 = useWorkspaceStore((state) => state.retryTier2)
  const cancelTier2 = useWorkspaceStore((state) => state.cancelTier2)
  const setView = useWorkspaceStore((state) => state.setView)
  const fov = useWorkspaceStore((state) => state.view.fov)
  const titleId = useId()
  const sizeName = useId()
  const preset = TIER2_PRESETS.find((entry) => entry.id === presetId) ?? null
  const shownRa = preset ? preset.body.ra_deg : ra
  const shownDec = preset ? preset.body.dec_deg : dec
  const busy = job.status === 'submitting' || job.status === 'queued' || job.status === 'running'
  const sizeError = job.fieldErrors.some((detail) => detail.field === 'size_deg')

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      cancelTier2()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelTier2, onClose])

  if (job.status === 'complete' && job.cached) return null

  function choosePreset(next: Tier2Preset): void {
    if (presetId === next.id) {
      setPresetId(null)
      return
    }
    setPresetId(next.id)
    if (next.body.size_deg) setSizeDeg(next.body.size_deg)
    setView({ ra: next.body.ra_deg, dec: next.body.dec_deg, fov })
  }

  function runBody(): Tier2Body {
    if (mockState === 'invalid') return INVALID_SIZE_BODY
    if (preset) return presetBody(preset, sizeDeg)
    return buildJobRequest(shownRa, shownDec, sizeDeg)
  }

  function close(): void {
    cancelTier2()
    onClose()
  }

  return (
    <section
      className="pointer-events-auto absolute bottom-4 left-4 z-40 w-[min(100%-2rem,24rem)] max-h-[min(100%-2rem,36rem)] overflow-auto rounded-2xl border border-white/15 bg-[#0B0C10]/92 p-4 text-white shadow-xl"
      role="dialog"
      aria-labelledby={titleId}
      data-testid="tier2-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="m-0 text-sm font-semibold">
          {tier2Copy.title}
        </h2>
        <button type="button" className="liquid-glass-btn rounded-full px-2.5 py-1 text-xs" onClick={close}>
          {tier2Copy.close}
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-white/60">{tier2Copy.ra}</dt>
        <dd className="m-0 font-mono tabular-nums" data-testid="tier2-ra">
          {formatCoord(shownRa)}
        </dd>
        <dt className="text-white/60">{tier2Copy.dec}</dt>
        <dd className="m-0 font-mono tabular-nums" data-testid="tier2-dec">
          {formatCoord(shownDec)}
        </dd>
      </dl>
      <fieldset className="mt-3 border-0 p-0" aria-invalid={sizeError || undefined}>
        <legend className="text-xs text-white/70">{tier2Copy.size}</legend>
        <div className="mt-1.5 flex gap-2">
          {SIZE_DEG_CHOICES.map((size) => (
            <label
              key={size}
              className={
                sizeDeg === size
                  ? 'flex-1 cursor-pointer rounded-full border border-[rgb(240,255,60)]/70 bg-[rgb(240,255,60)]/15 px-2 py-1 text-center text-xs'
                  : 'flex-1 cursor-pointer rounded-full border border-white/15 px-2 py-1 text-center text-xs text-white/80'
              }
            >
              <input
                className="ws-sr"
                type="radio"
                name={sizeName}
                value={size}
                checked={sizeDeg === size}
                onChange={() => setSizeDeg(size)}
              />
              {tier2SizeLabel(size)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="liquid-glass-cta rounded-full px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          data-testid="tier2-run"
          disabled={busy}
          onClick={() => {
            void submitTier2(runBody(), mockState === '' ? undefined : mockState)
          }}
        >
          {tier2Copy.run}
        </button>
        <button
          type="button"
          className="liquid-glass-btn rounded-full px-3 py-1.5 text-xs disabled:opacity-50"
          data-testid="tier2-invalid-size"
          disabled={busy}
          onClick={() => {
            void submitTier2(INVALID_SIZE_BODY)
          }}
        >
          {tier2Copy.invalidSize}
        </button>
      </div>
      <div className="mt-3">
        <p className="m-0 text-xs text-white/70">{tier2Copy.presets}</p>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {TIER2_PRESETS.map((entry) => {
            const selected = entry.id === presetId
            return (
              <button
                key={entry.id}
                type="button"
                data-testid={`tier2-preset-${entry.id}`}
                aria-pressed={selected}
                className={
                  selected
                    ? 'rounded-xl border border-[rgb(240,255,60)]/70 bg-white/[0.06] px-3 py-2 text-left text-xs'
                    : 'rounded-xl border border-white/12 bg-transparent px-3 py-2 text-left text-xs text-white/85'
                }
                onClick={() => choosePreset(entry)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span>{entry.label}</span>
                  {entry.safe ? (
                    <span className="text-[10px] uppercase tracking-wide text-white/50">{tier2Copy.defaultPreset}</span>
                  ) : null}
                </span>
                {entry.safe ? null : (
                  <span className="mt-1 block text-amber-200" role="status">
                    {tier2Copy.mayFail}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      {env.useMocks ? (
        <label className="mt-3 block text-xs text-white/70">
          {tier2Copy.mockOutcome}
          <select
            className="mt-1 w-full rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs text-white"
            data-testid="tier2-mock"
            value={mockState}
            onChange={(event) => {
              const value = event.target.value
              if (
                value === '' ||
                value === 'cached' ||
                value === 'progress' ||
                value === 'partial' ||
                value === 'failed' ||
                value === 'invalid'
              ) {
                setMockState(value)
              }
            }}
          >
            <option value="">{tier2Copy.mockAutomatic}</option>
            <option value="cached">{tier2Copy.mockCached}</option>
            <option value="progress">{tier2Copy.mockProgress}</option>
            <option value="partial">{tier2Copy.mockPartial}</option>
            <option value="failed">{tier2Copy.mockFailed}</option>
            <option value="invalid">{tier2Copy.mockInvalid}</option>
          </select>
        </label>
      ) : null}
      <div className="mt-3 space-y-2">
        <JobProgress status={job.status} queuePositionValue={job.queuePosition} joined={job.joined} slug={job.slug} />
        <JobErrors
          failure={job.failure}
          fieldErrors={job.fieldErrors}
          errorMessage={job.errorMessage}
          onRetry={() => {
            void retryTier2()
          }}
        />
      </div>
    </section>
  )
}
