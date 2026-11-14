function classNames(...parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.length > 0)).join(' ')
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={classNames(
        'block h-3 rounded-xl bg-black/[0.08] dark:bg-white/[0.06] animate-pulse',
        className,
      )}
      aria-hidden="true"
    />
  )
}
