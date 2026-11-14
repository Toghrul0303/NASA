import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabOption {
  id: string
  label: string
}

/**
 * ARIA tabs with a roving tabindex. Arrow keys move the active tab.
 * FRONTEND_SPEC §15.4.
 */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
  actions,
  children,
}: {
  label: string
  tabs: readonly TabOption[]
  value: string
  onChange: (id: string) => void
  actions?: ReactNode
  children: ReactNode
}) {
  const prefix = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = tabs.findIndex((tab) => tab.id === value)
  const activeIndex = selectedIndex === -1 ? 0 : selectedIndex

  function moveTo(index: number): void {
    if (tabs.length === 0) return
    const next = (index + tabs.length) % tabs.length
    const tab = tabs[next]
    if (!tab) return
    onChange(tab.id)
    tabRefs.current[next]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveTo(activeIndex + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveTo(activeIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveTo(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveTo(-1)
    }
  }

  const selected = tabs.find((tab) => tab.id === value)

  return (
    <div className="ws-tabs-root">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-black/15 dark:border-white/10">
        <div
          className="liquid-glass-bar inline-flex items-center gap-1 rounded-full p-1 overflow-x-auto max-w-full"
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab, index) => {
            const isSelected = tab.id === value
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[index] = node
                }}
                id={`${prefix}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`${prefix}-panel`}
                tabIndex={index === activeIndex ? 0 : -1}
                className={
                  isSelected
                    ? 'liquid-glass-btn-active rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap'
                    : 'liquid-glass-btn rounded-full px-3 py-1 text-xs whitespace-nowrap'
                }
                onClick={() => onChange(tab.id)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        {actions}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel`}
        aria-labelledby={selected ? `${prefix}-tab-${selected.id}` : undefined}
        tabIndex={0}
        className="ws-lab-scroll"
      >
        {children}
      </div>
    </div>
  )
}
