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

export function PillButton({
  href,
  variant = 'primary',
  children,
  icon,
  ariaLabel,
  className,
  onClick,
}: PillButtonProps) {
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
          {variant === 'primary' && <ArrowUpRightIcon />}
        </>
      )}
    </a>
  )
}
