import { datasetErrorMessage, framesNotFetched } from '../config/copy'
import { isToolId, TOOLS, toolById } from '../config/tools'
import type { Dataset } from '../data/dataset'
import { useWorkspaceStore } from '../state/store'
import { CloseIcon } from '../ui/icons'
import { Skeleton } from '../ui/Skeleton'
import { Tabs } from '../ui/Tabs'
import { BlinkStub } from './BlinkStub'

const LAB_TOOLS = TOOLS.filter((tool) => !tool.closesLab)
const LOAD_STEPS = ['meta', 'files', 'verification'] as const

function PartialBanner({ dataset }: { dataset: Dataset }) {
  if (dataset.meta.status !== 'partial') return null
  const failed = dataset.meta.observations.n_failed_fetches
  const uris = dataset.meta.observations.failed_source_uris
  return (
    <div className="ws-banner" role="status">
      <p>{framesNotFetched(failed)}</p>
      <details>
        <summary>Failed source URIs</summary>
        {uris.length === 0 ? (
          <p>No source URIs were recorded.</p>
        ) : (
          <ul>
            {uris.map((uri, index) => (
              <li key={`${uri}-${index}`} className="ws-num">
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
      <div className="ws-state" role="status" aria-label="Loading dataset">
        <Skeleton className="ws-skeleton--title" />
        <ul className="ws-steps">
          {LOAD_STEPS.map((step) => (
            <li key={step}>
              <span>{step}</span>
              <Skeleton />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="ws-state" role="alert">
        <p>{datasetErrorMessage(errorCode ?? 'invalid')}</p>
        <button type="button" className="ws-pill ws-pill--primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (status !== 'ready' || tool === 'map') {
    return (
      <div className="ws-state">
        <p>Pick a target</p>
      </div>
    )
  }

  if (tool === 'blink') return <BlinkStub />

  const active = toolById(tool)
  return (
    <article className="ws-card">
      <h2>{active.label}</h2>
      <p>Coming in a later step</p>
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
            <button type="button" className="ws-icon-button" aria-label="Close lab" onClick={() => setTool('map')}>
              <CloseIcon />
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
