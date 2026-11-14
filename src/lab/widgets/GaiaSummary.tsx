import { gaiaCopy } from '../../config/copy'
import { useWorkspaceStore } from '../../state/store'
import { VerdictMark } from '../../ui/VerdictMark'

/** Compact verdict chip plus one line. Opens the Gaia check. Docked under the Blink caption; Diff reuses it in F12. */
export function GaiaSummary() {
  const gaia = useWorkspaceStore((state) => state.dataset.dataset?.gaia)
  const setTool = useWorkspaceStore((state) => state.setTool)
  if (!gaia) return null
  return (
    <button type="button" className="ws-gaia-summary" aria-label={gaiaCopy.openGaiaCheck} onClick={() => setTool('gaia')}>
      <VerdictMark verdict={gaia.verdict} />
      <span className="ws-gaia-line">{gaia.verdict_detail}</span>
    </button>
  )
}
