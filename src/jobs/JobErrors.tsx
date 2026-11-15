/**
 * Failed job and 422 field errors. The lab tabs are left alone.
 */
import { requestErrors, tier2Copy, tier2FieldIssue } from '../config/copy'
import type { JobFailureView, JobFieldError } from '../state/store'

export function JobErrors({
  failure,
  fieldErrors,
  errorMessage,
  onRetry,
}: {
  failure: JobFailureView | null
  fieldErrors: readonly JobFieldError[]
  errorMessage: string | null
  onRetry: () => void
}) {
  const invalid = fieldErrors.length > 0
  if (!failure && !invalid) return null
  return (
    <div className="space-y-3">
      {failure ? (
        <div
          data-testid="tier2-failed"
          className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-100"
          role="alert"
        >
          <p className="m-0 font-medium">{tier2Copy.failedPlain}</p>
          <p className="m-0 mt-1 font-mono text-xs">
            {tier2Copy.code} {failure.code}
          </p>
          {failure.message ? (
            <p className="m-0 mt-1 text-xs">
              {tier2Copy.message} {failure.message}
            </p>
          ) : null}
          {failure.retryable ? (
            <button
              type="button"
              className="liquid-glass-cta mt-2 rounded-full px-3 py-1 text-xs font-medium"
              onClick={onRetry}
            >
              {tier2Copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}
      {invalid ? (
        <div
          data-testid="tier2-invalid"
          className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
          role="alert"
        >
          <p className="m-0 font-medium">{errorMessage || requestErrors.invalid_request}</p>
          <ul className="mt-1.5 mb-0 list-disc pl-4 text-xs">
            {fieldErrors.map((detail) => (
              <li key={`${detail.field}:${detail.issue}`}>{tier2FieldIssue(detail.field, detail.issue)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
