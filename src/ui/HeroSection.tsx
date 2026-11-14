import { PillButton } from './PillButton'
import { ChartIcon, OrbitIcon, TelescopeIcon } from './icons'

export function HeroSection() {
  return (
    <section className="hero-frame" aria-labelledby="hero-title">
      <div className="hero-content">
        <div className="hero-badge">
          <span className="hero-badge__icons" aria-hidden="true">
            <span>
              <TelescopeIcon />
            </span>
            <span>
              <OrbitIcon />
            </span>
            <span>
              <ChartIcon />
            </span>
          </span>
          <span>Built on NASA SPHEREx data</span>
        </div>

        <h1 className="hero-brand-title" id="hero-title">
          ExoTrace
        </h1>
        <p className="hero-headline">
          <span>EXPLORE</span>
          <span className="hero-headline__slashes" aria-hidden="true">
            //
          </span>
          <span>THE SKY</span>
          <span className="hero-headline__slashes" aria-hidden="true">
            //
          </span>
          <span>IN TIME</span>
        </p>

        <div className="hero-bottom">
          <p className="hero-description">
            Enter any sky coordinate and watch infrared light change across time. Blink epochs, compare spectra and
            cross-check with Gaia, all in your browser.
          </p>
          <PillButton href="/workspace" variant="primary" className="hero-cta">
            Launch Workspace
          </PillButton>
        </div>
      </div>

      <a className="scroll-cue" href="#about" aria-label="Scroll to learn about ExoTrace">
        <span className="scroll-cue__line" aria-hidden="true" />
        <span>Scroll</span>
      </a>
    </section>
  )
}
