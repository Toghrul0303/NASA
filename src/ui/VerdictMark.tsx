import type { GaiaVerdict } from '../contract/types'
import { verdictHeadlines } from '../config/copy'
import { CheckIcon, DashIcon, StarOutlineIcon, WarningIcon } from './icons'

const VERDICT_MARK = {
  match_consistent: { tone: 'text-verdict-consistent', Icon: CheckIcon },
  match_inconsistent: { tone: 'text-verdict-inconsistent', Icon: WarningIcon },
  no_counterpart: { tone: 'text-verdict-none', Icon: StarOutlineIcon },
  unavailable: { tone: 'text-verdict-unavailable', Icon: DashIcon },
} as const satisfies Record<GaiaVerdict, { tone: string; Icon: typeof CheckIcon }>

/** Icon plus the verdict headline. Colour is never the only cue. §14.1, §15.3. */
export function VerdictMark({ verdict }: { verdict: GaiaVerdict }) {
  const mark = VERDICT_MARK[verdict]
  const Icon = mark.Icon
  return (
    <span className={`ws-gaia-chip ${mark.tone}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-zinc-950 dark:text-white">{verdictHeadlines[verdict]}</span>
    </span>
  )
}
