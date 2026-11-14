import type { ReactNode } from 'react'

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'partial' }) {
  const className = tone === 'partial' ? 'ws-chip ws-chip--partial' : 'ws-chip'
  return <span className={className}>{children}</span>
}
