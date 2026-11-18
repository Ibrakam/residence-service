'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LeadModal } from '../lead-modal';
import type { DormonPublishedPlan } from '@/lib/dormon-plans-state';
import { DormonBrand, DormonLogo } from './dormon-brand';
import { DormonHeader } from './dormon-header';
import { useDormonReveal } from './use-dormon-reveal';
import { dormonEditorial } from './dormon-editorial-data';
import { dormonImageSizes } from './dormon-image-data';
import { dormonBase, dormonCopy, dormonHref, dormonMapHref, dormonName, type DormonLanguage } from './dormon-data';

const route = '/dormon-hills';
const image = (name: string) => `${dormonBase}${route}/editorial/${name}.webp`;
const number = (index: number) => String(index + 1).padStart(2, '0');
function Photo({ name, alt, className = '', eager = false, sizes = '(max-width: 800px) 100vw, 55vw' }: { name: string; alt: string; className?: string; eager?: boolean; sizes?: string }) {
  const [shown, setShown] = useState({ name, alt });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (name === shown.name) return;
    let cancelled = false;
    const preload = new Image();
    preload.sizes = sizes;
    preload.srcset = `${image(name + '-640')} 640w, ${image(name)} ${dormonImageSizes[name]?.width ?? 1200}w`;
    preload.src = image(name);
    void preload.decode().then(() => {
      if (!cancelled) { setShown({ name, alt }); setFailed(false); }
    }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [name, alt, sizes, shown.name]);
  const dimensions = dormonImageSizes[shown.name];
  return <img key={shown.name} className={className} src={image(shown.name)}
    srcSet={`${image(shown.name + '-640')} 640w, ${image(shown.name)} ${dimensions?.width ?? 1200}w`} sizes={sizes}
    width={dimensions?.width} height={dimensions?.height} data-image-unavailable={failed || undefined}
    alt={shown.name === name ? alt : shown.alt} loading={eager ? undefined : 'lazy'} fetchPriority={eager ? 'high' : undefined} decoding="async" />;
}
function Eyebrow({ index, children }: { index: string; children: string }) {
  return <p className="dormon-eyebrow"><span>{index}</span>{children}<i aria-hidden="true" /></p>;
}
function FeatureExplorer({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const [active, setActive] = useState(0);
  const id = useId();
  const selected = t.features[active];
  function move(direction: number) { setActive(value => (value + direction + t.features.length) % t.features.length); }
  return <div className="dormon-feature-grid">
    <div className="dormon-feature-list" role="group" aria-label={t.sections[1]}>
      {t.features.map((item, index) => <button key={item.title} type="button" aria-pressed={active === index} aria-controls={id} data-gallery onClick={() => setActive(index)}>
        <span className="dormon-item-number">{number(index)}</span><span>{item.title}</span><span className="dormon-feature-plus" aria-hidden="true">{active === index ? '−' : '+'}</span>
      </button>)}
    </div>
    <div className="dormon-feature-view" id={id}>
      <figure className="dormon-feature-photo"><Photo name={selected.image} alt={selected.title} /><figcaption><span>{number(active)} / 09</span><span>{dormonCopy[language].caption}</span></figcaption></figure>
      <div className="dormon-feature-description"><div aria-live="polite"><h3>{selected.title}</h3><p>{selected.text}</p></div><div className="dormon-round-controls"><button type="button" data-gallery onClick={() => move(-1)} aria-label={t.previous}>←</button><button type="button" data-gallery onClick={() => move(1)} aria-label={t.next}>→</button></div></div>
    </div>
  </div>;
}
function FacadeExplorer({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const [active, setActive] = useState(0);
  const id = useId();
  return <div className="dormon-facade-grid">
    <div className="dormon-facade-copy"><h2 data-dormon-reveal="text">{t.facade}</h2><p className="dormon-muted">{t.layerHint}</p>
      <div className="dormon-layer-list" role="group" aria-label={t.facade.replace('\n', ' ')}>{t.layers.map((layer, index) => <button type="button" key={layer.title} aria-pressed={active === index} aria-controls={id} data-gallery onClick={() => setActive(index)}><span>{['I','II','III','IV','V'][index]}</span>{layer.title}<span aria-hidden="true">↗</span></button>)}</div>
    </div>
    <div className="dormon-facade-visual">
      <figure className="dormon-facade-diagram"><Photo name={active === 3 ? 'facade-air' : 'facade-section'} alt={t.facade.replace('\n', ' ')} sizes="(max-width: 800px) 100vw, 55vw" /></figure>
      <div id={id} className="dormon-layer-description" aria-live="polite"><span>{number(active)} / 05</span><h3>{t.layers[active].title}</h3><p>{t.layers[active].text}</p></div>
      <p className="dormon-caption">{t.layerNote}</p>
    </div>
  </div>;
}
function CourtyardStory({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!root.current || !('IntersectionObserver' in window)) return;
    const elements = root.current.querySelectorAll<HTMLElement>('[data-yard-story]');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.yardStory));
    }, { rootMargin: '-35% 0px -40% 0px', threshold: 0 });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return <div ref={root} className="dormon-story-grid">
    <div className="dormon-story-sticky" aria-hidden="true"><div className="dormon-story-stack">
      {t.stories.map((item, index) => <Photo key={item.image} name={item.image} alt="" className={active === index ? 'is-active' : ''} />)}
      <div className="dormon-story-counter"><span>{number(active)}</span><small>/ 07</small></div>
    </div></div>
    <div className="dormon-story-copy">{t.stories.map((item, index) => <article className="dormon-story-step" key={item.image} data-yard-story={index}>
      <figure className="dormon-story-mobile"><Photo name={item.image} alt={item.title} /></figure>
      <p className="dormon-item-number">{number(index)}</p><h3>{item.title}</h3><p>{item.text}</p>
    </article>)}</div>
  </div>;
}
function CourtyardPlan({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const [active, setActive] = useState(-1);
  const selected = active === -1 ? undefined : t.zones[active];
  const id = useId();
  return <div className="dormon-masterplan-grid">
    <figure className={`dormon-masterplan-photo${active === -1 ? ' is-overview' : ''}`}><Photo name={selected?.image ?? 'courtyard-plan'} alt={selected?.title ?? t.masterplan.replace('\n',' ')} sizes="(max-width: 900px) 100vw, 65vw" /><figcaption>{dormonCopy[language].caption}</figcaption></figure>
    <div className="dormon-masterplan-controls"><p className="dormon-eyebrow">{t.zoneHint}</p><div className="dormon-zone-list" role="group" aria-label={t.zoneHint}>
      <button type="button" aria-pressed={active === -1} aria-controls={id} data-gallery onClick={() => setActive(-1)}><span>00</span>{t.overview}<span aria-hidden="true">↗</span></button>
      {t.zones.map((zone, index) => <button type="button" key={zone.image} aria-pressed={active === index} aria-controls={id} data-gallery onClick={() => setActive(index)}><span>{number(index)}</span>{zone.title}<span aria-hidden="true">↗</span></button>)}
    </div><div id={id} aria-live="polite" className="dormon-zone-description"><p>{selected?.text ?? t.zoneHint}</p></div></div>
  </div>;
}
function LoungeGallery({ language }: { language: DormonLanguage }) {
  const t = dormonEditorial[language];
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const nativeGesture = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  function move(direction: number, fromKeyboard = false) {
    nativeGesture.current = fromKeyboard;
    const root = track.current;
    if (!root) return;
    const next = Math.min(3, Math.max(0, active + direction));
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
        setActive(Math.min(3,Math.max(0,Math.round(root.scrollLeft / (second.offsetLeft - first.offsetLeft)))));
        clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => {
          if (!nativeGesture.current) return;
          nativeGesture.current = false;
          window.dispatchEvent(new CustomEvent('tencorp:analytics', { detail: { name: 'gallery_view', target: 'gallery:project' } }));
        }, 250);
      }}
      onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1, true); } }}>
      {t.loungePhotos.map((item, index) => <figure className="dormon-lounge-card" key={item.image}><Photo name={item.image} alt={item.title} sizes="(max-width: 800px) 85vw, 65vw" /><figcaption><span>{number(index)}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></figcaption></figure>)}
    </div>
    <div className="dormon-lounge-toolbar dormon-wrap"><span>{number(active)} / 04</span><div className="dormon-round-controls"><button type="button" disabled={active === 0} data-gallery onClick={() => move(-1)} aria-label={t.previous}>←</button><button type="button" disabled={active === 3} data-gallery onClick={() => move(1)} aria-label={t.next}>→</button></div></div>
  </div>;
}

