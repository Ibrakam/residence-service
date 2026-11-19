'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LeadModal } from '../lead-modal';
import type { DormonPublishedPlan } from '@/lib/dormon-plans-state';
import { DormonBrand } from './dormon-brand';
import { DormonFacadeSection } from './dormon-facade-section';
import { DormonHeader } from './dormon-header';
import { DormonShowroom } from './dormon-showroom';
import { useDormonReveal } from './use-dormon-reveal';
import { dormonEditorial } from './dormon-editorial-data';
import { dormonImageSizes } from './dormon-image-data';
import { dormonMediaSources, preloadDormonMedia } from './dormon-media';
import { dormonBase, dormonCopy, dormonHref, dormonMapHref, dormonName, type DormonLanguage } from './dormon-data';

const route = '/dormon-hills';
const image = (name: string) => `${dormonBase}${route}/editorial/${name}.webp`;
const number = (index: number) => String(index + 1).padStart(2, '0');
function Photo({ name, alt, sizes = '(max-width: 800px) 100vw, 55vw' }: { name: string; alt: string; sizes?: string }) {
  const [shown, setShown] = useState({ name, alt });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (name === shown.name) return;
    let cancelled = false;
    const preload = preloadDormonMedia(image(name), sizes);
    void preload.decode().then(() => {
      if (!cancelled) { setShown({ name, alt }); setFailed(false); }
    }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [name, alt, sizes, shown.name]);
  const dimensions = dormonImageSizes[shown.name];
  const sources = dormonMediaSources(image(shown.name));
  return <picture className="dormon-media" key={shown.name}>
    {sources && <source type="image/avif" srcSet={sources.avif} sizes={sizes} />}
    <img src={image(shown.name)}
    srcSet={sources?.webp ?? `${image(shown.name + '-640')} 640w, ${image(shown.name)} ${dimensions?.width ?? 1200}w`} sizes={sizes}
    width={dimensions?.width} height={dimensions?.height} data-image-unavailable={failed || undefined}
    alt={shown.name === name ? alt : shown.alt} loading="lazy" decoding="async" />
  </picture>;
}
function CourtyardPlan({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const [active, setActive] = useState(-1);
  const zones = t.zones.filter(zone => zone.image !== 'lounge');
  const selected = zones[active];
  const id = useId();
  return <div className="dormon-masterplan-grid">
    <figure className={`dormon-masterplan-photo${active === -1 ? ' is-overview' : ''}`}><Photo name={selected?.image ?? 'courtyard-plan'} alt={selected?.title ?? t.masterplan.replace('\n',' ')} sizes="(max-width: 900px) 100vw, 65vw" /><figcaption>{dormonCopy[language].caption}</figcaption></figure>
    <div className="dormon-masterplan-controls"><p className="dormon-eyebrow">{t.zoneHint}</p><div className="dormon-zone-list" role="group" aria-label={t.zoneHint}>
      <button type="button" aria-pressed={active === -1} aria-controls={id} data-gallery onClick={() => setActive(-1)}>{t.overview}<span aria-hidden="true">↗</span></button>
      {zones.map((zone, index) => <button type="button" key={zone.image} aria-pressed={active === index} aria-controls={id} data-gallery onClick={() => setActive(index)}>{zone.title}<span aria-hidden="true">↗</span></button>)}
    </div><div id={id} aria-live="polite" className="dormon-zone-description">{selected && <p>{selected.text}</p>}</div></div>
  </div>;
}
function LoungeGallery({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const last = t.loungePhotos.length - 1;
  const nativeGesture = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  function move(direction: number, fromKeyboard = false) {
    nativeGesture.current = fromKeyboard;
    const root = track.current;
    if (!root) return;
    const next = Math.min(last, Math.max(0, active + direction));
    const card = root.children[next] as HTMLElement;
    const first = root.children[0] as HTMLElement;
    root.scrollTo({ left: card.offsetLeft - first.offsetLeft, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <div className="dormon-lounge-gallery">
    <div className="dormon-lounge-track" ref={track} tabIndex={0} role="region" aria-label={t.sections[4]}
      onPointerDown={() => { nativeGesture.current = true; }} onWheel={() => { nativeGesture.current = true; }}
      onScroll={() => {
        const root = track.current;
        if (!root) return;
        const first = root.children[0] as HTMLElement, second = root.children[1] as HTMLElement;
        const maxScroll = root.scrollWidth - root.clientWidth;
        setActive(maxScroll > 0 && root.scrollLeft >= maxScroll - 1 ? last :
          Math.min(last, Math.max(0, Math.round(root.scrollLeft / (second.offsetLeft - first.offsetLeft)))));
        clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => {
          if (!nativeGesture.current) return;
          nativeGesture.current = false;
          window.dispatchEvent(new CustomEvent('tencorp:analytics', { detail: { name: 'gallery_view', target: 'gallery:project' } }));
        }, 250);
      }}
      onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1, true); } }}>
      {t.loungePhotos.map(item => <figure className="dormon-lounge-card" key={item.image}><Photo name={item.image} alt={item.title} sizes="(max-width: 800px) 85vw, 65vw" /><figcaption><h3>{item.title}</h3><p>{item.text}</p></figcaption></figure>)}
    </div>
    <div className="dormon-lounge-toolbar dormon-wrap"><span>{number(active)} / {number(last)}</span><div className="dormon-round-controls"><button type="button" disabled={active === 0} data-gallery onClick={() => move(-1)} aria-label={t.previous}>←</button><button type="button" disabled={active === last} data-gallery onClick={() => move(1)} aria-label={t.next}>→</button></div></div>
  </div>;
}

