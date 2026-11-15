import { communityCopy, roadmapSteps } from '../config/copy'
import { communitySamples, type CommunitySample } from '../config/communityMock'
import { toolById } from '../config/tools'
import { buildWorkspaceUrl } from '../state/urlSync'
import { Footer } from '../ui/Footer'
import { Navbar } from '../ui/Navbar'
import { PageBackground } from '../ui/PageBackground'

function permalink(sample: CommunitySample): string {
  return buildWorkspaceUrl(
    { pathname: '/workspace', hash: '' },
    { ...sample.view, tool: sample.tool, slug: sample.slug, embed: false },
    [],
  )
}

const DISABLED_CLASS = 'liquid-glass-btn rounded-full px-3.5 py-1.5 text-xs text-white/60 cursor-not-allowed opacity-60'

function SampleCard({ sample }: { sample: CommunitySample }) {
  const actions = [communityCopy.comment, communityCopy.fork, communityCopy.reproduce]
  return (
    <li>
      <article className="h-full flex flex-col rounded-2xl border border-white/10 bg-[#05060A]/70 backdrop-blur-md p-5 text-white">
        <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-white/55">
          {communityCopy.tool}: {toolById(sample.tool).label}
        </p>
        <h3 className="m-0 mt-2 text-lg font-medium leading-snug">{sample.title}</h3>
        <p className="m-0 mt-1 text-xs text-white/60">
          {communityCopy.target}: {sample.target}
        </p>
        <p className="m-0 mt-3 text-sm leading-relaxed text-white/70">{sample.note}</p>
        <p className="m-0 mt-3 text-xs text-white/50">{sample.author}</p>
        <div className="mt-auto pt-4 flex flex-wrap items-center gap-2">
          <a
            href={permalink(sample)}
            className="liquid-glass-cta rounded-full px-4 py-1.5 text-xs font-medium"
            data-testid={`open-${sample.id}`}
          >
            {communityCopy.openAnalysis}
          </a>
          {actions.map((label) => (
            <span key={label} title={communityCopy.comingLater}>
              <button type="button" disabled className={DISABLED_CLASS}>
                {label}
              </button>
            </span>
          ))}
        </div>
      </article>
    </li>
  )
}

export function CommunityPage() {
  return (
    <>
      <PageBackground />
      <Navbar surface="home" />
      <main className="mx-auto w-full max-w-[1120px] px-6 sm:px-8 pt-[128px] pb-16">
        <div
          role="note"
          className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-100"
          data-testid="community-banner"
        >
          {communityCopy.banner}
        </div>
        <p className="eyebrow" style={{ marginTop: 40 }}>
          {communityCopy.eyebrow}
        </p>
        <h1 className="m-0 text-4xl sm:text-5xl font-light tracking-tight text-white">{communityCopy.title}</h1>
        <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-white/60">{communityCopy.intro}</p>

        <ul className="mt-8 grid list-none gap-4 p-0 sm:grid-cols-2" aria-label={communityCopy.navLabel}>
          {communitySamples.map((sample) => (
            <SampleCard key={sample.id} sample={sample} />
          ))}
        </ul>

        <section className="mt-12" aria-label={communityCopy.roadmapLabel}>
          <h2 className="m-0 mb-3 text-[11px] font-normal uppercase tracking-[0.12em] text-white/60">
            {communityCopy.roadmapTitle}
          </h2>
          <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
            {roadmapSteps.map((step, index) => (
              <li
                key={step.id}
                className={
                  step.live
                    ? 'rounded-2xl border border-[rgb(240,255,60)]/60 bg-[rgb(240,255,60)]/10 p-4 text-white'
                    : 'rounded-2xl border border-white/10 bg-[#05060A]/60 p-4 text-white/80'
                }
                aria-current={step.live ? 'step' : undefined}
              >
                <p className="m-0 text-xs text-white/55">{index + 1}</p>
                <p className="m-0 mt-1 text-base font-medium">{step.title}</p>
                <p className="m-0 mt-1 text-xs text-white/60">{step.detail}</p>
                <p className="m-0 mt-3 text-[11px] uppercase tracking-[0.12em]">{step.status}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
    </>
  )
}
