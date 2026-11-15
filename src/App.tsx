import { lazy, Suspense, useEffect, useState } from 'react'
import { AboutSection } from './ui/AboutSection'
import { Footer } from './ui/Footer'
import { HeroSection } from './ui/HeroSection'
import { Navbar } from './ui/Navbar'
import { AuthPage } from './pages/AuthPage'
import { useWorkspaceStore } from './state/store'
import { PageBackground } from './ui/PageBackground'
import { WorkspacePage } from './ui/WorkspacePlaceholder'

const CommunityPage = lazy(() => import('./pages/CommunityPage').then((mod) => ({ default: mod.CommunityPage })))

function currentPath(): string {
  const path = window.location.pathname
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function App() {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    void useWorkspaceStore.getState().initAuth()
  }, [])

  useEffect(() => {
    const onPop = () => setPath(currentPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (path === '/login' || path === '/signup') {
    return <AuthPage mode={path === '/signup' ? 'signup' : 'login'} />
  }

  if (path === '/community') {
    return (
      <Suspense fallback={null}>
        <CommunityPage />
      </Suspense>
    )
  }

  if (path === '/workspace') {
    return <WorkspacePage />
  }

  return (
    <>
      <PageBackground />
      <Navbar surface="home" />
      <main>
        <HeroSection />
        <AboutSection />
      </main>
      <Footer />
    </>
  )
}
