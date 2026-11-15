/**
 * Queued, running, and complete status for a Tier 2 job.
 * F15 does not render a frame preview or a streamed progress bar.
 */
import { jobStatus, queuePosition, tier2Copy } from '../config/copy'
import type { JobUiStatus } from '../state/store'

export function JobProgress({
  status,
  queuePositionValue,
  joined,
  slug,
}: {
  status: JobUiStatus
  queuePositionValue: number | null
  joined: boolean
  slug: string | null
}) {
  if (status !== 'submitting' && status !== 'queued' && status !== 'running' && status !== 'complete') return null
  const label =
    status === 'submitting'
      ? tier2Copy.submitting
      : status === 'queued'
        ? tier2Copy.queued
        : status === 'running'
          ? tier2Copy.running
          : tier2Copy.complete
  return (
    <div data-testid="tier2-status" data-state={status} className="space-y-1 text-sm" role="status" aria-live="polite">
      <p className="m-0 font-medium text-white">{label}</p>
      {status === 'queued' && queuePositionValue !== null ? (
        <p className="m-0 text-white/75">{queuePosition(queuePositionValue)}</p>
      ) : null}
      {joined ? <p className="m-0 text-white/75">{jobStatus.joinedExisting}</p> : null}
      {status === 'complete' && slug ? (
        <p className="m-0 font-mono text-xs text-white/70">
          {tier2Copy.datasetSlug} {slug}
        </p>
      ) : null}
    </div>
  )
}
