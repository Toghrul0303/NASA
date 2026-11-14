import { lazy, Suspense } from 'react'
import { datasetErrorMessage, framesNotFetched, gaiaCopy } from '../config/copy'
import { isToolId, TOOLS, toolById } from '../config/tools'
import type { Dataset } from '../data/dataset'
import { useWorkspaceStore } from '../state/store'
import { CloseIcon } from '../ui/icons'
import { Skeleton } from '../ui/Skeleton'
import { Tabs } from '../ui/Tabs'

const BlinkTool = lazy(() => import('./tools/BlinkTool').then((mod) => ({ default: mod.BlinkTool })))
const GaiaPanel = lazy(() => import('./tools/GaiaPanel').then((mod) => ({ default: mod.GaiaPanel })))

const LAB_TOOLS = TOOLS.filter((tool) => !tool.closesLab)
const LOAD_STEPS = ['meta', 'files', 'verification'] as const

function PartialBanner({ dataset }: { dataset: Dataset }) {
  if (dataset.meta.status !== 'partial') return null
  const failed = dataset.meta.observations.n_failed_fetches
  const uris = dataset.meta.observations.failed_source_uris
  return (
    <div
      className="mx-3 mt-3 rounded-xl bg-amber-500/15 dark:bg-amber-500/10 border border-amber-600/30 dark:border-amber-400/25 text-amber-950 dark:text-amber-200 text-xs px-3.5 py-2.5"
      role="status"
    >
      <p className="m-0 font-medium">{framesNotFetched(failed)}</p>
      <details className="mt-1.5">
        <summary className="cursor-pointer select-none text-amber-900/85 dark:text-amber-200/80 hover:text-amber-950 dark:hover:text-amber-100">
          Failed source URIs
        </summary>
        {uris.length === 0 ? (
          <p className="mt-1.5 m-0 text-amber-900/80 dark:text-amber-200/75">No source URIs were recorded.</p>
        ) : (
          <ul className="mt-1.5 mb-0 pl-4 space-y-0.5">
            {uris.map((uri, index) => (
              <li key={`${uri}-${index}`} className="font-mono tabular-nums break-all">
                {uri}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}

function DatasetState({ onRetry }: { onRetry: () => void }) {
  const status = useWorkspaceStore((state) => state.dataset.status)
  const errorCode = useWorkspaceStore((state) => state.dataset.errorCode)
  const tool = useWorkspaceStore((state) => state.tool.tool)

  if (status === 'loading') {
    return (
      <div
        className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-black/15 dark:border-white/10 p-4 space-y-3"
        role="status"
        aria-label="Loading dataset"
      >
        <Skeleton className="h-4 w-48" />
        <ul className="ws-steps">
          {LOAD_STEPS.map((step) => (
            <li key={step}>
              <span className="text-xs font-mono text-zinc-600 dark:text-[#A1A1AA]">{step}</span>
              <Skeleton />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div
        className="rounded-2xl bg-red-500/10 border border-red-500/30 dark:border-red-500/25 p-5 text-red-900 dark:text-red-200 space-y-3"
        role="alert"
      >
        <p className="m-0 text-sm">{datasetErrorMessage(errorCode ?? 'invalid')}</p>
        <button
          type="button"
          className="rounded-full bg-zinc-900 dark:bg-transparent border border-[#E4F222]/70 text-[#E4F222] hover:bg-[#E4F222] hover:text-black px-4 py-1.5 text-xs font-medium transition-colors"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    )
  }

  if (status !== 'ready' || tool === 'map') {
    return (
      <div className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-black/15 dark:border-white/10 p-4">
        <p className="m-0 text-sm text-zinc-600 dark:text-[#A1A1AA]">Pick a target</p>
      </div>
    )
  }

  if (tool === 'blink') {
    return (
      <Suspense
        fallback={
          <div
            className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-black/15 dark:border-white/10 p-4 text-sm text-zinc-600 dark:text-[#A1A1AA]"
            role="status"
          >
            Loading blink
          </div>
        }
      >
        <BlinkTool />
      </Suspense>
    )
  }

  if (tool === 'gaia') {
    return (
      <Suspense
        fallback={
          <div
            className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-black/15 dark:border-white/10 p-4 text-sm text-zinc-600 dark:text-[#A1A1AA]"
            role="status"
          >
            {gaiaCopy.loading}
          </div>
        }
      >
        <GaiaPanel />
      </Suspense>
    )
  }

  const active = toolById(tool)
  return (
    <article className="rounded-2xl bg-white dark:bg-[#0D0D12] border border-black/15 dark:border-white/10 p-4">
      <h2 className="m-0 mb-2 text-base font-medium text-zinc-950 dark:text-white">{active.label}</h2>
      <p className="m-0 text-sm text-zinc-600 dark:text-[#A1A1AA]">Coming in a later step</p>
    </article>
  )
}

/** Lab sidebar: tool tabs bound to the store. `map` closes the lab. */
export function Lab() {
  const tool = useWorkspaceStore((state) => state.tool.tool)
  const setTool = useWorkspaceStore((state) => state.setTool)
  const status = useWorkspaceStore((state) => state.dataset.status)
  const dataset = useWorkspaceStore((state) => state.dataset.dataset)
  const slug = useWorkspaceStore((state) => state.dataset.slug)
  const loadDataset = useWorkspaceStore((state) => state.loadDataset)

  return (
    <div className="ws-lab-fill">
      {status === 'ready' && dataset ? <PartialBanner dataset={dataset} /> : null}
      <Tabs
        label="Laboratory tools"
        tabs={LAB_TOOLS.map((entry) => ({ id: entry.id, label: entry.label }))}
        value={tool}
        onChange={(id) => {
          if (isToolId(id)) setTool(id)
        }}
        actions={
          status === 'ready' ? (
            <button
              type="button"
              className="rounded-full w-7 h-7 shrink-0 flex items-center justify-center border border-black/15 dark:border-white/10 text-zinc-600 dark:text-white/60 hover:text-black dark:hover:text-white hover:border-black/35 dark:hover:border-white/30 transition-colors"
              aria-label="Close lab"
              onClick={() => setTool('map')}
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          ) : null
        }
      >
        <DatasetState
          onRetry={() => {
            if (slug) void loadDataset(slug)
          }}
        />
      </Tabs>
    </div>
  )
}
