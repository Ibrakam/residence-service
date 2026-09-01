'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

type Language = 'ru' | 'uz' | 'en';
type Goal = 'live' | 'invest' | 'rent';
type ValidationField = 'name' | 'phone' | 'consent';

export type LastViewedApartment = {
  uuid?: string;
  unitId?: number;
  unitKey?: string;
  internalId?: string | number;
  crmId?: string | number;
  number?: string;
  rooms?: number;
  area?: number;
  floor?: number;
  maxFloor?: number;
  entrance?: number;
  queue?: number;
  section?: number;
  completion?: string;
  status?: string;
  publicPrice?: boolean;
  block?: string;
  blockName?: string;
  blockId?: string;
  price?: number;
  effectivePrice?: number;
  displayPrice?: number | string;
  regularPrice?: number;
  snapshotCampaignPrice?: number | null;
  campaignActive?: boolean;
  campaignDeadline?: string | null;
  normalizedDeadline?: string;
  sourceStatus?: string;
  studio?: boolean;
  viewedAt: string;
  url: string;
};

type LeadModalProps = {
  open: boolean;
  language: Language;
  context: string;
  autoPrompt?: boolean;
  brandName?: string;
  hideBrand?: boolean;
  projectName?: string;
  tagline?: string;
  facts?: readonly string[];
  submitUrl?: string;
  projectSlug?: string;
  unitId?: string | number;
  unitKey?: string;
  privacyUrl?: string;
  requireConsent?: boolean;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
};

const LAST_VIEWED_APARTMENT_KEY = 'sanat-last-viewed-apartment';
let leadBodyLockDepth = 0;
let leadPreviousOverflow = '';
let leadPreviousPaddingRight = '';

function lockLeadBody() {
  if (leadBodyLockDepth === 0) {
    leadPreviousOverflow = document.body.style.overflow;
    leadPreviousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    document.body.classList.add('is-lead-locked');
  }
  leadBodyLockDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leadBodyLockDepth = Math.max(0, leadBodyLockDepth - 1);
    if (leadBodyLockDepth === 0) {
      document.body.style.overflow = leadPreviousOverflow;
      document.body.style.paddingRight = leadPreviousPaddingRight;
      document.body.classList.remove('is-lead-locked');
    }
  };
}

function lastViewedApartmentKey(projectSlug?: string) {
  return projectSlug ? `${LAST_VIEWED_APARTMENT_KEY}:${projectSlug}` : LAST_VIEWED_APARTMENT_KEY;
}

