'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { pushkinHref, type PushkinLanguage } from '../pushkin-data';
import type snapshotType from '@/data/pushkin-catalog.json';

type Snapshot = typeof snapshotType;
const base = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const capabilities: CatalogCapabilities = { visualFlow: false, exactUnitPlans: true, secondaryPlans: false, pricesVisible: true, phases: false, buildings: true, entrances: false };

export function PushkinCatalog({ initialLanguage }: { initialLanguage: PushkinLanguage }) {
  const query = useSearchParams().toString();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true); const [error, setError] = useState(false); const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let current = true; let lastAttempt = 0;
    const load = async () => {
      if (!current || document.visibilityState === 'hidden') return;
      lastAttempt = Date.now(); setLoading(true);
      try {
        const response = await fetch(`${base}/api/pushkin-catalog`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]), credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Source unavailable');
        const data: Snapshot = await response.json();
        if (data.projectSlug !== 'pushkin' || data.complete !== true || data.units.length !== data.officialCount
          || Date.now() - Date.parse(data.capturedAt) > 10 * 60_000 || !Number.isFinite(Date.parse(data.capturedAt))
          || data.units.some(u => u.status !== 'available' || !/^\/pushkin\/plans\/[a-f0-9]{20}\.png$/.test(u.plan))) throw new Error('Incomplete or stale source');
        if (current) { setSnapshot(data); setError(false); }
      } catch {
        if (current && !controller.signal.aborted) { setSnapshot(undefined); setError(true); }
      } finally { if (current) setLoading(false); }
    };
    void load(); const timer = setInterval(() => void load(), 180_000);
    const focus = () => { if (Date.now() - lastAttempt > 60_000) void load(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { current = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [version]);
  const units = useMemo<CatalogUnit[]>(() => snapshot?.units.map(unit => ({
    id: unit.id, unitKey: unit.sourceKey, number: unit.number, rooms: unit.rooms,
    area: unit.area, floor: unit.floor, maxFloor: 16, building: unit.building,
    propertyType: 'apartment', status: 'available', price: unit.price, pricePerM2: unit.pricePerM2,
    currency: 'UZS', plans: [{ src: unit.plan, kind: 'unit' }],
  })) ?? [], [snapshot]);
  const presentation = useMemo<CatalogPresentation>(() => ({
    brand: 'Pushkin', brandSubtitle: 'TOWER UP · BUSINESS',
    title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
    accent: { ru: 'в своём кругу.', uz: 'o‘z davrangizda.', en: 'in your own circle.' },
    lead: { ru: 'Актуальные предложения Taqsim. Точные планировки, площади и цены в сумах. Сдача по источнику: IV квартал 2027 года.', uz: 'Taqsimning dolzarb takliflari. Aniq rejalar, maydonlar va so‘mdagi narxlar. Manbaga ko‘ra topshirish: 2027-yil IV chorak.', en: 'Current Taqsim listings. Exact floor plans, areas and prices in UZS. The source lists completion in Q4 2027.' },
    backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
    backHref: lang => pushkinHref('/pushkin', lang, query),
    privacyHref: lang => `${pushkinHref('/privacy', lang, query)}&project=pushkin&from=catalog`,
    phone: '+998 78 113 77 12', storageKey: 'pushkin-language', cardPageSize: 12,
    defaultSort: 'price-asc', availableOnlyDefault: true,
    buildingLabel: { ru: 'Секция', uz: 'Seksiya', en: 'Section' }, allBuildingsLabel: { ru: 'Все секции', uz: 'Barcha seksiyalar', en: 'All sections' },
    disclaimer: { ru: 'Источник: Taqsim Estate. Показаны опубликованные доступные квартиры. Полная стоимость финансирования и ежемесячный платёж могут отличаться от указанной цены. Наличие и условия подтверждает менеджер.', uz: 'Manba: Taqsim Estate. E’lon qilingan mavjud xonadonlar ko‘rsatilgan. Moliyalashtirishning to‘liq qiymati va oylik to‘lov ko‘rsatilgan narxdan farq qilishi mumkin. Mavjudlik va shartlarni menejer tasdiqlaydi.', en: 'Source: Taqsim Estate. Published available apartments are shown. Financing totals and monthly payments may differ from the listed price. A manager confirms availability and terms.' },
    theme: { '--catalog-ink': '#292b25', '--catalog-paper': '#f2eee5', '--catalog-surface': '#faf8f2', '--catalog-accent': '#6b2737', '--catalog-accent-soft': '#e1c8ba' },
  }), [query]);
  return <ApartmentCatalog project={{ slug: 'pushkin', name: 'Pushkin', className: 'Business', address: 'Олмачи, 21', availableCount: units.length, totalCount: units.length, statusLabel: { ru: 'IV квартал 2027', uz: '2027-yil IV chorak', en: 'Q4 2027' } }} units={units} capabilities={capabilities} presentation={presentation} initialLanguage={initialLanguage} refreshedAt={snapshot?.capturedAt} dataSource={snapshot ? 'live' : 'embedded'} isLoading={loading} loadError={error} retry={() => setVersion(v => v + 1)} />;
}
