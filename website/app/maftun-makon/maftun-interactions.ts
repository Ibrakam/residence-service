'use client';

import { useEffect } from 'react';

export function maftunScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

export function useMaftunSmoothScroll() {
  useEffect(() => {
    document.documentElement.classList.add('maftun-scroll-smooth');
    return () => document.documentElement.classList.remove('maftun-scroll-smooth');
  }, []);
}