const copy = {
  ru: {
    eyebrow: 'Персональная консультация',
    autoEyebrow: 'Вы с нами уже минуту',
    title: 'Подберём квартиру под ваш сценарий',
    lead: 'Оставьте контакты — менеджер TENCORP уточнит пожелания и подготовит актуальную подборку по AVALON RESIDENCE.',
    autoLead: 'Похоже, вы внимательно изучаете комплекс. Оставьте номер — спокойно ответим на вопросы и пришлём подходящие варианты.',
    name: 'Ваше имя',
    namePlaceholder: 'Как к вам обращаться',
    phone: 'Номер телефона',
    goal: 'Цель покупки',
    goals: { live: 'Для жизни', invest: 'Инвестиция', rent: 'Для аренды' },
    submit: 'Получить подборку',
    pending: 'Отправляем…',
    privacy: 'Нажимая кнопку, вы соглашаетесь на обработку персональных данных.', privacyLink: 'Подробнее',
    consent: 'Я согласен на обработку персональных данных.',
    consentError: 'Подтвердите согласие на обработку персональных данных.',
    successEyebrow: 'Заявка принята',
    successTitle: 'Спасибо!',
    successLead: 'Менеджер TENCORP свяжется с вами в ближайшее время.',
    back: 'Вернуться на сайт',
    phoneError: 'Введите 9 цифр номера после +998.',
    nameError: 'Введите имя — не менее 2 символов.',
    error: 'Не удалось отправить заявку. Попробуйте ещё раз.',
    deliveryError: 'Заявка не отправлена и не сохранена. Попробуйте ещё раз позже.',
    close: 'Закрыть форму',
    facts: ['Комфорт+', 'Метро Тузель', 'II квартал 2028'],
  },
  uz: {
    eyebrow: 'Shaxsiy maslahat',
    autoEyebrow: 'Biz bilan bir daqiqadan beri',
    title: 'Maqsadingizga mos kvartira tanlaymiz',
    lead: 'Kontaktlaringizni qoldiring — TENCORP menejeri istaklaringizni aniqlab, AVALON RESIDENCE bo‘yicha dolzarb variantlarni tayyorlaydi.',
    autoLead: 'Majmuani diqqat bilan o‘rganayotgan ko‘rinasiz. Raqamingizni qoldiring — savollarga javob berib, mos variantlarni yuboramiz.',
    name: 'Ismingiz',
    namePlaceholder: 'Sizga qanday murojaat qilamiz',
    phone: 'Telefon raqami',
    goal: 'Xarid maqsadi',
    goals: { live: 'Yashash uchun', invest: 'Investitsiya', rent: 'Ijaraga berish' },
    submit: 'Variantlarni olish',
    pending: 'Yuborilmoqda…',
    privacy: 'Tugmani bosish orqali shaxsiy ma’lumotlarni qayta ishlashga rozilik bildirasiz.', privacyLink: 'Batafsil',
    consent: 'Shaxsiy ma’lumotlarni qayta ishlashga roziman.',
    consentError: 'Shaxsiy ma’lumotlarni qayta ishlashga rozilikni tasdiqlang.',
    successEyebrow: 'Ariza qabul qilindi',
    successTitle: 'Rahmat!',
    successLead: 'TENCORP menejeri tez orada siz bilan bog‘lanadi.',
    back: 'Saytga qaytish',
    phoneError: '+998 dan keyin 9 ta raqam kiriting.',
    nameError: 'Ismingizni kiriting — kamida 2 ta belgi.',
    error: 'Arizani yuborib bo‘lmadi. Qayta urinib ko‘ring.',
    deliveryError: 'Ariza yuborilmadi va saqlanmadi. Keyinroq qayta urinib ko‘ring.',
    close: 'Formani yopish',
    facts: ['Komfort+', 'Tuzel metrosi', '2028-yil II chorak'],
  },
  en: {
    eyebrow: 'Personal consultation',
    autoEyebrow: 'You have been with us for a minute',
    title: 'We will find an apartment for your plans',
    lead: 'Leave your details and a TENCORP manager will clarify your needs and prepare current options at AVALON RESIDENCE.',
    autoLead: 'It looks like you are taking a close look at the project. Leave your number and we will answer your questions and share suitable options.',
    name: 'Your name',
    namePlaceholder: 'How should we address you?',
    phone: 'Phone number',
    goal: 'Purchase goal',
    goals: { live: 'For living', invest: 'Investment', rent: 'For rental' },
    submit: 'Get a selection',
    pending: 'Sending…',
    privacy: 'By clicking the button, you consent to the processing of personal data.', privacyLink: 'Learn more',
    consent: 'I consent to the processing of my personal data.',
    consentError: 'Confirm your consent to personal data processing.',
    successEyebrow: 'Request received',
    successTitle: 'Thank you!',
    successLead: 'A TENCORP manager will contact you shortly.',
    back: 'Return to the site',
    phoneError: 'Enter 9 digits after +998.',
    nameError: 'Enter your name — at least 2 characters.',
    error: 'We could not send the request. Please try again.',
    deliveryError: 'The request was not sent or saved. Please try again later.',
    close: 'Close form',
    facts: ['Comfort+', 'Tuzel metro', 'Q2 2028'],
  },
} as const;

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const localDigits = digits.startsWith('998') ? digits.slice(3) : digits;
  return `+998${localDigits}`;
}

function getCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);

  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getLastViewedApartment(projectSlug?: string): LastViewedApartment | null {
  try {
    const raw = localStorage.getItem(lastViewedApartmentKey(projectSlug));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LastViewedApartment>;
    if (typeof value.viewedAt !== 'string') return null;
    if (projectSlug === 'mirador' || projectSlug === 'ofiyat' || projectSlug === 'meros') {
      if (
        typeof value.unitKey !== 'string'
        || value.unitKey.length === 0
        || value.unitKey.length > 200
        || value.unitKey !== value.unitKey.trim()
        || /[\u0000-\u001f\u007f]/.test(value.unitKey)
      ) return null;
      const minimal = { unitKey: value.unitKey, viewedAt: value.viewedAt, url: typeof value.url === 'string' ? value.url : window.location.href } satisfies LastViewedApartment;
      localStorage.setItem(lastViewedApartmentKey(projectSlug), JSON.stringify(minimal));
      return minimal;
    }
    if (projectSlug === 'sun') {
      if (typeof value.unitKey !== 'string' || !/^sun-[a-z0-9-]+$/.test(value.unitKey)) return null;
      const minimal = { unitKey: value.unitKey, viewedAt: value.viewedAt, url: typeof value.url === 'string' ? value.url : window.location.href } satisfies LastViewedApartment;
      localStorage.setItem(lastViewedApartmentKey(projectSlug), JSON.stringify(minimal));
      return minimal;
    }
    if (typeof value.uuid !== 'string') return null;
    if (projectSlug === 'regnum-plaza') {
      const minimal = { uuid: value.uuid, viewedAt: value.viewedAt, url: typeof value.url === 'string' ? value.url : window.location.href } satisfies LastViewedApartment;
      localStorage.setItem(lastViewedApartmentKey(projectSlug), JSON.stringify(minimal));
      return minimal;
    }
    return value as LastViewedApartment;
  } catch {
    return null;
  }
}

