import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { useWorkspaceStore } from '../state/store'
import { AsteriskIcon, HomeIcon, InfoIcon, OrbitIcon } from './icons'

type NavbarSurface = 'home' | 'workspace'

type NavbarProps = {
  surface?: NavbarSurface
  rightSlot?: ReactNode
}

const ITEM_BASE =
  'flex flex-col items-center justify-center gap-1 w-[78px] h-[48px] rounded-full text-[11px] font-medium leading-none transition-all'
const ITEM_ACTIVE =
  'bg-white/[0.13] border border-white/[0.24] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)]'
const ITEM_IDLE = 'border border-transparent text-white/60 hover:text-white hover:bg-white/[0.06]'

function currentPath(): string {
  const path = window.location.pathname
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

function workspaceHref(slug: string | null, onWorkspace: boolean, viewKey: string): string {
  if (onWorkspace && (window.location.search.length > 1 || viewKey.length > 0)) {
    const params = new URLSearchParams(window.location.search)
    if (slug) params.set('slug', slug)
    const query = params.toString()
    return query.length > 0 ? `/workspace?${query}` : '/workspace'
  }
  if (slug) return `/workspace?slug=${encodeURIComponent(slug)}`
  return '/workspace'
}

export function Navbar({ surface, rightSlot }: NavbarProps) {
  const [pathname, setPathname] = useState(currentPath)
  const slug = useWorkspaceStore((state) => state.dataset.slug)
  const viewKey = useWorkspaceStore((state) => `${state.view.ra}|${state.view.dec}|${state.view.fov}|${state.tool.tool}`)

  useEffect(() => {
    function onPopState() {
      setPathname(currentPath())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const resolved: NavbarSurface = surface ?? (pathname === '/workspace' ? 'workspace' : 'home')
  const onWorkspace = resolved === 'workspace'
  const homeActive = !onWorkspace && pathname !== '/workspace'
  const aboutHref = pathname === '/' ? '#about' : '/#about'

  function onAboutClick(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname !== '/') return
    const about = document.getElementById('about')
    if (!about) return
    event.preventDefault()
    about.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (window.location.hash !== '#about') {
      window.history.pushState(null, '', '/#about')
    }
  }

  const surfaceClass = onWorkspace
    ? 'bg-[#05060A]/80 backdrop-blur-xl border-b border-white/[0.08]'
    : 'bg-transparent fixed top-0 inset-x-0'

  return (
    <header
      className={`w-full h-[76px] min-h-[76px] max-h-[76px] px-6 sm:px-8 grid grid-cols-[1fr_auto_1fr] items-center gap-3 z-30 shrink-0 select-none ${surfaceClass}`}
    >
      <div className="justify-self-start flex items-center gap-3 min-w-0">
        <a href="/" className="inline-flex items-center gap-2 min-w-0" aria-label="ExoTrace home">
          <AsteriskIcon className="w-4 h-4 text-white shrink-0" />
          <span className="text-sm font-semibold tracking-tight text-white">ExoTrace</span>
        </a>
      </div>

      <nav aria-label="Main navigation" className="justify-self-center">
        <div className="rounded-full bg-[#12141A]/75 backdrop-blur-xl border border-white/[0.14] px-2.5 py-1.5 inline-flex items-center gap-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_10px_30px_rgba(0,0,0,0.45)]">
          <a
            href="/"
            aria-current={homeActive ? 'page' : undefined}
            className={`${ITEM_BASE} ${homeActive ? ITEM_ACTIVE : ITEM_IDLE}`}
          >
            <HomeIcon className="w-4 h-4" />
            <span>Home</span>
          </a>
          <a href={aboutHref} className={`${ITEM_BASE} ${ITEM_IDLE}`} onClick={onAboutClick}>
            <InfoIcon className="w-4 h-4" />
            <span>About</span>
          </a>
          <a
            href={workspaceHref(slug, onWorkspace, viewKey)}
            aria-current={onWorkspace ? 'page' : undefined}
            className={`${ITEM_BASE} ${onWorkspace ? ITEM_ACTIVE : ITEM_IDLE}`}
            onMouseDown={(event) => {
              if (!onWorkspace) return
              event.currentTarget.setAttribute('href', workspaceHref(slug, true, viewKey))
            }}
            onFocus={(event) => {
              if (!onWorkspace) return
              event.currentTarget.setAttribute('href', workspaceHref(slug, true, viewKey))
            }}
          >
            <OrbitIcon className="w-4 h-4" />
            <span>Workspace</span>
          </a>
        </div>
      </nav>

      <div className="justify-self-end flex items-center gap-2 min-w-0 max-h-[48px]">{rightSlot ?? null}</div>
    </header>
  )
}
