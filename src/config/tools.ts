/**
 * Tool enum, labels, and the keyboard shortcuts named in the spec.
 * URL values are FRONTEND_SPEC §5.1. Blink keys are §10.6.
 */

export const TOOL_IDS = ['map', 'blink', 'diff', 'rgb', 'sed', 'gaia'] as const

export type ToolId = (typeof TOOL_IDS)[number]

/** Keys as named in §10.6. `Space` is the space bar; `[` and `]` change FPS. */
export const BLINK_SHORTCUTS = {
  stepPrevious: 'ArrowLeft',
  stepNext: 'ArrowRight',
  jumpStart: 'Home',
  jumpEnd: 'End',
  playPause: 'Space',
  fpsDecrease: '[',
  fpsIncrease: ']',
} as const

export type BlinkShortcut = (typeof BLINK_SHORTCUTS)[keyof typeof BLINK_SHORTCUTS]

export interface ToolDefinition {
  id: ToolId
  label: string
  /** `map` closes the lab. */
  closesLab: boolean
  shortcuts: readonly BlinkShortcut[]
}

export const TOOLS: readonly ToolDefinition[] = [
  { id: 'map', label: 'Map', closesLab: true, shortcuts: [] },
  {
    id: 'blink',
    label: 'Blink',
    closesLab: false,
    shortcuts: [
      BLINK_SHORTCUTS.stepPrevious,
      BLINK_SHORTCUTS.stepNext,
      BLINK_SHORTCUTS.jumpStart,
      BLINK_SHORTCUTS.jumpEnd,
      BLINK_SHORTCUTS.playPause,
      BLINK_SHORTCUTS.fpsDecrease,
      BLINK_SHORTCUTS.fpsIncrease,
    ],
  },
  { id: 'diff', label: 'Difference', closesLab: false, shortcuts: [] },
  { id: 'rgb', label: 'False-colour RGB', closesLab: false, shortcuts: [] },
  { id: 'sed', label: 'SED', closesLab: false, shortcuts: [] },
  { id: 'gaia', label: 'Gaia check', closesLab: false, shortcuts: [] },
]

/** Difference-tool mode names. FRONTEND_SPEC §11. */
export const DIFF_MODE_LABELS = {
  temporal: 'Temporal difference (movers, variables)',
  spectral: 'Spectral difference (colour excess)',
} as const

const TOOL_ID_SET: ReadonlySet<string> = new Set(TOOL_IDS)

export function isToolId(value: string): value is ToolId {
  return TOOL_ID_SET.has(value)
}

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((entry) => entry.id === id)
  if (!tool) {
    throw new Error(`Unknown tool: ${id}`)
  }
  return tool
}
