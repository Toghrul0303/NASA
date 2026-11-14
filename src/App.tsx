import { lazy, Suspense } from 'react'
import { AboutSection } from './ui/AboutSection'
import { Footer } from './ui/Footer'
import { HeroSection } from './ui/HeroSection'
import { Navbar } from './ui/Navbar'
import { PageBackground } from './ui/PageBackground'

const AladinMap = lazy(() => import('./map/AladinMap').then((mod) => ({ default: mod.AladinMap })))

function currentPath(): string {
  const path = window.location.pathname
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function App() {
  if (currentPath() === '/workspace') {
    return (
      <>
        <Navbar />
        <div className="h-svh bg-black pt-20">
          <Suspense fallback={<div className="h-full w-full bg-black" aria-label="Loading sky map" />}>
            <AladinMap />
          </Suspense>
        </div>
      </>
    )
  }

  return (
    <>
      <PageBackground />
      <Navbar />
      <main>
        <HeroSection />
        <AboutSection />
      </main>
      <Footer />
    </>
  )
}
