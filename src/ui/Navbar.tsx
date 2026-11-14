import { useEffect, useRef, useState } from 'react'
import { PillButton } from './PillButton'
import { AsteriskIcon, CloseIcon, HomeIcon, InfoIcon, MenuIcon, OrbitIcon, TelescopeIcon } from './icons'

type SectionId = 'home' | 'about' | 'workspace'

function currentPath(): string {
  const path = window.location.pathname
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function Navbar() {
  const [pathname, setPathname] = useState(currentPath)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>(pathname === '/workspace' ? 'workspace' : 'home')
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const firstMobileLinkRef = useRef<HTMLAnchorElement>(null)
  const isHome = pathname === '/'
  const isWorkspace = pathname === '/workspace'

  useEffect(() => {
    function onPopState() {
      const next = currentPath()
      setPathname(next)
      setActiveSection(next === '/workspace' ? 'workspace' : 'home')
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!isHome) {
      setActiveSection(isWorkspace ? 'workspace' : 'home')
      return
    }

    const about = document.getElementById('about')
    if (!about) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        setActiveSection(entry.isIntersecting ? 'about' : 'home')
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )

    observer.observe(about)
    return () => observer.disconnect()
  }, [isHome, isWorkspace])

  useEffect(() => {
    if (!menuOpen) return

    firstMobileLinkRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = Array.from(
        mobileMenuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      )
      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]
      if (!firstElement || !lastElement) return

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  const aboutHref = isHome ? '#about' : '/#about'
  const homeActive = isHome && activeSection === 'home'
  const aboutActive = isHome && activeSection === 'about'

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <a href="/" className="brand-mark" aria-label="ExoTrace home">
            <AsteriskIcon />
            <span className="brand-mark__word">ExoTrace</span>
          </a>

          <nav
            className="nav-pill"
            aria-label="Main navigation"
            style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
          >
            <a href="/" aria-current={homeActive ? 'page' : undefined} className={homeActive ? 'is-active' : undefined}>
              <HomeIcon />
              <span>Home</span>
            </a>
            <a href="/workspace">
              <TelescopeIcon />
              <span>Targets</span>
            </a>
            <a
              href={aboutHref}
              aria-current={aboutActive ? 'location' : undefined}
              className={aboutActive ? 'is-active' : undefined}
            >
              <InfoIcon />
              <span>About</span>
            </a>
            <a
              href="/workspace"
              aria-current={isWorkspace ? 'page' : undefined}
              className={isWorkspace ? 'is-active' : undefined}
            >
              <OrbitIcon />
              <span>Workspace</span>
            </a>
          </nav>

          <button
            ref={menuButtonRef}
            className="menu-toggle"
            type="button"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <div
          ref={mobileMenuRef}
          className="mobile-menu"
          id="mobile-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div className="mobile-menu__top">
            <a href="/" className="brand-mark" aria-label="ExoTrace home" onClick={() => setMenuOpen(false)}>
              <AsteriskIcon />
              <span className="brand-mark__word">ExoTrace</span>
            </a>
            <button
              className="menu-toggle"
              type="button"
              aria-label="Close navigation menu"
              onClick={() => {
                setMenuOpen(false)
                menuButtonRef.current?.focus()
              }}
            >
              <CloseIcon />
            </button>
          </div>
          <nav className="mobile-menu__links" aria-label="Mobile navigation">
            <a
              ref={firstMobileLinkRef}
              href="/"
              aria-current={homeActive ? 'page' : undefined}
              className={homeActive ? 'is-active' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              Home
            </a>
            <a
              href={aboutHref}
              aria-current={aboutActive ? 'location' : undefined}
              className={aboutActive ? 'is-active' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              About
            </a>
            <a
              href="/workspace"
              aria-current={isWorkspace ? 'page' : undefined}
              className={isWorkspace ? 'is-active' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              Workspace
            </a>
          </nav>
          <PillButton href="/workspace" variant="secondary" icon={<TelescopeIcon />} onClick={() => setMenuOpen(false)}>
            Explore targets
          </PillButton>
        </div>
      )}
    </>
  )
}
