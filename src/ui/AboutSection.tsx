import { PillButton } from './PillButton'

const facts = ['102 channels', '6 detectors', 'Gaia DR3 check']

export function AboutSection() {
  return (
    <section className="about-section" id="about" aria-labelledby="about-title">
      <div className="about-card" style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
        <div className="about-card__intro">
          <p className="eyebrow">About ExoTrace</p>
          <h2 id="about-title">
            A sky that moves,
            <br />
            made visible.
          </h2>
        </div>

        <div className="about-card__details">
          <p>
            SPHEREx is NASA&apos;s all-sky infrared survey, mapping the cosmos in 102 wavelength channels to reveal what
            the universe is made of and how it has evolved.
          </p>
          <p>
            ExoTrace turns those observations into a place to compare epochs, inspect difference and RGB views, and
            trace the light in a spectrum.
          </p>
          <ul className="fact-list" aria-label="SPHEREx survey facts">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="about-actions">
        <PillButton href="/workspace" variant="secondary">
          View showcase targets
        </PillButton>
      </div>
    </section>
  )
}
