import type { GaiaVerdict } from '../contract/types'

/** Verdict colours from FRONTEND_SPEC §14.1 / §15.3. Same hex as the CSS tokens. */
export const VERDICT_COLOR: Record<GaiaVerdict, string> = {
  match_consistent: '#009E73',
  match_inconsistent: '#F5A524',
  no_counterpart: '#56B4E9',
  unavailable: '#999999',
}

export function verdictColor(verdict: GaiaVerdict): string {
  return VERDICT_COLOR[verdict]
}