export function DormonPage({ language, query, featuredPlans }: { language: DormonLanguage; query: string; featuredPlans: DormonPublishedPlan[] }) {
  const t = dormonCopy[language];
  const e = dormonEditorial[language];
  const reveal = useDormonReveal();
  const [opener, setOpener] = useState<HTMLButtonElement>();
  const closeLead = useCallback(() => setOpener(undefined), []);
  const plans = dormonHref(`${route}/apartments`, language, query);
  const privacy = `${dormonHref('/privacy', language, query)}&project=dormon-hills`;
  const locale = language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-Latn-UZ' : 'en-GB';
  const business = {ru:'Комплекс бизнес-класса',uz:'Biznes toifasidagi majmua',en:'Business-class residences'}[language];
  const sectionLinks = ['#dormon-project','#dormon-features','#dormon-architecture','#dormon-gardens','#dormon-lounge','#dormon-hub',plans,'#dormon-contact'];
  return <div className="dormon" ref={reveal}>
    <a className="dormon-skip" href="#dormon-main">{t.skip}</a>
    <div className="dormon-intro-mark" aria-hidden="true"><DormonLogo /><span>{dormonName}</span></div>
    <DormonHeader overlay homeHref={dormonHref(route, language, query)} language={language} languageHref={item => dormonHref(route,item,query)}
      links={e.sections.map((label,index)=>({href:sectionLinks[index],label}))} />
    <main id="dormon-main">
      <section id="top" className="dormon-hero" aria-labelledby="dormon-title">
        <Photo name="hero" alt="" className="dormon-hero-image" eager sizes="100vw" />
        <div className="dormon-hero-content dormon-wrap"><p className="dormon-hero-kicker dormon-eyebrow">Millennium House <span aria-hidden="true">/</span> {t.heroKicker.split(' · ')[1]}</p>
          <h1 id="dormon-title"><span>Do‘rmon</span><span>Hills</span></h1>
          <div className="dormon-hero-bottom"><div className="dormon-hero-summary"><p className="dormon-hero-class">{business}</p><p>{e.heroBody}</p><a className="dormon-action is-gold" href={plans}>{t.plans}<span aria-hidden="true">↗</span></a></div>
            <dl className="dormon-hero-facts">{[t.facts[2],t.facts[1],t.facts[0]].map(([value,label])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </div><div className="dormon-hero-baseline"><a href="#dormon-project">{t.explore}<span aria-hidden="true">↓</span></a><small>{t.caption}</small></div>
        </div>
      </section>
      <div className="dormon-ribbon" aria-hidden="true"><span>Do‘rmon Hills</span><i>✳</i><span>Millennium House</span><i>✳</i><span>{business}</span><i>✳</i><span>Do‘rmon Hills</span></div>
      <section id="dormon-project" className="dormon-section dormon-wrap dormon-about">
        <Eyebrow index="01">{e.sections[0]}</Eyebrow><div className="dormon-about-grid"><div><h2 data-dormon-reveal="text">{e.about}</h2><div className="dormon-prose" data-dormon-reveal="text">{e.aboutBody.map(p=><p key={p}>{p}</p>)}</div></div><figure data-dormon-reveal="photo"><Photo name="about" alt={e.features[0].title} /></figure></div>
        <dl className="dormon-facts" data-dormon-reveal="text">{t.facts.map(([value,label])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>
      <section className="dormon-panorama"><Photo name="panorama" alt="" sizes="100vw" /><div className="dormon-wrap"><p className="dormon-eyebrow">Do‘rmon Hills / Panorama</p><h2 data-dormon-reveal="text">{e.panorama}</h2><p>{e.panoramaBody}</p></div><span className="dormon-panorama-line" aria-hidden="true" /></section>
      <section id="dormon-features" className="dormon-section dormon-wrap"><Eyebrow index="02">{e.sections[1]}</Eyebrow><h2 className="dormon-section-title" data-dormon-reveal="text">{e.featureTitle}</h2><FeatureExplorer language={language} /></section>
      <section id="dormon-architecture" className="dormon-section dormon-construction"><div className="dormon-wrap"><Eyebrow index="03">{e.sections[2]}</Eyebrow><div className="dormon-split"><div><h2 data-dormon-reveal="text">{e.construction}</h2><div className="dormon-prose" data-dormon-reveal="text">{e.constructionBody.map(p=><p key={p}>{p}</p>)}</div></div><figure data-dormon-reveal="photo"><Photo name="architecture" alt={e.sections[2]} /></figure></div><FacadeExplorer language={language} /></div></section>
      <section id="dormon-gardens" className="dormon-section dormon-wrap dormon-yard"><Eyebrow index="04">{e.sections[3]}</Eyebrow><h2 className="dormon-section-title" data-dormon-reveal="text">{e.yard}</h2><CourtyardStory language={language} /></section>
      <section className="dormon-section dormon-masterplan"><div className="dormon-wrap"><Eyebrow index="04 / A">{e.zoneHint}</Eyebrow><h2 className="dormon-section-title" data-dormon-reveal="text">{e.masterplan}</h2><CourtyardPlan language={language} /></div></section>
      <section id="dormon-lounge" className="dormon-section dormon-lounge"><div className="dormon-wrap"><Eyebrow index="05">{e.sections[4]}</Eyebrow><div className="dormon-section-heading"><h2 data-dormon-reveal="text">{e.lounge}</h2><div className="dormon-prose" data-dormon-reveal="text">{e.loungeBody.map(p=><p key={p}>{p}</p>)}</div></div></div><LoungeGallery language={language} /><div className="dormon-wrap dormon-community"><h3 data-dormon-reveal="text">{e.community}</h3><p>{e.communityBody}</p></div></section>
      <section id="dormon-hub" className="dormon-section dormon-wrap dormon-hub"><Eyebrow index="06">{e.sections[5]}</Eyebrow><h2 className="dormon-section-title" data-dormon-reveal="text">{e.hub}</h2><div className="dormon-services">{e.services.map((service,index)=><article key={service.image} className="dormon-service"><figure data-dormon-reveal="photo"><Photo name={service.image} alt={service.title} /></figure><div data-dormon-reveal="text"><span className="dormon-item-number">{number(index)}</span><h3>{service.title}</h3><p>{service.text}</p></div></article>)}</div></section>
      <section id="dormon-plans" className="dormon-section dormon-plans"><div className="dormon-wrap"><Eyebrow index="07">{e.sections[6]}</Eyebrow><div className="dormon-section-heading"><h2 data-dormon-reveal="text">{e.plans}</h2><div className="dormon-prose" data-dormon-reveal="text"><p>{e.plansBody}</p><a className="dormon-text-link" href={plans}>{t.allPlans}<span aria-hidden="true">↗</span></a></div></div><div className="dormon-plan-preview">{featuredPlans.map(plan=><a href={plans} key={plan.id} className="dormon-plan-preview-card" data-dormon-reveal="text"><div className="dormon-plan-preview-top"><span>{e.rooms[plan.rooms-1]}</span><span>{t.block} {plan.block}</span></div><img src={dormonBase+plan.plan} alt={`${t.typical} · ${e.rooms[plan.rooms-1]}`} loading="lazy" /><div className="dormon-plan-preview-bottom"><strong>{new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(plan.area)} <small>m²</small></strong><span aria-hidden="true">↗</span></div></a>)}</div><a className="dormon-action is-gold dormon-plans-all" href={plans}>{t.allPlans}<span aria-hidden="true">↗</span></a></div></section>
      <section className="dormon-location"><Photo name="aerial" alt="" sizes="100vw" /><div className="dormon-wrap"><p className="dormon-eyebrow">41°22′31.2″ N / 69°25′53.9″ E</p><h2 data-dormon-reveal="text">{e.location}</h2><p>{t.mapBody}</p><a className="dormon-action is-light" href={dormonMapHref} target="_blank" rel="noreferrer">{t.map}<span aria-hidden="true">↗</span></a></div></section>
      <section id="dormon-contact" className="dormon-section dormon-contact"><div className="dormon-wrap"><Eyebrow index="08">{e.sections[7]}</Eyebrow><div className="dormon-section-heading"><h2 data-dormon-reveal="text">{e.contact}</h2><div className="dormon-contact-actions" data-dormon-reveal="text"><p>{e.contactBody}</p><button type="button" className="dormon-action is-gold" onClick={event=>setOpener(event.currentTarget)}>{t.enquire}<span aria-hidden="true">↗</span></button><a className="dormon-contact-phone" href="tel:+998781137712">+998 78 113 77 12</a></div></div></div></section>
    </main>
    <footer className="dormon-footer dormon-wrap"><div className="dormon-footer-top"><DormonBrand href={dormonHref(route,language,query)} /><a href="#top" className="dormon-back-top" aria-label={language==='ru'?'Наверх':language==='uz'?'Yuqoriga':'Back to top'}>↑</a></div><nav aria-label={language==='ru'?'Разделы сайта':language==='uz'?'Sayt bo‘limlari':'Site sections'}>{e.sections.map((label,index)=><a key={label} href={sectionLinks[index]}>{label}</a>)}</nav><div className="dormon-footer-bottom"><p>{e.disclaimer}<br />{e.copyright}</p><div><a href={privacy}>{t.privacy}</a><a href="https://form.tencorp.uz/">{t.portfolio}</a></div></div></footer>
    {opener?<LeadModal open language={language} context={t.formContext} brandName="TENCORP" projectName={dormonName} projectSlug="dormon-hills" submitUrl={`${dormonBase}/v1/leads`} tagline={e.heroBody} facts={[t.facts[0][0]+' · '+t.facts[0][1],t.facts[2][0]+' · '+t.facts[2][1],'Millennium House']} privacyUrl={privacy} requireConsent returnFocusTo={opener} onClose={closeLead}/>:null}
  </div>;
}
