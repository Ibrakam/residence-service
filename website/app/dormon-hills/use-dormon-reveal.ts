'use client';

import { useEffect, useRef } from 'react';

export function useDormonReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let stopObserving = () => {};

    function observeReveals() {
      stopObserving();
      if (!root || motion.matches) return;

      const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-dormon-reveal]'))
        .filter((element) => element.getBoundingClientRect().top >= window.innerHeight);
      const pending = new Set(elements);
      const observer = new IntersectionObserver((entries) => {
        for (const { target, isIntersecting } of entries) {
          if (!isIntersecting) continue;
          target.setAttribute('data-dormon-motion', 'entered');
          pending.delete(target as HTMLElement);
          observer.unobserve(target);
        }
      }, { rootMargin: '0px 0px -10% 0px' });

      function revealTarget(target: EventTarget | null) {
        if (!(target instanceof Node)) return;
        for (const element of pending) {
          if (!element.contains(target)) continue;
          element.removeAttribute('data-dormon-motion');
          pending.delete(element);
          observer.unobserve(element);
        }
      }
      const onFocus = (event: FocusEvent) => revealTarget(event.target);
      const onHashChange = () => revealTarget(document.querySelector(':target'));

      for (const element of elements) {
        element.setAttribute('data-dormon-motion', 'waiting');
        observer.observe(element);
      }
      root.addEventListener('focusin', onFocus);
      window.addEventListener('hashchange', onHashChange);
      onHashChange();

      stopObserving = () => {
        observer.disconnect();
        root?.removeEventListener('focusin', onFocus);
        window.removeEventListener('hashchange', onHashChange);
        for (const element of elements) element.removeAttribute('data-dormon-motion');
      };
    }

    observeReveals();
    motion.addEventListener('change', observeReveals);
    return () => {
      motion.removeEventListener('change', observeReveals);
      stopObserving();
    };
  }, []);

  return ref;
}
