'use client';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { ChevronLeft, ChevronRight, Megaphone, Percent, Sparkles, Landmark } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { cx } from './ui';

export interface Slide {
  id: string;
  kind: string;
  title: string;
  subtitle?: string | null;
  mediaType: string;
  mediaUrl?: string | null;
  theme: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

const THEMES: Record<string, string> = {
  teal: 'bg-teal-800 text-white',
  ink: 'bg-ink text-white',
  gold: 'bg-[#f3d58c] text-ink',
  red: 'bg-brand-red text-white',
};
const KIND: Record<string, { label: string; icon: typeof Megaphone }> = {
  BANK_OFFER: { label: 'Bank offer', icon: Landmark },
  PRODUCT_OFFER: { label: 'Product offer', icon: Percent },
  CAMPAIGN: { label: 'Campaign', icon: Sparkles },
  ANNOUNCEMENT: { label: 'Announcement', icon: Megaphone },
};

/** Admin-controlled hero. Tall on desktop, compact on phones. */
export function HeroSlider({ slides }: { slides: Slide[] }) {
  const [ref, embla] = useEmblaCarousel({ loop: true }, [Autoplay({ delay: 6000, stopOnInteraction: true, stopOnMouseEnter: true })]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!embla) return;
    const on = () => setIndex(embla.selectedScrollSnap());
    embla.on('select', on);
    return () => {
      embla.off('select', on);
    };
  }, [embla]);
  const go = useCallback((i: number) => embla?.scrollTo(i), [embla]);

  if (!slides.length) return null;
  return (
    <section className="relative overflow-hidden rounded-3xl" aria-roledescription="carousel" aria-label="Offers and announcements">
      <div ref={ref} className="overflow-hidden">
        <div className="flex">
          {slides.map((s, i) => {
            const k = KIND[s.kind] ?? KIND.ANNOUNCEMENT;
            return (
              <div key={s.id} className={cx('relative min-w-0 flex-[0_0_100%]', THEMES[s.theme] ?? THEMES.ink)} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
                {s.mediaType === 'IMAGE' && s.mediaUrl && <img src={s.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" loading={i ? 'lazy' : 'eager'} />}
                {s.mediaType === 'VIDEO' && s.mediaUrl && <video src={s.mediaUrl} className="absolute inset-0 h-full w-full object-cover opacity-40" muted loop playsInline autoPlay preload="none" />}
                <Decoration theme={s.theme} />
                <div className="relative flex h-[210px] flex-col justify-end gap-3 p-6 sm:h-[260px] lg:h-[34vh] lg:min-h-[280px] lg:max-h-[380px] lg:p-10">
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide backdrop-blur">
                    <k.icon className="h-3.5 w-3.5" /> {k.label}
                  </span>
                  <h2 className="max-w-xl font-display text-2xl font-extrabold leading-tight [text-wrap:balance] sm:text-3xl lg:text-4xl">{s.title}</h2>
                  {s.subtitle && <p className="max-w-lg text-sm opacity-90 sm:text-base">{s.subtitle}</p>}
                  {s.ctaLabel && s.ctaUrl && (
                    <Link href={s.ctaUrl} className="mt-1 inline-flex h-10 w-fit items-center rounded-xl bg-white px-4 text-sm font-bold text-ink hover:bg-ink-50">
                      {s.ctaLabel}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {slides.length > 1 && (
        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          <div className="hidden gap-1.5 sm:flex">
            {slides.map((s, i) => (
              <button key={s.id} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`} className={cx('h-2 rounded-full bg-white transition-all', i === index ? 'w-6 opacity-100' : 'w-2 opacity-50')} />
            ))}
          </div>
          <button onClick={() => embla?.scrollPrev()} className="rounded-full bg-black/20 p-2 text-white backdrop-blur hover:bg-black/30" aria-label="Previous slide">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => embla?.scrollNext()} className="rounded-full bg-black/20 p-2 text-white backdrop-blur hover:bg-black/30" aria-label="Next slide">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}

/** Rising bars and trend arrow from the Rupeemap logo. */
function Decoration({ theme }: { theme: string }) {
  const bar = theme === 'red' ? '#ffffff' : '#d9463b';
  const line = theme === 'gold' ? '#1b5a52' : '#6cc2b6';
  return (
    <svg className="pointer-events-none absolute -right-6 bottom-0 h-[85%] w-auto opacity-80" viewBox="0 0 300 220" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={30 + i * 42} y={180 - i * 26} width="24" height={40 + i * 26} rx="3" fill={bar} opacity={0.18 + i * 0.08} />
      ))}
      <polyline points="16,170 70,132 110,146 160,96 200,108 250,50 286,22" fill="none" stroke={line} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
