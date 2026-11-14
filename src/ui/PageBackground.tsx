export function PageBackground() {
  return (
    <div className="page-background" aria-hidden="true">
      <div className="hero-cosmos">
        <span className="hero-orbit hero-orbit--wide" />
        <span className="hero-orbit hero-orbit--inner" />
        <span className="hero-planet" />
        <span className="hero-star hero-star--one" />
        <span className="hero-star hero-star--two" />
        <span className="hero-star hero-star--three" />
        <span className="hero-star hero-star--four" />
      </div>
      <video className="hero-video" autoPlay muted loop playsInline preload="auto" poster="/videos/hero-poster.jpg">
        <source src="/videos/hero.mp4" type="video/mp4" />
      </video>
      <div className="page-background__overlay" />
    </div>
  )
}
