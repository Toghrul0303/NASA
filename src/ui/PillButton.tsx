import type { ReactNode } from 'react'
import { ArrowUpRightIcon } from './icons'

type PillButtonProps = {
  href: string
  variant?: 'primary' | 'secondary' | 'icon'
  children?: ReactNode
  icon?: ReactNode
  ariaLabel?: string
  className?: string
  onClick?: () => void
}

function classNames(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.length > 0)).join(' ')
}

const PRIMARY_CLASS =
  'rounded-full px-7 py-3.5 text-sm inline-flex items-center gap-2.5 border border-[rgb(240,255,60)] bg-[rgb(240,255,60)] text-black font-medium shadow-[0_0_28px_rgba(240,255,60,0.25)] hover:brightness-105 hover:shadow-[0_0_36px_rgba(240,255,60,0.40)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(240,255,60)] focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-all'

export function PillButton({
  href,
  variant = 'primary',
  children,
  icon,
  ariaLabel,
  className,
  onClick,
}: PillButtonProps) {
  if (variant === 'primary') {
    return (
      <a href={href} className={classNames(PRIMARY_CLASS, className)} aria-label={ariaLabel} onClick={onClick}>
        <span>{children}</span>
        <ArrowUpRightIcon className="w-4 h-4 text-black" />
      </a>
    )
  }

  return (
    <a
      href={href}
      className={classNames('pill-button', `pill-button--${variant}`, className)}
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      {variant === 'icon' ? (
        icon
      ) : (
        <>
          {icon && <span className="pill-button__leading-icon">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </a>
  )
}
