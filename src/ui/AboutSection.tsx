import { aboutGlossary, aboutGlossaryCopy } from '../config/copy'
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

      <section
        className="mx-auto mt-6 w-full rounded-[25px] border border-white/10 bg-[#050505]/55 p-[clamp(24px,5vw,64px)] backdrop-blur-[14px]"
        style={{ maxWidth: 'var(--container-max)' }}
        aria-labelledby="glossary-title"
        id="glossary"
      >
        <p className="eyebrow">{aboutGlossaryCopy.eyebrow}</p>
        <h2 id="glossary-title" className="m-0 text-3xl sm:text-4xl font-light tracking-tight text-white">
          {aboutGlossaryCopy.title}
        </h2>
        <dl className="mt-8 mb-0 grid gap-x-10 gap-y-5 sm:grid-cols-2" aria-label={aboutGlossaryCopy.label}>
          {aboutGlossary.map((entry) => (
            <div key={entry.id} id={`glossary-${entry.id}`} className="min-w-0">
              <dt className="text-sm font-medium text-white">{entry.term}</dt>
              <dd className="m-0 mt-1 text-[14px] leading-relaxed text-white/60">{entry.definition}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="about-actions">
        <PillButton href="/workspace" variant="secondary">
          View showcase targets
        </PillButton>
      </div>
    </section>
  )
}
