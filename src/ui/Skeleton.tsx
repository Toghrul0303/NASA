function classNames(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.length > 0)).join(' ')
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={classNames('ws-skeleton', className)} aria-hidden="true" />
}
