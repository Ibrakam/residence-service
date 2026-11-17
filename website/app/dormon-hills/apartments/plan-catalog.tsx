'use client';

import { useCallback, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';
import { DormonBrand } from '../dormon-brand';
import { DormonHeader } from '../dormon-header';
import {
  basePath, catalogHref, catalogPath, copy, emptyFilters, projectPath,
  type CatalogLanguage, type PlanFilters, type PublishedPlan,
} from './plan-catalog-data';
import './plan-catalog.css';

const pageSize = 12;
const locale = { ru: 'ru-RU', uz: 'uz-Latn-UZ', en: 'en-GB' };
const dialogCopy = {
  ru: { previous: 'Предыдущая планировка', next: 'Следующая планировка', zoom: 'Увеличить планировку', restore: 'Уменьшить планировку', hint: 'Нажмите на план, чтобы увеличить', close: 'Закрыть', area: 'Общая площадь' },
  uz: { previous: 'Oldingi reja', next: 'Keyingi reja', zoom: 'Rejani kattalashtirish', restore: 'Rejani kichraytirish', hint: 'Kattalashtirish uchun rejani bosing', close: 'Yopish', area: 'Umumiy maydon' },
  en: { previous: 'Previous floor plan', next: 'Next floor plan', zoom: 'Enlarge floor plan', restore: 'Reduce floor plan', hint: 'Tap the plan to enlarge', close: 'Close', area: 'Total area' },
};

type Props = {
  language: CatalogLanguage;
  attribution: string;
  initialFilters: PlanFilters;
  plans: readonly PublishedPlan[];
  source: string;
};

type LeadRequest = { plan?: PublishedPlan; opener: HTMLElement };

function PlanImage({ src, alt, fallback, eager = false }: { src: string; alt: string; fallback: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="dh-plan-image-fallback">{fallback}</p>;
  return <img src={basePath + src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />;
}

export function DormonPlanCatalog({ language, attribution, initialFilters, plans, source }: Props) {
  const t = copy[language];
  const dialogText = dialogCopy[language];
  const [filters, setFilters] = useState(initialFilters);
  const [limit, setLimit] = useState(pageSize);
  const [detail, setDetail] = useState<PublishedPlan>();
  const [imageKind, setImageKind] = useState<'plan' | 'floorPlan'>('plan');
  const [zoomed, setZoomed] = useState(false);
  const imageStage = useRef<HTMLDivElement>(null);
  const [lead, setLead] = useState<LeadRequest>();
  const detailDialog = useRef<HTMLDialogElement>(null);
  const detailOpener = useRef<HTMLElement | null>(null);
  const transferredToLead = useRef(false);
  const closeLead = useCallback(() => setLead(undefined), []);
  const blocks = [...new Set(plans.map(plan => plan.block))];
  const rooms = [...new Set(plans.map(plan => plan.rooms))].sort((a, b) => a - b);
  const minArea = filters.minArea ? Number(filters.minArea) : 0;
  const maxArea = filters.maxArea ? Number(filters.maxArea) : Infinity;
  const invalidArea = minArea > maxArea;
  const filtered = plans.filter(plan => !invalidArea
    && (!filters.block || plan.block === filters.block)
    && (!filters.rooms || plan.rooms === Number(filters.rooms))
    && plan.area >= minArea && plan.area <= maxArea);
  const areaFormat = new Intl.NumberFormat(locale[language], { maximumFractionDigits: 2 });
  const areaLabel = (area: number) => `${areaFormat.format(area)} ${language === 'ru' ? 'м²' : 'm²'}`;
  const planLabel = (plan: PublishedPlan) => `${t.roomsLabel(plan.rooms)}, ${areaLabel(plan.area)}, ${t.block} ${plan.block}`;
  const projectHref = catalogHref(projectPath, language, attribution);
  const privacyHref = `${catalogHref('/privacy', language, attribution)}&project=dormon-hills&from=catalog`;
  const setFilter = (key: keyof PlanFilters, value: string) => {
    setFilters(current => ({ ...current, [key]: value }));
    setLimit(pageSize);
  };
  const reset = () => {
    setFilters(emptyFilters);
    setLimit(pageSize);
  };
  const showPlan = (plan: PublishedPlan, opener: HTMLElement) => {
    detailOpener.current = opener;
    transferredToLead.current = false;
    setDetail(plan);
    setImageKind('plan');
    setZoomed(false);
    detailDialog.current?.showModal();
  };
  const dismissDetail = () => {
    setDetail(undefined);
    setZoomed(false);
    if (!transferredToLead.current) detailOpener.current?.focus();
  };
  const inquireFromDetail = (plan: PublishedPlan, fallback: HTMLElement) => {
    transferredToLead.current = true;
    detailDialog.current?.close();
    setLead({ plan, opener: detailOpener.current ?? fallback });
  };
  const dialogImage = detail && (imageKind === 'floorPlan' ? detail.floorPlan : detail.plan);
  const detailIndex = detail ? filtered.findIndex(plan => plan.id === detail.id) : -1;
  const resetImage = () => {
    setZoomed(false);
    imageStage.current?.scrollTo({ top: 0, left: 0 });
  };
  const moveDetail = (direction: number) => {
    if (detailIndex < 0 || filtered.length < 2) return;
    setDetail(filtered[(detailIndex + direction + filtered.length) % filtered.length]);
    setImageKind('plan');
    resetImage();
  };

  return <div className="dh-plan-catalog" lang={language}>
    <DormonHeader homeHref={projectHref} language={language} compact
      languageHref={(item) => catalogHref(catalogPath, item, attribution, filters)}
      links={[{ href: projectHref, label: t.project }]} />
    <main>
      <section className="dh-plan-hero">
        <div className="dh-plan-wrap dh-plan-hero-inner">
          <div>
            <h1>{t.title}</h1>
            <p>{t.description}</p>
          </div>
          <img src={`${basePath}${projectPath}/images/hero.webp`} alt={t.heroAlt} fetchPriority="high" />
        </div>
      </section>
      <div className="dh-plan-wrap dh-plan-body">
        <fieldset className="dh-plan-filters">
          <legend>{t.filters}</legend>
          <label>{t.block}
            <select value={filters.block} onChange={event => setFilter('block', event.currentTarget.value)}>
              <option value="">{t.allBlocks}</option>
              {blocks.map(block => <option value={block} key={block}>{t.block} {block}</option>)}
            </select>
          </label>
          <label>{t.rooms}
            <select value={filters.rooms} onChange={event => setFilter('rooms', event.currentTarget.value)}>
              <option value="">{t.allRooms}</option>
              {rooms.map(room => <option value={room} key={room}>{t.roomsLabel(room)}</option>)}
            </select>
          </label>
          <label>{t.areaFrom}
            <input type="number" min="0" step="any" inputMode="decimal" value={filters.minArea}
              aria-invalid={invalidArea || undefined} aria-describedby={invalidArea ? 'dh-plan-range-error' : undefined}
              onChange={event => setFilter('minArea', event.currentTarget.value)} />
          </label>
          <label>{t.areaTo}
            <input type="number" min="0" step="any" inputMode="decimal" value={filters.maxArea}
              aria-invalid={invalidArea || undefined} aria-describedby={invalidArea ? 'dh-plan-range-error' : undefined}
              onChange={event => setFilter('maxArea', event.currentTarget.value)} />
          </label>
          <button type="button" className="dh-plan-text-action" onClick={reset} disabled={!Object.values(filters).some(Boolean)}>{t.reset}</button>
        </fieldset>
        {invalidArea && <p id="dh-plan-range-error" className="dh-plan-range-error" role="alert">{t.invalidArea}</p>}
        <div className="dh-plan-result-bar">
          <p role="status">{t.count(filtered.length)}</p>
          <a href={source} target="_blank" rel="noreferrer">{t.source}</a>
        </div>
        {filtered.length ? <>
          <ul className="dh-plan-grid">
            {filtered.slice(0, limit).map(plan => <li key={plan.id} className="dh-plan-card">
              <button type="button" className="dh-plan-card-image" aria-haspopup="dialog" aria-label={`${t.view}: ${planLabel(plan)}`}
                onClick={event => showPlan(plan, event.currentTarget)}>
                <PlanImage src={plan.plan} alt="" fallback={t.imagePlaceholder} />
              </button>
              <div className="dh-plan-card-content">
                <p>{t.block} {plan.block}{plan.floors && ` / ${t.floors(plan.floors)}`}</p>
                <h2>{areaLabel(plan.area)}</h2>
                <p>{t.roomsLabel(plan.rooms)}</p>
                <button type="button" className="dh-plan-text-action" aria-haspopup="dialog" onClick={event => setLead({ plan, opener: event.currentTarget })}>{t.inquire}</button>
              </div>
            </li>)}
          </ul>
          {filtered.length > limit && <div className="dh-plan-more">
            <button type="button" className="dh-plan-action" onClick={() => setLimit(current => current + pageSize)}>{t.more}</button>
          </div>}
        </> : <div className="dh-plan-empty">
          <h2>{t.empty}</h2><p>{t.emptyDescription}</p>
          <button type="button" className="dh-plan-action" onClick={reset}>{t.reset}</button>
        </div>}
      </div>
    </main>
    <footer className="dh-plan-footer">
      <div className="dh-plan-wrap dh-plan-footer-inner">
        <DormonBrand href={projectHref} />
        <a href="tel:+998781137712">+998 78 113 77 12</a>
        <button className="dh-plan-action" type="button" onClick={event => setLead({ opener: event.currentTarget })}>{t.contact}</button>
      </div>
    </footer>

    <dialog ref={detailDialog} className="dh-plan-dialog" aria-labelledby="dh-plan-dialog-title" onClose={dismissDetail}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'Escape' && zoomed) {
          event.preventDefault();
          resetImage();
        } else if (!zoomed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          moveDetail(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="dh-plan-dialog-closebar">
        <button type="button" className="dh-plan-close" onClick={() => detailDialog.current?.close()} aria-label={t.close}>
          <span>{dialogText.close}</span><span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="dh-plan-dialog-content">
        {detail && dialogImage ? <>
          <div ref={imageStage} className={`dh-plan-dialog-image${zoomed ? ' is-zoomed' : ''}`}>
            <button type="button" className="dh-plan-dialog-zoom" aria-pressed={zoomed}
              aria-label={zoomed ? dialogText.restore : dialogText.zoom}
              onClick={() => {
                if (zoomed) resetImage();
                else setZoomed(true);
              }}>
              <PlanImage key={dialogImage} src={dialogImage}
                alt={imageKind === 'floorPlan' ? `${t.floorPlan}. ${t.block} ${detail.block}` : planLabel(detail)}
                fallback={t.imagePlaceholder} eager />
            </button>
            {!zoomed && <span className="dh-plan-dialog-hint" aria-hidden="true">{dialogText.hint}</span>}
          </div>
          <div className="dh-plan-dialog-side">
            <div className="dh-plan-dialog-header" aria-live="polite" aria-atomic="true">
              <p className="dh-plan-dialog-kicker">{t.block} {detail.block}{detail.floors && ` · ${t.floors(detail.floors)}`}</p>
              <h2 id="dh-plan-dialog-title">{imageKind === 'floorPlan' ? t.floorPlan : t.roomsLabel(detail.rooms)}</h2>
              <p className="dh-plan-dialog-area">{areaFormat.format(detail.area)}<small>{language === 'ru' ? 'м²' : 'm²'}</small></p>
            </div>
            <dl className="dh-plan-dialog-facts">
              <div><dt>{t.block}</dt><dd>{detail.block}</dd></div>
              <div><dt>{t.rooms}</dt><dd>{detail.rooms}</dd></div>
              <div><dt>{dialogText.area}</dt><dd>{areaLabel(detail.area)}</dd></div>
            </dl>
            <div className="dh-plan-dialog-actions">
              <button type="button" className="dh-plan-action" onClick={event => inquireFromDetail(detail, event.currentTarget)}>{t.inquire}</button>
              {detail.floorPlan && <button type="button" className="dh-plan-action is-outline"
                aria-pressed={imageKind === 'floorPlan'} onClick={() => {
                  setImageKind(current => current === 'plan' ? 'floorPlan' : 'plan');
                  resetImage();
                }}>{imageKind === 'floorPlan' ? t.plan : t.floorPlan}</button>}
            </div>
            <div className="dh-plan-dialog-navigation" role="group" aria-label={t.view}>
              <button type="button" onClick={() => moveDetail(-1)} aria-label={dialogText.previous} disabled={filtered.length < 2}>←</button>
              <span aria-live="polite" aria-atomic="true">{String(detailIndex + 1).padStart(2, '0')} / {String(filtered.length).padStart(2, '0')}</span>
              <button type="button" onClick={() => moveDetail(1)} aria-label={dialogText.next} disabled={filtered.length < 2}>→</button>
            </div>
          </div>
        </> : <h2 id="dh-plan-dialog-title">{t.plan}</h2>}
      </div>
    </dialog>

    {lead && <LeadModal open language={language}
      context={lead.plan
        ? `projectSlug=dormon-hills;lang=${language};surface=typical-plans;layout=${lead.plan.id};block=${lead.plan.block};rooms=${lead.plan.rooms};area=${lead.plan.area}${lead.plan.floors ? `;floors=${lead.plan.floors}` : ''}`
        : `projectSlug=dormon-hills;lang=${language};surface=typical-plans`}
      brandName="TENCORP" projectName="Do’rmon Hills"
      tagline={lead.plan ? planLabel(lead.plan) : t.description}
      facts={[t.business, t.district, 'Millennium House']}
      submitUrl={`${basePath}/v1/leads`} projectSlug="dormon-hills" privacyUrl={privacyHref}
      requireConsent returnFocusTo={lead.opener} onClose={closeLead}
    />}
  </div>;
}
