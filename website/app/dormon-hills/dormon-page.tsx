'use client';

import { Fragment, useCallback, useState, type CSSProperties } from 'react';
import { LeadModal } from '../lead-modal';
import type { DormonPublishedPlan } from '@/lib/dormon-plans-state';
import { DormonBrand, DormonLogo } from './dormon-brand';
import { DormonHeader } from './dormon-header';
import { DormonGallery } from './dormon-gallery';
import { useDormonReveal } from './use-dormon-reveal';
import { dormonBase, dormonCopy, dormonHref, dormonMapHref, dormonName, dormonSource, type DormonLanguage } from './dormon-data';

const route = '/dormon-hills';
const photo = (name: string) => `${dormonBase}${route}/renders/${name}.webp`;
const photoSet = (name: string) => `${photo(name + '-800')} 800w, ${photo(name)} ${['facade-detail', 'lounge', 'pavilion', 'promenade'].includes(name) ? 1800 : 2200}w`;
const yardImages = ['courtyard', 'fountain', 'playground'];

export function DormonPage({ language, query, featuredPlans }: { language: DormonLanguage; query: string; featuredPlans: DormonPublishedPlan[] }) {
  const t = dormonCopy[language];
  const reveal = useDormonReveal();
  const [yard, setYard] = useState(0);
  const [opener, setOpener] = useState<HTMLButtonElement>();
  const closeLead = useCallback(() => setOpener(undefined), []);
  const plans = dormonHref(`${route}/apartments`, language, query);
  const privacy = `${dormonHref('/privacy', language, query)}&project=dormon-hills`;
  const locale = language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-Latn-UZ' : 'en-GB';

  return (
    <div className="dormon" ref={reveal}>
      <a className="dormon-skip" href="#dormon-main">{t.skip}</a>
      <div className="dormon-intro-mark" aria-hidden="true"><DormonLogo /><span>{dormonName}</span></div>
      <DormonHeader overlay homeHref={dormonHref(route, language, query)} language={language}
        languageHref={(item) => dormonHref(route, item, query)}
        links={[
          { href: '#dormon-project', label: t.project },
          { href: '#dormon-architecture', label: t.architecture },
          { href: '#dormon-gardens', label: t.gardens },
          { href: plans, label: t.plans },
        ]} />

      <main id="dormon-main">
        <section className="dormon-hero" aria-labelledby="dormon-title">
          <img className="dormon-hero-image" src={photo('hero')} srcSet={photoSet('hero')} sizes="100vw" alt="" fetchPriority="high" />
          <div className="dormon-hero-content dormon-wrap">
            <p className="dormon-eyebrow dormon-hero-kicker">{t.heroKicker}</p>
            <div className="dormon-hero-main">
              <div>
                <p className="dormon-hero-name">{dormonName}</p>
                <h1 id="dormon-title"><span>{t.heroTitle[0]}</span>{' '}<span>{t.heroTitle[1]}</span></h1>
              </div>
              <div className="dormon-hero-aside">
                <p>{t.hero}</p>
                <a className="dormon-action is-gold" href={plans}>{t.plans}<span aria-hidden="true">↗</span></a>
              </div>
            </div>
            <div className="dormon-hero-bottom">
              <a href="#dormon-project">{t.explore}<span aria-hidden="true">↓</span></a>
              <small>{t.caption}</small>
            </div>
          </div>
        </section>

        <section id="dormon-project" className="dormon-intro dormon-wrap">
          <p className="dormon-eyebrow" data-dormon-reveal="text">{t.introKicker}</p>
          <div className="dormon-intro-content">
            <h2 data-dormon-reveal="words">
              {t.intro.split('\n').map((line, lineIndex) => (
                <span className="dormon-heading-line" key={line}>
                  {line.split(' ').map((word, wordIndex) => (
                    <Fragment key={wordIndex}>
                      {wordIndex ? ' ' : null}
                      <span className="dormon-reveal-word" style={{ '--dh-word-delay': `${(lineIndex * 3 + wordIndex) * 55}ms` } as CSSProperties}>{word}</span>
                    </Fragment>
                  ))}{' '}
                </span>
              ))}
            </h2>
            <p className="dormon-body" data-dormon-reveal="text">{t.introBody}</p>
          </div>
          <dl className="dormon-facts" data-dormon-reveal="text">
            {t.facts.map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>

        <section id="dormon-architecture" className="dormon-architecture dormon-wrap">
          <div className="dormon-section-head">
            <p className="dormon-eyebrow" data-dormon-reveal="text">{t.architecture}</p>
            <h2 data-dormon-reveal="text">{t.architectureTitle}</h2>
            <p className="dormon-body" data-dormon-reveal="text">{t.architectureBody}</p>
          </div>
          <div className="dormon-architecture-images">
            <figure className="dormon-architecture-wide" data-dormon-reveal="photo">
              <img loading="lazy" src={photo('architecture')} srcSet={photoSet('architecture')} sizes="(max-width: 760px) 65vw, 70vw" alt={t.architectureNote} />
              <figcaption>{t.architectureNote}</figcaption>
            </figure>
            <figure className="dormon-architecture-detail" data-dormon-reveal="photo">
              <img loading="lazy" src={photo('facade-detail')} srcSet={photoSet('facade-detail')} sizes="(max-width: 760px) 30vw, 25vw" alt={t.detailNote} />
              <figcaption>{t.detailNote}</figcaption>
            </figure>
          </div>
        </section>

        <section id="dormon-gardens" className="dormon-yard">
          <div className="dormon-wrap dormon-yard-grid">
            <div className="dormon-yard-copy" data-dormon-reveal="text">
              <p className="dormon-eyebrow">{t.gardens}</p>
              <h2>{t.gardensTitle}</h2>
              <p className="dormon-body">{t.gardensBody}</p>
              <ul className="dormon-features">{t.courtyardFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            </div>
            <figure className="dormon-yard-photo" data-dormon-reveal="photo">
              {yardImages.map((name, index) => (
                <img key={name} src={photo(name)} srcSet={photoSet(name)} sizes="(max-width: 760px) 100vw, 55vw" alt={index === yard ? t.yardTabs[index] : ''}
                  aria-hidden={index !== yard} className={index === yard ? 'is-active' : ''} loading="lazy" />
              ))}
              <figcaption>{t.caption}</figcaption>
            </figure>
            <div className="dormon-yard-tabs" role="group" aria-label={t.gardens}>
              {t.yardTabs.map((tab, index) => <button type="button" key={tab} aria-pressed={yard === index} onClick={() => setYard(index)}>
                {tab}<span aria-hidden="true">↗</span>
              </button>)}
            </div>
          </div>
        </section>

        <section className="dormon-lounge">
          <div className="dormon-wrap">
            <div className="dormon-lounge-head">
              <div data-dormon-reveal="text"><p className="dormon-eyebrow">{t.loungeKicker}</p><h2>{t.loungeTitle}</h2></div>
              <p className="dormon-body" data-dormon-reveal="text">{t.loungeBody}</p>
            </div>
            <div className="dormon-lounge-images">
              <figure data-dormon-reveal="photo">
                <img loading="lazy" src={photo('lounge')} srcSet={photoSet('lounge')} sizes="(max-width: 760px) 55vw, 55vw" alt={t.loungeNote} />
                <figcaption>{t.loungeNote}</figcaption>
              </figure>
              <figure data-dormon-reveal="photo">
                <img loading="lazy" src={photo('pavilion')} srcSet={photoSet('pavilion')} sizes="(max-width: 760px) 40vw, 40vw" alt={t.pavilionNote} />
                <figcaption>{t.pavilionNote}</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="dormon-plans dormon-wrap">
          <div className="dormon-section-head">
            <p className="dormon-eyebrow" data-dormon-reveal="text">{t.typical}</p>
            <h2 data-dormon-reveal="text">{t.plansTitle}</h2>
            <div data-dormon-reveal="text"><p className="dormon-body">{t.plansBody}</p><a className="dormon-text-link" href={plans}>{t.allPlans}<span aria-hidden="true">↗</span></a></div>
          </div>
          <div className="dormon-plan-preview">
            {featuredPlans.map((plan, index) => (
              <a href={`${plans}&block=${encodeURIComponent(plan.block)}&rooms=${plan.rooms}&minArea=${plan.area}&maxArea=${plan.area}`} key={plan.id} className="dormon-plan-preview-card" data-dormon-reveal="text">
                <div className="dormon-plan-preview-top"><span>{t.roomLabels[index]}</span><span>{t.block} {plan.block}</span></div>
                <img src={dormonBase + plan.plan} alt={`${t.typical} · ${t.roomLabels[index]}`} loading="lazy" />
                <div className="dormon-plan-preview-bottom">
                  <strong>{new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(plan.area)} <small>m²</small></strong>
                  <span aria-hidden="true">↗</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="dormon-location">
          <img src={photo('location')} srcSet={photoSet('location')} sizes="100vw" alt="" loading="lazy" />
          <div className="dormon-wrap dormon-location-copy">
            <p className="dormon-eyebrow">{t.heroKicker}</p>
            <h2 data-dormon-reveal="text">{t.mapTitle}</h2>
            <p className="dormon-body" data-dormon-reveal="text">{t.mapBody}</p>
            <a className="dormon-action is-light" href={dormonMapHref} target="_blank" rel="noreferrer">
              {t.map}<span aria-hidden="true">↗</span>
            </a>
            <small>{t.caption}</small>
          </div>
        </section>

        <section id="dormon-gallery" className="dormon-gallery-section dormon-wrap">
          <div className="dormon-section-head">
            <p className="dormon-eyebrow" data-dormon-reveal="text">{t.gallery}</p>
            <h2 data-dormon-reveal="text">{t.galleryTitle}</h2>
            <p className="dormon-body" data-dormon-reveal="text">{t.galleryBody}</p>
          </div>
          <DormonGallery language={language} />
          <p className="dormon-render-caption">{t.caption}</p>
        </section>

        <section className="dormon-contact">
          <div className="dormon-wrap dormon-contact-grid">
            <div data-dormon-reveal="text"><p className="dormon-eyebrow">TenCorp · {dormonName}</p><h2>{t.contact}</h2></div>
            <div className="dormon-contact-actions" data-dormon-reveal="text">
              <p className="dormon-body">{t.contactBody}</p>
              <button type="button" className="dormon-action is-gold" onClick={(event) => setOpener(event.currentTarget)}>
                {t.enquire}<span aria-hidden="true">↗</span>
              </button>
              <a className="dormon-contact-phone" href="tel:+998781137712">+998 78 113 77 12</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="dormon-footer dormon-wrap">
        <DormonBrand href={dormonHref(route, language, query)} />
        <div><a href={privacy}>{t.privacy}</a><a href="https://form.tencorp.uz/">{t.portfolio}</a><a href={dormonSource}>{t.source}</a></div>
      </footer>
      {opener ? <LeadModal open language={language} context={t.formContext} brandName="TENCORP"
        projectName={dormonName} projectSlug="dormon-hills" submitUrl={`${dormonBase}/v1/leads`}
        tagline={t.hero} facts={[t.facts[0][0] + ' · ' + t.facts[0][1], t.facts[2][0] + ' · ' + t.facts[2][1], 'Millennium House']}
        privacyUrl={privacy} requireConsent returnFocusTo={opener} onClose={closeLead} /> : null}
    </div>
  );
}