export function rememberLastViewedApartment(apartment: Omit<LastViewedApartment, 'viewedAt' | 'url'>, projectSlug?: string) {
  try {
    localStorage.setItem(lastViewedApartmentKey(projectSlug), JSON.stringify({
      ...apartment,
      viewedAt: new Date().toISOString(),
      url: window.location.href,
    } satisfies LastViewedApartment));
  } catch {
    // Storage can be unavailable in private browsing; the form still works.
  }
}

class LeadSubmissionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function submitLead(input: { name: string; phone: string; goal: Goal; consent: boolean; context: string; language: Language; submitUrl: string; projectSlug?: string; unitId?: string | number; unitKey?: string }) {
  const params = new URLSearchParams(window.location.search);
  const fbclid = params.get('fbclid') || undefined;
  const fbc = getCookie('_fbc') || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined);
  const payload = {
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    goal: input.goal,
    consent: input.consent,
    formContext: input.context,
    projectSlug: input.projectSlug,
    unitId: input.unitId,
    unitKey: input.unitKey,
    lang: input.language,
    language: input.language,
    lastViewedApartment: getLastViewedApartment(input.projectSlug),
    fbc,
    fbp: getCookie('_fbp'),
    fbclid,
    utm_source: params.get('utm_source') || undefined,
    utm_medium: params.get('utm_medium') || undefined,
    utm_campaign: params.get('utm_campaign') || undefined,
    utm_content: params.get('utm_content') || undefined,
    utm_term: params.get('utm_term') || undefined,
    tcid: params.get('tcid') || undefined,
    landing_url: window.location.href,
    referrer_url: document.referrer || undefined,
  };

  const response = await fetch(input.submitUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  type LeadResponseBody = { success?: boolean; error?: string; message?: string };
  let body: LeadResponseBody | null = null;
  try {
    body = await response.json() as LeadResponseBody;
  } catch {
    body = null;
  }

  if (!response.ok || body?.success !== true) {
    throw new LeadSubmissionError(response.status, body?.message || body?.error || 'Submission failed');
  }
}

