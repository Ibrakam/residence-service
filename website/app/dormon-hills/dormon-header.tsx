'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { DormonBrand } from './dormon-brand';
import type { DormonLanguage } from './dormon-data';

const labels = {
  ru: { menu: 'Меню', close: 'Закрыть меню', closeShort: 'Закрыть', nav: 'Навигация', language: 'Язык', contact: 'Свяжитесь с нами' },
  uz: { menu: 'Menyu', close: 'Menyuni yopish', closeShort: 'Yopish', nav: 'Navigatsiya', language: 'Til', contact: 'Biz bilan bog‘laning' },
  en: { menu: 'Menu', close: 'Close menu', closeShort: 'Close', nav: 'Navigation', language: 'Language', contact: 'Get in touch' },
};
const languages = ['ru', 'uz', 'en'] as const;

type Props = {
  homeHref: string;
  language: DormonLanguage;
  languageHref: (language: DormonLanguage) => string;
  links: { href: string; label: string }[];
  compact?: boolean;
  overlay?: boolean;
};

export function DormonHeader({ homeHref, language, languageHref, links, compact = false, overlay = false }: Props) {
  const t = labels[language];
  const menuId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const desktop = window.matchMedia('(min-width: 1101px)');
    const closeOnLayoutChange = () => dialogRef.current?.close();
    desktop.addEventListener('change', closeOnLayoutChange);
    return () => desktop.removeEventListener('change', closeOnLayoutChange);
  }, [expanded]);

  function closeMenu() {
    dialogRef.current?.close();
  }

  function renderLinks(inMenu = false) {
    return (
      <nav className={inMenu ? 'dormon-menu__links' : 'dormon-site-header__nav'} aria-label={t.nav}>
        {links.map(({ href, label }) => (
          <a key={href} href={href} onClick={inMenu ? closeMenu : undefined}>
            <span>{label}</span>{inMenu ? <span aria-hidden="true">↗</span> : null}
          </a>
        ))}
      </nav>
    );
  }

  function renderLanguages(inMenu = false) {
    return (
      <div className={inMenu ? 'dormon-menu__languages' : 'dormon-site-header__languages'} role="group" aria-label={t.language}>
        {languages.map((item) => (
          <a key={item} href={languageHref(item)} lang={item} hrefLang={item}
            aria-current={language === item ? 'page' : undefined}
            onClick={inMenu ? closeMenu : undefined}>{item.toUpperCase()}</a>
        ))}
      </div>
    );
  }

  return (
    <header className={`dormon-site-header${compact ? ' is-compact' : ''}${overlay ? ' is-overlay' : ''}`}>
      <div className="dormon-site-header__inner">
        <DormonBrand href={homeHref} />
        <div className="dormon-site-header__desktop">
          {renderLinks()}
          {renderLanguages()}
        </div>
        <button type="button" className="dormon-menu-toggle" ref={toggleRef}
          aria-label={t.menu} aria-haspopup="dialog" aria-controls={menuId} aria-expanded={expanded}
          onClick={() => {
            const dialog = dialogRef.current;
            if (!dialog || dialog.open) return;
            dialog.showModal();
            setExpanded(true);
            closeRef.current?.focus();
          }}>
          <span className="dormon-menu-toggle__label">{t.menu}</span>
          <span className="dormon-menu-icon" aria-hidden="true" />
        </button>
      </div>
      <dialog ref={dialogRef} id={menuId} className="dormon-menu" aria-label={t.menu}
        onClose={() => {
          setExpanded(false);
          toggleRef.current?.focus({ preventScroll: true });
        }}>
        <div className="dormon-menu__header">
          <DormonBrand href={homeHref} />
          <button type="button" className="dormon-menu-toggle" ref={closeRef} onClick={closeMenu} aria-label={t.close}>
            <span className="dormon-menu-toggle__label">{t.closeShort}</span>
            <span className="dormon-menu-icon is-close" aria-hidden="true" />
          </button>
        </div>
        <div className="dormon-menu__body">
          {renderLinks(true)}
          <div className="dormon-menu__aside">
            <div className="dormon-menu__contact">
              <p>{t.contact}</p>
              <a href="tel:+998781137712" onClick={closeMenu}>+998 78 113 77 12</a>
            </div>
            {renderLanguages(true)}
          </div>
        </div>
      </dialog>
    </header>
  );
}
