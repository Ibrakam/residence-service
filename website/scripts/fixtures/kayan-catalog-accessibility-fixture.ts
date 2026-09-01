import assert from 'node:assert/strict';
import catalog from '../../data/kayan-catalog.json';
import { catalogUnitAriaLabel, type CatalogAccessibilityLanguage, type CatalogAccessibilityStatus } from '../../app/kayan/catalog-accessibility';

const languages: CatalogAccessibilityLanguage[] = ['ru', 'uz', 'en'];
const modes = ['chess', 'chess-plus'] as const;
const localized = {
  ru: {
    entrance: 'Подъезд', floor: 'Этаж', status: 'Статус', area: 'м²',
    statuses: { available: 'Свободно', reserved: 'Бронь', sold: 'Продано', unavailable: 'Не продаётся' },
  },
  uz: {
    entrance: 'Kirish', floor: 'Qavat', status: 'Holat', area: 'm²',
    statuses: { available: 'Mavjud', reserved: 'Band', sold: 'Sotilgan', unavailable: 'Sotuvda emas' },
  },
  en: {
    entrance: 'Entrance', floor: 'Floor', status: 'Status', area: 'm²',
    statuses: { available: 'Available', reserved: 'Reserved', sold: 'Sold', unavailable: 'Not for sale' },
  },
} as const;

function phaseLabel(slug: string, fallback: string, language: CatalogAccessibilityLanguage) {
  if (slug === 'phase-1') return language === 'ru' ? 'I очередь' : language === 'uz' ? 'I bosqich' : 'Phase I';
  if (slug === 'phase-2') return language === 'ru' ? 'II очередь' : language === 'uz' ? 'II bosqich' : 'Phase II';
  if (slug === 'parking') return language === 'ru' ? 'Паркинг' : 'Parking';
  return fallback;
}

function floorLabel(floor: number) {
  return floor < 0 ? `P${Math.abs(floor)}` : String(floor);
}

for (const projectEntry of catalog.projects) {
  if (projectEntry.project.slug !== 'mirador' && projectEntry.project.slug !== 'ofiyat') continue;
  for (const language of languages) {
    const allProjectLabels: string[] = [];
    for (const phase of projectEntry.project.phases) {
      const units = projectEntry.units.filter((unit) => unit.phaseSlug === phase.slug);
      assert(units.length > 0, `${projectEntry.project.slug}/${phase.slug} has no eligible grid units`);
      for (const mode of modes) {
        const labels = units.map((unit) => catalogUnitAriaLabel({
          projectName: projectEntry.project.name.toUpperCase(),
          phaseLabel: phaseLabel(phase.slug, phase.name, language),
          language,
          unit: { ...unit, status: unit.status as CatalogAccessibilityStatus },
        }));

        assert.equal(labels.length, units.length, `${projectEntry.project.slug}/${phase.slug}/${language}/${mode} lost grid labels`);
        assert.equal(new Set(labels).size, labels.length, `${projectEntry.project.slug}/${phase.slug}/${language}/${mode} has ambiguous accessible names`);
        labels.forEach((label, index) => {
          const unit = units[index];
          const t = localized[language];
          assert(label.includes(projectEntry.project.name.toUpperCase()), `${mode} label lacks project context: ${label}`);
          assert(label.includes(phaseLabel(phase.slug, phase.name, language)), `${mode} label lacks localized phase: ${label}`);
          assert(label.includes(`${t.entrance} ${unit.entrance}`), `${mode} label lacks entrance identity: ${label}`);
          assert(label.includes(`${t.floor} ${floorLabel(unit.floor)}`), `${mode} label lacks floor identity: ${label}`);
          assert(label.includes(`№${unit.number}`), `${mode} label lacks unit number: ${label}`);
          assert(label.includes(`${t.status}: ${t.statuses[unit.status as CatalogAccessibilityStatus]}`), `${mode} label lacks localized status: ${label}`);
          assert(label.includes(`${unit.area} ${t.area}`), `${mode} label lacks area: ${label}`);
          if (unit.propertyType !== 'parking' && typeof unit.rooms === 'number') {
            const roomsLabel = language === 'en' && unit.rooms === 1 ? 'room' : language === 'ru' ? 'комн.' : language === 'uz' ? 'xona' : 'rooms';
            assert(label.includes(`${unit.rooms} ${roomsLabel}`), `${mode} label lacks localized room count: ${label}`);
          }
          assert(!label.includes(unit.sourceKey), `${mode} label leaked sourceKey: ${label}`);
        });
        if (mode === 'chess') allProjectLabels.push(...labels);
      }
    }
    assert.equal(new Set(allProjectLabels).size, allProjectLabels.length, `${projectEntry.project.slug}/${language} labels collide across phases`);
  }
}