export function LeadModal({ open, language, context, autoPrompt = false, brandName = 'AVALON', hideBrand = false, projectName = 'RESIDENCE', tagline, facts, submitUrl = '/v1/leads', projectSlug, unitId, unitKey, privacyUrl, requireConsent = false, returnFocusTo, onClose }: LeadModalProps) {
  const [goal, setGoal] = useState<Goal>('live');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<ValidationField>();
  const panelRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const successTitleRef = useRef<HTMLHeadingElement>(null);
  const t = copy[language];
  const lead = language === 'ru'
    ? `Оставьте контакты — ${hideBrand ? 'менеджер проекта' : `менеджер ${brandName}`} уточнит пожелания и подготовит актуальную подборку по ${projectName}.`
    : language === 'uz'
      ? `Kontaktlaringizni qoldiring — ${hideBrand ? 'loyiha menejeri' : `${brandName} menejeri`} istaklaringizni aniqlab, ${projectName} bo‘yicha dolzarb variantlarni tayyorlaydi.`
      : `Leave your details and ${hideBrand ? 'the project manager' : `a ${brandName} manager`} will clarify your needs and prepare current options at ${projectName}.`;
  const successLead = hideBrand
    ? language === 'ru' ? 'Менеджер проекта свяжется с вами в ближайшее время.' : language === 'uz' ? 'Loyiha menejeri tez orada siz bilan bog‘lanadi.' : 'The project manager will contact you shortly.'
    : t.successLead.replace('TENCORP', brandName);

  useEffect(() => {
    if (!open) return;
    const opener = returnFocusTo ?? document.activeElement as HTMLElement | null;
    const unlockBody = lockLeadBody();
    const focusFrame = window.requestAnimationFrame(() => nameRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const panel = panelRef.current;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]),a[href],input:not([disabled]):not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panel.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      unlockBody();
      window.removeEventListener('keydown', onKeyDown);
      window.requestAnimationFrame(() => {
        const fallback = [
          ...document.querySelectorAll<HTMLElement>('.kayan-menu-button'),
          ...document.querySelectorAll<HTMLElement>('[data-lead-trigger], .kayan-header__lead'),
        ]
          .find((element) => !element.closest('[inert],[aria-hidden="true"]') && element.getClientRects().length > 0);
        const target = opener?.isConnected && opener.getClientRects().length > 0 && !opener.closest('[inert],[aria-hidden="true"]') ? opener : fallback;
        target?.focus({ preventScroll: true });
      });
    };
  }, [open, onClose, returnFocusTo]);

  useEffect(() => {
    if (!open || !sent) return;
    const focusFrame = window.requestAnimationFrame(() => successTitleRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, sent]);

  const showValidationError = (field: ValidationField, message: string) => {
    setError(message);
    setErrorField(field);
    const target = field === 'name' ? nameRef.current : field === 'phone' ? phoneRef.current : consentRef.current;
    window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const phone = normalizePhone(String(data.get('phone') || ''));
    if (name.length < 2) {
      showValidationError('name', t.nameError);
      return;
    }
    if (!/^\+998\d{9}$/.test(phone)) {
      showValidationError('phone', t.phoneError);
      return;
    }
    if (requireConsent && data.get('consent') !== 'on') {
      showValidationError('consent', t.consentError);
      return;
    }

    setPending(true);
    setError('');
    setErrorField(undefined);
    try {
      await submitLead({ name, phone, goal, consent: data.get('consent') === 'on', context, language, submitUrl, projectSlug, unitId, unitKey });
      form.reset();
      setGoal('live');
      setSent(true);
    } catch (submissionError) {
      setError(submissionError instanceof LeadSubmissionError && submissionError.status >= 500 ? t.deliveryError : t.error);
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title">
      <button className="lead-modal__backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.close} />
      <section ref={panelRef} className="lead-modal__panel">
        <button className="lead-modal__close" type="button" onClick={onClose} aria-label={t.close}>×</button>
        <aside className="lead-modal__visual">
          <span className="lead-modal__index">01</span>
          <div>{hideBrand ? null : <small>{brandName}</small>}<strong>{projectName}</strong></div>
          <p>{tagline || (language === 'ru' ? 'Дом, к которому хочется возвращаться.' : language === 'uz' ? 'Qaytishni istaydigan uy.' : 'A home worth returning to.')}</p>
          <ul>{(facts || t.facts).map((fact) => <li key={fact}>{fact}</li>)}</ul>
        </aside>
        <div className="lead-modal__content">
          {!sent ? (
            <>
              <span className="lead-modal__eyebrow">{autoPrompt ? t.autoEyebrow : t.eyebrow}</span>
              <h2 id="lead-modal-title">{t.title}</h2>
              <p>{autoPrompt ? t.autoLead : lead}</p>
              <form className="lead-form" onSubmit={onSubmit} noValidate>
                <label><span>{t.name}</span><input ref={nameRef} name="name" autoComplete="name" required placeholder={t.namePlaceholder} aria-invalid={errorField === 'name' || undefined} aria-describedby={errorField === 'name' ? 'lead-form-error' : undefined} /></label>
                <label><span>{t.phone}</span><div className="lead-phone"><b>+998</b><input ref={phoneRef} name="phone" type="tel" inputMode="numeric" autoComplete="tel" required placeholder="90 000 00 00" aria-invalid={errorField === 'phone' || undefined} aria-describedby={errorField === 'phone' ? 'lead-form-error' : undefined} onInput={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/[^0-9 ]/g, '').slice(0, 12); }} /></div></label>
                <fieldset><legend>{t.goal}</legend><div className="lead-goals">{(['live', 'invest', 'rent'] as Goal[]).map((value) => <label key={value} className={goal === value ? 'is-active' : ''}><input type="radio" name="goal" value={value} checked={goal === value} onChange={() => setGoal(value)} /><span>{t.goals[value]}</span></label>)}</div></fieldset>
                {requireConsent ? <label className="lead-consent"><input ref={consentRef} name="consent" type="checkbox" required aria-invalid={errorField === 'consent' || undefined} aria-describedby={errorField === 'consent' ? 'lead-form-error' : undefined} /><span>{t.consent}</span></label> : null}
                <button className="lead-form__submit" type="submit" disabled={pending}>{pending ? t.pending : t.submit}<span>↗</span></button>
                {error ? <p id="lead-form-error" className="lead-form__error" role="alert">{error}</p> : null}
                <small className="lead-form__privacy">{t.privacy}{privacyUrl ? <> <a href={privacyUrl}>{t.privacyLink}</a></> : null}</small>
              </form>
            </>
          ) : (
            <div className="lead-success">
              <span className="lead-success__icon">✓</span>
              <small>{t.successEyebrow}</small>
              <h2 ref={successTitleRef} id="lead-modal-title" tabIndex={-1}>{t.successTitle}</h2>
              <p>{successLead}</p>
              <button type="button" onClick={onClose}>{t.back}</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
