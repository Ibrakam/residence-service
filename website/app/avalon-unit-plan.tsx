'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { verifiedAvalonPlan } from './avalon-catalog';

export function AvalonUnitPlan({ unit, language, onOpen }: { unit: { number: number; planImageUrl?: string }; language: 'ru' | 'uz'; onOpen?: () => void }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = verifiedAvalonPlan(unit.planImageUrl);
  if (!source || failedSource === source) return <div className="avalon-plan-unavailable"><strong>{language === 'ru' ? 'Точная планировка пока не опубликована' : 'Aniq reja hali e’lon qilinmagan'}</strong><p>{language === 'ru' ? 'Запросите план этой квартиры у менеджера. Чужие и типовые планы здесь не подставляются.' : 'Ushbu xonadon rejasini menejerdan so‘rang. Boshqa xonadon rejasi ko‘rsatilmaydi.'}</p></div>;
  const image = <img src={`${process.env.NODE_ENV === 'production' ? '/avalon-assets' : process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ''}${source}`} alt={`${language === 'ru' ? 'Планировка квартиры' : 'Xonadon rejasi'} №${unit.number}`} onError={() => setFailedSource(source)} loading="lazy" decoding="async" />;
  return onOpen ? <button className="unit-plan-preview" type="button" onClick={onOpen} aria-label={language === 'ru' ? 'Увеличить точную планировку' : 'Aniq rejani kattalashtirish'}>{image}</button> : image;
}