export function DormonPage({ language, query, publishedPlans }: { language: DormonLanguage; query: string; publishedPlans: DormonPublishedPlan[] }) {
  const t = dormonCopy[language];
  const e = dormonEditorial[language];
  const reveal = useDormonReveal();
  const [lead, setLead] = useState<{ opener: HTMLButtonElement; context?: string; label?: string }>();
  const closeLead = useCallback(() => setLead(undefined), []);
  const plans = dormonHref(`${route}/apartments`, language, query);
  const privacy = `${dormonHref('/privacy', language, query)}&project=dormon-hills`;
  const sections = [
    { href: '#dormon-plans', label: e.sections[6] },
    { href: '#dormon-project', label: e.sections[0] },
    { href: '#dormon-architecture', label: e.sections[2] },
    { href: '#dormon-gardens', label: e.sections[3] },
    { href: '#dormon-lounge', label: e.sections[4] },
    { href: '#dormon-hub', label: e.sections[5] },
    { href: '#dormon-contact', label: e.sections[7] },
  ];

  return <div id="top" className="dormon dormon--landing" ref={reveal}>
    <a className="dormon-skip" href="#dormon-main">{t.skip}</a>
    <DormonHeader homeHref={dormonHref(route, language, query)} language={language}
      languageHref={item => dormonHref(route, item, query)} links={sections}
      desktopLinks={[sections[0], sections[1], sections[2], sections[6]]} />
    <main id="dormon-main">
      <div id="plans">
        <DormonShowroom language={language} plans={publishedPlans} catalogHref={plans}
          onEnquire={(opener, apartment) => setLead({
            opener,
            context: `${t.formContext};surface=visual-showroom;block=${apartment.block};floor=${apartment.floor};apartment=${apartment.number}`,
            label: apartment.label,
          })} />
      </div>

      <section id="dormon-project" className="dormon-section dormon-wrap dormon-about">
        <p className="dormon-eyebrow">{e.sections[0]}</p>
        <div className="dormon-about-grid">
          <div><h2 data-dormon-reveal="text">{e.about}</h2>
            <div className="dormon-prose" data-dormon-reveal="text">{e.aboutBody.map(p => <p key={p}>{p}</p>)}</div>
          </div>
          <figure data-dormon-reveal="photo"><Photo name="about" alt={e.features[0].title} /></figure>
        </div>
        <dl className="dormon-facts" data-dormon-reveal="text">
          {t.facts.map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>

      <section id="dormon-architecture" className="dormon-section dormon-construction">
        <div className="dormon-wrap">
          <p className="dormon-eyebrow">{e.sections[2]}</p>
          <DormonFacadeSection language={language} />
        </div>
      </section>

      <section id="dormon-gardens" className="dormon-section dormon-wrap dormon-yard">
        <p className="dormon-eyebrow">{e.sections[3]}</p>
        <div className="dormon-section-heading">
          <h2 data-dormon-reveal="text">{e.yard}</h2>
          <p className="dormon-prose" data-dormon-reveal="text">{e.stories[0].text}</p>
        </div>
        <CourtyardPlan language={language} />
      </section>

      <section id="dormon-lounge" className="dormon-section dormon-lounge">
        <div className="dormon-wrap">
          <p className="dormon-eyebrow">{e.sections[4]}</p>
          <div className="dormon-section-heading">
            <h2 data-dormon-reveal="text">{e.lounge}</h2>
            <div className="dormon-prose" data-dormon-reveal="text">{e.loungeBody.map(p => <p key={p}>{p}</p>)}</div>
          </div>
        </div>
        <LoungeGallery language={language} />
      </section>

      <section id="dormon-hub" className="dormon-section dormon-wrap">
        <p className="dormon-eyebrow">{e.sections[5]}</p>
        <h2 className="dormon-section-title" data-dormon-reveal="text">{e.hub}</h2>
        <div className="dormon-services">
          {e.services.map(service => <article key={service.image} className="dormon-service">
            <figure data-dormon-reveal="photo"><Photo name={service.image} alt={service.title}
              sizes="(max-width: 760px) 100vw, 30vw" /></figure>
            <div data-dormon-reveal="text"><h3>{service.title}</h3><p>{service.text}</p></div>
          </article>)}
        </div>
        <div id="dormon-features" className="dormon-access" aria-label={e.sections[1]}>
          {e.features.filter(item => item.image === 'security' || item.image === 'entry').map(item =>
            <article key={item.image}><h3>{item.title}</h3><p>{item.text}</p></article>)}
        </div>
      </section>

      <section className="dormon-visit" aria-label={e.sections[7]}>
        <div id="dormon-location" className="dormon-location">
          <Photo name="panorama" alt="" sizes="(max-width: 900px) 100vw, 60vw" />
          <div>
            <h2>{e.location}</h2>
            <p>{t.mapBody}</p>
            <a className="dormon-action is-light" href={dormonMapHref} target="_blank" rel="noreferrer">{t.map}</a>
          </div>
        </div>
        <div id="dormon-contact" className="dormon-contact">
          <div className="dormon-contact-actions">
            <h2>{e.contact}</h2>
            <p>{e.contactBody}</p>
            <button type="button" className="dormon-action is-gold" onClick={event => setLead({ opener: event.currentTarget })}>{t.enquire}</button>
            <a className="dormon-contact-phone" href="tel:+998781137712">+998 78 113 77 12</a>
          </div>
        </div>
      </section>
    </main>
    <footer className="dormon-footer dormon-wrap">
      <div className="dormon-footer-top"><DormonBrand href={dormonHref(route, language, query)} />
        <a href="#top" className="dormon-back-top" aria-label={language === 'ru' ? 'Наверх' : language === 'uz' ? 'Yuqoriga' : 'Back to top'}>↑</a>
      </div>
      <nav aria-label={language === 'ru' ? 'Разделы сайта' : language === 'uz' ? 'Sayt bo‘limlari' : 'Site sections'}>
        {sections.map(({ href, label }) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="dormon-footer-bottom"><p>{e.disclaimer}<br />{e.copyright}</p>
        <div><a href={privacy}>{t.privacy}</a><a href="https://form.tencorp.uz/">{t.portfolio}</a></div>
      </div>
    </footer>
    {lead && <LeadModal open language={language} context={lead.context ?? t.formContext} brandName="TENCORP" projectName={dormonName}
      projectSlug="dormon-hills" submitUrl={`${dormonBase}/v1/leads`} tagline={lead.label ?? e.heroBody}
      facts={[t.facts[0][0] + ' · ' + t.facts[0][1], t.facts[2][0] + ' · ' + t.facts[2][1], 'Millennium House']}
      privacyUrl={privacy} requireConsent returnFocusTo={lead.opener} onClose={closeLead} />}
  </div>;
}
