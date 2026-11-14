import { AboutSection } from './ui/AboutSection'
import { Footer } from './ui/Footer'
import { HeroSection } from './ui/HeroSection'
import { Navbar } from './ui/Navbar'
import { PageBackground } from './ui/PageBackground'
import { WorkspacePage } from './ui/WorkspacePlaceholder'

function currentPath(): string {
  const path = window.location.pathname
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function App() {
  if (currentPath() === '/workspace') {
    return <WorkspacePage />
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
