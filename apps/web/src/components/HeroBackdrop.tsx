import { useEffect, useState } from 'react';

/**
 * Slowly drifting photographs behind the landing hero.
 *
 * The files live in `public/hero/` and ship as SVG scenes so the page is quick
 * on a 3G connection and never shows a broken image. Replacing them with real
 * photographs of Rwandan shops is a drop-in: same filenames, or edit the list
 * below. Keep them landscape and dark-ish — the headline sits on top in white.
 */
const SLIDES = [
  '/hero/shop-shelves.svg',
  '/hero/market-stall.svg',
  '/hero/counter.svg',
  '/hero/hardware.svg',
];

/** Long enough to read the headline before anything moves under it. */
const HOLD_MS = 6500;

export function HeroBackdrop() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Someone who has asked their system to reduce motion gets the first scene
    // as a still. The CSS also disables the transition; this stops the timer so
    // we are not repainting a background nobody sees changing.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % SLIDES.length),
      HOLD_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {SLIDES.map((src, slideIndex) => (
        <div
          key={src}
          className="hero-slide"
          data-active={slideIndex === index}
          style={{
            backgroundImage: `url(${src})`,
            // Restarting the zoom on every slide would mean re-running the
            // animation while the outgoing image is still fading. Keying the
            // animation to the active index lets React remount it cleanly.
            animation: slideIndex === index ? 'ken-burns 18s ease-out forwards' : undefined,
          }}
        />
      ))}

      {/* Two washes, not one: a teal tint so four differently-coloured scenes
          still read as one brand rather than a slideshow, and a gradient that is
          heaviest at top and bottom — where the header and the next section meet
          it — and lightest across the middle, where the scene is worth seeing.
          Enough to hold white text, not so much that the images go to mud. */}
      <div className="absolute inset-0 bg-brand-900/40" />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/75 via-slate-900/45 to-slate-900/80" />
    </div>
  );
}
