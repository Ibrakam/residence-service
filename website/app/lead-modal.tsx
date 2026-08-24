'use client';

import { type FormEvent, useEffect, useState } from 'react';

type Language = 'ru' | 'uz';
type Goal = 'live' | 'invest' | 'rent';

export type LastViewedApartment = {
  uuid: string;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  maxFloor: number;
  entrance: number;
  blockName: string;
  blockId: string;
  price: number;
  viewedAt: string;
  url: string;
};

type LeadModalProps = {
  open: boolean;
  language: Language;
  context: string;
  autoPrompt?: boolean;
  onClose: () => void;
};

const LAST_VIEWED_APARTMENT_KEY = 'sanat-last-viewed-apartment';

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
    privacy: 'Нажимая кнопку, вы соглашаетесь на обработку персональных данных.',
    successEyebrow: 'Заявка принята',
    successTitle: 'Спасибо!',
    successLead: 'Менеджер TENCORP свяжется с вами в ближайшее время.',
    back: 'Вернуться на сайт',
    phoneError: 'Введите 9 цифр номера после +998.',
    error: 'Не удалось отправить заявку. Попробуйте ещё раз.',
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
    privacy: 'Tugmani bosish orqali shaxsiy ma’lumotlarni qayta ishlashga rozilik bildirasiz.',
    successEyebrow: 'Ariza qabul qilindi',
    successTitle: 'Rahmat!',
    successLead: 'TENCORP menejeri tez orada siz bilan bog‘lanadi.',
    back: 'Saytga qaytish',
    phoneError: '+998 dan keyin 9 ta raqam kiriting.',
    error: 'Arizani yuborib bo‘lmadi. Qayta urinib ko‘ring.',
    close: 'Formani yopish',
    facts: ['Komfort+', 'Tuzel metrosi', '2028-yil II chorak'],
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

function getLastViewedApartment(): LastViewedApartment | null {
  try {
    const raw = localStorage.getItem(LAST_VIEWED_APARTMENT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LastViewedApartment>;
    if (typeof value.uuid !== 'string' || typeof value.number !== 'string' || typeof value.viewedAt !== 'string') return null;
    return value as LastViewedApartment;
  } catch {
    return null;
  }
}

export function rememberLastViewedApartment(apartment: Omit<LastViewedApartment, 'viewedAt' | 'url'>) {
  try {
    localStorage.setItem(LAST_VIEWED_APARTMENT_KEY, JSON.stringify({
      ...apartment,
      viewedAt: new Date().toISOString(),
      url: window.location.href,
    } satisfies LastViewedApartment));
  } catch {
    // Storage can be unavailable in private browsing; the form still works.
  }
}

async function submitLead(input: { name: string; phone: string; goal: Goal; context: string }) {
  const params = new URLSearchParams(window.location.search);
  const fbclid = params.get('fbclid') || undefined;
  const fbc = getCookie('_fbc') || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined);
  const payload = {
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    goal: input.goal,
    formContext: input.context,
    lastViewedApartment: getLastViewedApartment(),
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

  const response = await fetch('/api/submit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  let body: { success?: boolean; error?: string; message?: string } | null = null;
  try {
    body = await response.json() as typeof body;
  } catch {
    body = null;
  }

  if (!response.ok || body?.success === false) {
    throw new Error(body?.message || body?.error || 'Submission failed');
  }
}

export function LeadModal({ open, language, context, autoPrompt = false, onClose }: LeadModalProps) {
  const [goal, setGoal] = useState<Goal>('live');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const t = copy[language];

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('is-lead-locked');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('is-lead-locked');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const phone = normalizePhone(String(data.get('phone') || ''));
    if (!/^\+998\d{9}$/.test(phone)) {
      setError(t.phoneError);
      return;
    }

    setPending(true);
    setError('');
    try {
      await submitLead({ name: String(data.get('name') || ''), phone, goal, context });
      form.reset();
      setGoal('live');
      setSent(true);
    } catch {
      setError(t.error);
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title">
      <button className="lead-modal__backdrop" type="button" onClick={onClose} aria-label={t.close} />
      <section className="lead-modal__panel">
        <button className="lead-modal__close" type="button" onClick={onClose} aria-label={t.close}>×</button>
        <aside className="lead-modal__visual">
          <span className="lead-modal__index">01</span>
          <div><small>AVALON</small><strong>RESIDENCE</strong></div>
          <p>{language === 'ru' ? 'Дом, к которому хочется возвращаться.' : 'Qaytishni istaydigan uy.'}</p>
          <ul>{t.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        </aside>
        <div className="lead-modal__content">
          {!sent ? (
            <>
              <span className="lead-modal__eyebrow">{autoPrompt ? t.autoEyebrow : t.eyebrow}</span>
              <h2 id="lead-modal-title">{t.title}</h2>
              <p>{autoPrompt ? t.autoLead : t.lead}</p>
              <form className="lead-form" onSubmit={onSubmit}>
                <label><span>{t.name}</span><input name="name" autoComplete="name" required placeholder={t.namePlaceholder} autoFocus /></label>
                <label><span>{t.phone}</span><div className="lead-phone"><b>+998</b><input name="phone" type="tel" inputMode="numeric" autoComplete="tel" required placeholder="90 000 00 00" onInput={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/[^0-9 ]/g, '').slice(0, 12); }} /></div></label>
                <fieldset><legend>{t.goal}</legend><div className="lead-goals">{(['live', 'invest', 'rent'] as Goal[]).map((value) => <label key={value} className={goal === value ? 'is-active' : ''}><input type="radio" name="goal" value={value} checked={goal === value} onChange={() => setGoal(value)} /><span>{t.goals[value]}</span></label>)}</div></fieldset>
                <button className="lead-form__submit" type="submit" disabled={pending}>{pending ? t.pending : t.submit}<span>↗</span></button>
                {error ? <p className="lead-form__error" role="alert">{error}</p> : null}
                <small className="lead-form__privacy">{t.privacy}</small>
              </form>
            </>
          ) : (
            <div className="lead-success">
              <span className="lead-success__icon">✓</span>
              <small>{t.successEyebrow}</small>
              <h2 id="lead-modal-title">{t.successTitle}</h2>
              <p>{t.successLead}</p>
              <button type="button" onClick={onClose}>{t.back}</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
