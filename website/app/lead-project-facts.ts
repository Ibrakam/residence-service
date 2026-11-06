type Language = 'ru' | 'uz' | 'en';

const neutralFacts: Record<Language, readonly string[]> = {
  ru: ['Персональная консультация', 'Индивидуальный подбор', 'Актуальные условия'],
  uz: ['Shaxsiy maslahat', 'Individual tanlov', 'Dolzarb shartlar'],
  en: ['Personal consultation', 'Apartment selection', 'Current terms'],
};

export function leadProjectFacts(language: Language, projectSlug: string | undefined, supplied: readonly string[] | undefined, avalonDefaults: readonly string[]): readonly string[] {
  if (supplied !== undefined) return supplied;
  return projectSlug && projectSlug !== 'avalon-residence' ? neutralFacts[language] : avalonDefaults;
}
