/**
 * Detector buttons D1–D6. FRONTEND_SPEC §10.2, §15.4.
 * Disabled detectors stay focusable so the "No frames" tooltip is not hover-only.
 */
import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Detector } from '../../contract/types'

const DETECTOR_LIST = [1, 2, 3, 4, 5, 6] as const satisfies readonly Detector[]

export function DetectorPicker({
  enabled,
  value,
  onChange,
}: {
  enabled: readonly Detector[]
  value: Detector
  onChange: (detector: Detector) => void
}) {
  const prefix = useId()
  const enabledSet = useMemo(() => new Set<number>(enabled), [enabled])
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const selectedIndex = DETECTOR_LIST.indexOf(value)
  const tabOwner = focusIndex ?? (selectedIndex >= 0 ? selectedIndex : 0)

  function move(next: number): void {
    const detector = DETECTOR_LIST[next]
    if (detector === undefined) return
    setFocusIndex(next)
    refs.current[next]?.focus()
    if (enabledSet.has(detector)) onChange(detector)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const active = refs.current.findIndex((node) => node === document.activeElement)
    const index = active >= 0 ? active : tabOwner
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % DETECTOR_LIST.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + DETECTOR_LIST.length - 1) % DETECTOR_LIST.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = DETECTOR_LIST.length - 1
    else return
    event.preventDefault()
    event.stopPropagation()
    move(next)
  }

  function onBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    setFocusIndex(null)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Detector"
      className="ws-det"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {DETECTOR_LIST.map((detector, index) => {
        const isEnabled = enabledSet.has(detector)
        const tipId = `${prefix}-tip-${detector}`
        return (
          <button
            key={detector}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={detector === value}
            aria-disabled={!isEnabled}
            aria-label={isEnabled ? `D${detector}` : `D${detector}, no frames`}
            aria-describedby={isEnabled ? undefined : tipId}
            tabIndex={index === tabOwner ? 0 : -1}
            className="ws-det-btn"
            onFocus={() => setFocusIndex(index)}
            onClick={() => {
              setFocusIndex(index)
              if (isEnabled) onChange(detector)
            }}
          >
            D{detector}
            {isEnabled ? null : (
              <span role="tooltip" id={tipId} className={focusIndex === index ? 'ws-tip is-open' : 'ws-tip'}>
                No frames
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
