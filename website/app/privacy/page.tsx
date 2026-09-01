import type { Metadata } from 'next';
import Link from 'next/link';
import { PrivacyLanguageSync } from './privacy-language-sync';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string; project?: string; from?: string }> };
type PrivacyCopy = {
  metadataTitle: string;
  metadataDescription: string;
  back: string;
  catalogBack?: string;
  eyebrow: string;
  title: readonly [string, string];
  intro: string;
  dataTitle: string;
  dataText: string;
  purposeTitle: string;
  purposeText: string;
  revokeTitle: string;
  revokeBefore: string;
  revokeAfter: string;
  warning: string;
  projectLink: string;
  catalogLink?: string;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';

function nextLinkHref(prefixedUrl: string) {
  if (!appBasePath) return prefixedUrl;
  if (prefixedUrl === appBasePath) return '/';
  return prefixedUrl.startsWith(`${appBasePath}/`) ? prefixedUrl.slice(appBasePath.length) : prefixedUrl;
}

const legacyCopy: PrivacyCopy = {
  metadataTitle: 'Обработка персональных данных',
  metadataDescription: 'Информация об обработке данных, отправленных через формы проектов.',
  back: '← Вернуться в Mirador',
  eyebrow: 'ИНФОРМАЦИЯ ДЛЯ ПОСЕТИТЕЛЕЙ',
  title: ['Обработка', 'персональных данных.'],
  intro: 'Мы используем данные из формы только для ответа на запрос и подготовки подходящих предложений по выбранному жилому проекту.',
  dataTitle: 'Какие данные',
  dataText: 'Имя, номер телефона, цель покупки, выбранный проект или объект, а также технические метки источника перехода.',
  purposeTitle: 'Для чего',
  purposeText: 'Чтобы связаться с вами, уточнить пожелания, ответить на вопросы и подготовить актуальную подборку объектов.',
  revokeTitle: 'Как отозвать согласие',
  revokeBefore: 'Сообщите менеджеру при звонке или обратитесь по номеру',
  revokeAfter: '.',
  warning: 'Не передавайте в форме паспортные, банковские и другие чувствительные данные.',
  projectLink: 'MIRADOR RESIDENCE ↗',
};

const maftunCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Maftun Makon',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Maftun Makon.',
    back: '← Вернуться в Maftun Makon',
    projectLink: 'MAFTUN MAKON ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Maftun Makon',
    metadataDescription: 'Maftun Makon loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Maftun Makon sahifasiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish va tanlangan turar joy loyihasi bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, tanlangan loyiha yoki obyekt, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, savollarga javob berish va obyektlarning dolzarb tanlovini tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin',
    revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki',
    revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.',
    projectLink: 'MAFTUN MAKON ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Maftun Makon',
    metadataDescription: 'Information about processing data submitted through the Maftun Makon project forms.',
    back: '← Return to Maftun Makon',
    eyebrow: 'INFORMATION FOR VISITORS',
    title: ['Personal data', 'processing.'],
    intro: 'We use information submitted through the form only to respond to your enquiry and prepare suitable options for the selected residential project.',
    dataTitle: 'Data we collect',
    dataText: 'Your name, phone number, purchase goal, selected project or property, and technical source information.',
    purposeTitle: 'How we use it',
    purposeText: 'To contact you, understand your requirements, answer questions and prepare an up-to-date selection of properties.',
    revokeTitle: 'How to withdraw consent',
    revokeBefore: 'Tell the manager during the call or contact us at',
    revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.',
    projectLink: 'MAFTUN MAKON ↗',
  },
};

const botanikaCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Botanika Saroyi',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Botanika Saroyi.',
    back: '← Вернуться в Botanika Saroyi',
    projectLink: 'BOTANIKA SAROYI ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Botanika Saroyi',
    metadataDescription: 'Botanika Saroyi loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Botanika Saroyi sahifasiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish va Botanika Saroyi bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, tanlangan loyiha yoki xonadon, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, savollarga javob berish va xonadonlarning dolzarb tanlovini tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin',
    revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki',
    revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.',
    projectLink: 'BOTANIKA SAROYI ↗',
    catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Botanika Saroyi',
    metadataDescription: 'Information about processing data submitted through the Botanika Saroyi project forms.',
    back: '← Return to Botanika Saroyi',
    eyebrow: 'INFORMATION FOR VISITORS',
    title: ['Personal data', 'processing.'],
    intro: 'We use information submitted through the form only to respond to your enquiry and prepare suitable Botanika Saroyi options.',
    dataTitle: 'Data we collect',
    dataText: 'Your name, phone number, purchase goal, selected project or apartment, and technical source information.',
    purposeTitle: 'How we use it',
    purposeText: 'To contact you, understand your requirements, answer questions and prepare an up-to-date selection of apartments.',
    revokeTitle: 'How to withdraw consent',
    revokeBefore: 'Tell the manager during the call or contact us at',
    revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.',
    projectLink: 'BOTANIKA SAROYI ↗',
    catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const bayterakCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Bayterak',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Bayterak.',
    back: '← Вернуться в Bayterak',
    intro: 'Мы используем данные из формы только для ответа на запрос и подготовки подходящих предложений по проекту Bayterak.',
    dataText: 'Имя, номер телефона, цель покупки, выбранный проект или квартира, а также технические метки источника перехода.',
    projectLink: 'BAYTERAK ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Bayterak',
    metadataDescription: 'Bayterak loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Bayterak sahifasiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish va Bayterak bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, tanlangan loyiha yoki xonadon, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, savollarga javob berish va xonadonlarning dolzarb tanlovini tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin',
    revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki',
    revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.',
    projectLink: 'BAYTERAK ↗',
    catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Bayterak',
    metadataDescription: 'Information about processing data submitted through the Bayterak project forms.',
    back: '← Return to Bayterak',
    eyebrow: 'INFORMATION FOR VISITORS',
    title: ['Personal data', 'processing.'],
    intro: 'We use information submitted through the form only to respond to your enquiry and prepare suitable Bayterak options.',
    dataTitle: 'Data we collect',
    dataText: 'Your name, phone number, purchase goal, selected project or apartment, and technical source information.',
    purposeTitle: 'How we use it',
    purposeText: 'To contact you, understand your requirements, answer questions and prepare an up-to-date selection of apartments.',
    revokeTitle: 'How to withdraw consent',
    revokeBefore: 'Tell the manager during the call or contact us at',
    revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.',
    projectLink: 'BAYTERAK ↗',
    catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const zamonCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Zamon',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Zamon.',
    back: '← Вернуться в Zamon',
    intro: 'Мы используем данные из формы только для ответа на запрос и подготовки подходящих предложений по проекту Zamon.',
    dataText: 'Имя, номер телефона, цель покупки, выбранный проект или квартира, а также технические метки источника перехода.',
    projectLink: 'ZAMON ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Zamon',
    metadataDescription: 'Zamon loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Zamon sahifasiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish va Zamon bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, tanlangan loyiha yoki xonadon, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, savollarga javob berish va xonadonlarning dolzarb tanlovini tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin',
    revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki',
    revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.',
    projectLink: 'ZAMON ↗',
    catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Zamon',
    metadataDescription: 'Information about processing data submitted through the Zamon project forms.',
    back: '← Return to Zamon',
    eyebrow: 'INFORMATION FOR VISITORS',
    title: ['Personal data', 'processing.'],
    intro: 'We use information submitted through the form only to respond to your enquiry and prepare suitable Zamon options.',
    dataTitle: 'Data we collect',
    dataText: 'Your name, phone number, purchase goal, selected project or apartment, and technical source information.',
    purposeTitle: 'How we use it',
    purposeText: 'To contact you, understand your requirements, answer questions and prepare an up-to-date selection of apartments.',
    revokeTitle: 'How to withdraw consent',
    revokeBefore: 'Tell the manager during the call or contact us at',
    revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.',
    projectLink: 'ZAMON ↗',
    catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const yangiBaxtCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Yangi Baxt',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Yangi Baxt.',
    back: '← Вернуться в Yangi Baxt',
    catalogBack: '← Вернуться в каталог Yangi Baxt',
    intro: 'Мы используем данные из формы только для ответа на запрос и подготовки подходящих предложений по проекту Yangi Baxt.',
    dataText: 'Имя, номер телефона, цель покупки, выбранный проект или квартира, а также технические метки источника перехода.',
    projectLink: 'YANGI BAXT ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Yangi Baxt',
    metadataDescription: 'Yangi Baxt loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Yangi Baxt sahifasiga qaytish',
    catalogBack: '← Yangi Baxt katalogiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish va Yangi Baxt bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, tanlangan loyiha yoki xonadon, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, savollarga javob berish va xonadonlarning dolzarb tanlovini tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin',
    revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki',
    revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.',
    projectLink: 'YANGI BAXT ↗',
    catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Yangi Baxt',
    metadataDescription: 'Information about processing data submitted through the Yangi Baxt project forms.',
    back: '← Return to Yangi Baxt',
    catalogBack: '← Return to the Yangi Baxt catalogue',
    eyebrow: 'INFORMATION FOR VISITORS',
    title: ['Personal data', 'processing.'],
    intro: 'We use information submitted through the form only to respond to your enquiry and prepare suitable Yangi Baxt options.',
    dataTitle: 'Data we collect',
    dataText: 'Your name, phone number, purchase goal, selected project or apartment, and technical source information.',
    purposeTitle: 'How we use it',
    purposeText: 'To contact you, understand your requirements, answer questions and prepare an up-to-date selection of apartments.',
    revokeTitle: 'How to withdraw consent',
    revokeBefore: 'Tell the manager during the call or contact us at',
    revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.',
    projectLink: 'YANGI BAXT ↗',
    catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const jomiyCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Jomiy',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Jomiy.',
    back: '← Вернуться в Jomiy',
    catalogBack: '← Вернуться в каталог Jomiy',
    intro: 'Мы используем данные из формы только для ответа на запрос, проверки текущего статуса позиции и подготовки подходящих предложений по проекту Jomiy.',
    dataText: 'Имя, номер телефона, цель покупки, язык, контекст формы, выбранная позиция и её подтверждённые характеристики, а также технические метки источника перехода.',
    projectLink: 'JOMIY ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Jomiy',
    metadataDescription: 'Jomiy loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Jomiy sahifasiga qaytish',
    catalogBack: '← Jomiy katalogiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish, pozitsiyaning joriy holatini tekshirish va Jomiy bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, til, shakl konteksti, tanlangan pozitsiya va uning tasdiqlangan xususiyatlari, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, mavjudlikni qayta tekshirish va dolzarb tanlovni tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin', revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki', revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.', projectLink: 'JOMIY ↗', catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Jomiy',
    metadataDescription: 'Information about processing data submitted through the Jomiy project forms.',
    back: '← Return to Jomiy',
    catalogBack: '← Return to the Jomiy catalogue',
    eyebrow: 'INFORMATION FOR VISITORS', title: ['Personal data', 'processing.'],
    intro: 'We use information submitted through the form only to respond to your enquiry, re-check the current status of an entry and prepare suitable Jomiy options.',
    dataTitle: 'Data we collect', dataText: 'Your name, phone number, purchase goal, language, form context, selected entry and its verified characteristics, plus technical source information.',
    purposeTitle: 'How we use it', purposeText: 'To contact you, understand your requirements, re-check availability and prepare an up-to-date selection.',
    revokeTitle: 'How to withdraw consent', revokeBefore: 'Tell the manager during the call or contact us at', revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.', projectLink: 'JOMIY ↗', catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const regnumPlazaCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — Regnum Plaza',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта Regnum Plaza.',
    back: '← Вернуться в Regnum Plaza',
    catalogBack: '← Вернуться в каталог Regnum Plaza',
    intro: 'Мы используем данные из формы только для ответа на запрос, проверки текущей доступности и подготовки подходящих предложений по Regnum Plaza.',
    dataText: 'Имя, номер телефона, цель покупки, язык, поверхность формы, выбранная квартира и её подтверждённые характеристики, а также технические метки источника перехода.',
    projectLink: 'REGNUM PLAZA ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — Regnum Plaza',
    metadataDescription: 'Regnum Plaza shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← Regnum Plaza sahifasiga qaytish',
    catalogBack: '← Regnum Plaza katalogiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish, joriy mavjudlikni tekshirish va Regnum Plaza bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar', dataText: 'Ism, telefon raqami, xarid maqsadi, til, shakl yuzasi, tanlangan xonadon va uning tasdiqlangan xususiyatlari, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun', purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, mavjudlikni qayta tekshirish va dolzarb tanlov tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin', revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki', revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.', projectLink: 'REGNUM PLAZA ↗', catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — Regnum Plaza',
    metadataDescription: 'Information about processing data submitted through Regnum Plaza forms.',
    back: '← Return to Regnum Plaza',
    catalogBack: '← Return to the Regnum Plaza catalogue',
    eyebrow: 'INFORMATION FOR VISITORS', title: ['Personal data', 'processing.'],
    intro: 'We use submitted information only to respond to your enquiry, re-check current availability and prepare suitable Regnum Plaza options.',
    dataTitle: 'Data we collect', dataText: 'Your name, phone number, purchase goal, language, form surface, selected apartment and verified characteristics, plus technical source information.',
    purposeTitle: 'How we use it', purposeText: 'To contact you, understand your requirements, re-check availability and prepare an up-to-date selection.',
    revokeTitle: 'How to withdraw consent', revokeBefore: 'Tell the manager during the call or contact us at', revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.', projectLink: 'REGNUM PLAZA ↗', catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const sunCopy: Record<Language, PrivacyCopy> = {
  ru: {
    ...legacyCopy,
    metadataTitle: 'Обработка персональных данных — SUN',
    metadataDescription: 'Информация об обработке данных, отправленных через формы проекта SUN.',
    back: '← Вернуться в SUN',
    catalogBack: '← Вернуться в каталог SUN',
    intro: 'Мы используем данные из формы только для ответа на запрос, проверки текущей доступности и подготовки подходящих предложений по проекту SUN.',
    dataText: 'Имя, номер телефона, цель покупки, язык, поверхность формы, выбранная квартира и её подтверждённые характеристики, а также технические метки источника перехода.',
    projectLink: 'SUN ↗',
    catalogLink: 'КАТАЛОГ КВАРТИР ↗',
  },
  uz: {
    metadataTitle: 'Shaxsiy ma’lumotlarni qayta ishlash — SUN',
    metadataDescription: 'SUN loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.',
    back: '← SUN sahifasiga qaytish',
    catalogBack: '← SUN katalogiga qaytish',
    eyebrow: 'TASHRIF BUYURUVCHILAR UCHUN MA’LUMOT',
    title: ['Shaxsiy ma’lumotlarni', 'qayta ishlash.'],
    intro: 'Shakldagi ma’lumotlardan faqat so‘rovingizga javob berish, joriy mavjudlikni tekshirish va SUN bo‘yicha mos takliflarni tayyorlash uchun foydalanamiz.',
    dataTitle: 'Qanday ma’lumotlar',
    dataText: 'Ism, telefon raqami, xarid maqsadi, til, shakl yuzasi, tanlangan xonadon va uning tasdiqlangan xususiyatlari, shuningdek o‘tish manbasining texnik belgilari.',
    purposeTitle: 'Nima uchun',
    purposeText: 'Siz bilan bog‘lanish, istaklaringizni aniqlash, mavjudlikni qayta tekshirish va dolzarb tanlov tayyorlash uchun.',
    revokeTitle: 'Rozilikni qanday qaytarib olish mumkin',
    revokeBefore: 'Qo‘ng‘iroq vaqtida menejerga xabar bering yoki',
    revokeAfter: ' raqamiga murojaat qiling.',
    warning: 'Shaklda pasport, bank va boshqa maxfiy ma’lumotlarni yubormang.',
    projectLink: 'SUN ↗',
    catalogLink: 'XONADONLAR KATALOGI ↗',
  },
  en: {
    metadataTitle: 'Personal data processing — SUN',
    metadataDescription: 'Information about processing data submitted through the SUN project forms.',
    back: '← Return to SUN',
    catalogBack: '← Return to the SUN catalogue',
    eyebrow: 'INFORMATION FOR VISITORS',
    title: ['Personal data', 'processing.'],
    intro: 'We use submitted information only to respond to your enquiry, re-check current availability and prepare suitable SUN options.',
    dataTitle: 'Data we collect',
    dataText: 'Your name, phone number, purchase goal, language, form surface, selected apartment and verified characteristics, plus technical source information.',
    purposeTitle: 'How we use it',
    purposeText: 'To contact you, understand your requirements, re-check availability and prepare an up-to-date selection.',
    revokeTitle: 'How to withdraw consent',
    revokeBefore: 'Tell the manager during the call or contact us at',
    revokeAfter: '.',
    warning: 'Do not submit passport, banking or other sensitive information through the form.',
    projectLink: 'SUN ↗',
    catalogLink: 'APARTMENT CATALOGUE ↗',
  },
};

const legacyProjects: Record<string, { name: string; path: string; image: string; phoneHref: string; phoneLabel: string }> = {
  'avalon-residence': { name: 'AVALON RESIDENCE', path: '/avalon', image: '/avalon/avalon-city.webp', phoneHref: 'tel:+998781137712', phoneLabel: '+998 78 113 77 12' },
  mirador: { name: 'MIRADOR', path: '/mirador', image: '/kayan/mirador/hero.webp', phoneHref: 'tel:+998785552020', phoneLabel: '+998 78 555 20 20' },
  ofiyat: { name: 'OFIYAT', path: '/ofiyat', image: '/kayan/ofiyat/hero.webp', phoneHref: 'tel:+998785552020', phoneLabel: '+998 78 555 20 20' },
  meros: { name: 'MEROS', path: '/meros', image: '/meros/hero.webp', phoneHref: 'tel:+998785552020', phoneLabel: '+998 78 555 20 20' },
  sado: { name: 'SAD’O', path: '/sado', image: '/sado/images/hero.webp', phoneHref: 'tel:1360', phoneLabel: '1360' },
  flagman: { name: 'FLAGMAN', path: '/flagman', image: '/flagman/images/hero.webp', phoneHref: 'tel:1360', phoneLabel: '1360' },
  '4u': { name: '4U TASHKENT', path: '/4u', image: '/4u/images/hero.webp', phoneHref: 'tel:1360', phoneLabel: '1360' },
  voha: { name: 'VOHA', path: '/voha', image: '/voha/images/hero.webp', phoneHref: 'tel:1360', phoneLabel: '1360' },
};

function legacyProjectCopy(project: (typeof legacyProjects)[string], language: Language): PrivacyCopy {
  const base = language === 'ru' ? legacyCopy : maftunCopy[language];
  return {
    ...base,
    metadataTitle: language === 'ru' ? `Обработка персональных данных — ${project.name}` : language === 'uz' ? `Shaxsiy ma’lumotlarni qayta ishlash — ${project.name}` : `Personal data processing — ${project.name}`,
    metadataDescription: language === 'ru' ? `Информация об обработке данных, отправленных через формы проекта ${project.name}.` : language === 'uz' ? `${project.name} loyihasi shakllari orqali yuborilgan ma’lumotlarni qayta ishlash haqida ma’lumot.` : `Information about processing data submitted through the ${project.name} project forms.`,
    back: language === 'ru' ? `← Вернуться в ${project.name}` : language === 'uz' ? `← ${project.name} sahifasiga qaytish` : `← Return to ${project.name}`,
    catalogBack: language === 'ru' ? `← Вернуться в каталог ${project.name}` : language === 'uz' ? `← ${project.name} katalogiga qaytish` : `← Return to the ${project.name} catalogue`,
    projectLink: `${project.name} ↗`,
    catalogLink: project.path === '/' ? undefined : language === 'ru' ? 'КАТАЛОГ КВАРТИР ↗' : language === 'uz' ? 'XONADONLAR KATALOGI ↗' : 'APARTMENT CATALOGUE ↗',
  };
}

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const project = params?.project;
  const legacyProject = project ? legacyProjects[project] : undefined;
  const isZamon = project === 'zamon';
  const isYangiBaxt = project === 'yangibaxt';
  const isJomiy = project === 'jomiy';
  const isRegnumPlaza = project === 'regnum-plaza';
  const isSun = project === 'sun';
  if (project !== 'maftun-makon' && project !== 'botanika-saroyi' && project !== 'bayterak' && !isZamon && !isYangiBaxt && !isJomiy && !isRegnumPlaza && !isSun && !legacyProject) {
    return { title: legacyCopy.metadataTitle, description: legacyCopy.metadataDescription };
  }

  const language = getLanguage(params?.lang);
  const current = legacyProject ? legacyProjectCopy(legacyProject, language) : isSun ? sunCopy[language] : isRegnumPlaza ? regnumPlazaCopy[language] : isJomiy ? jomiyCopy[language] : isYangiBaxt ? yangiBaxtCopy[language] : isZamon ? zamonCopy[language] : project === 'botanika-saroyi' ? botanikaCopy[language] : project === 'bayterak' ? bayterakCopy[language] : maftunCopy[language];
  const privacyUrl = (nextLanguage: Language) => isYangiBaxt
    ? `${appBasePath}/privacy?project=yangibaxt&lang=${nextLanguage}`
    : isJomiy || isRegnumPlaza || isSun || legacyProject
      ? `${appBasePath}/privacy?project=${project}&lang=${nextLanguage}`
      : `${appBasePath}/privacy?lang=${nextLanguage}&project=${project}`;
  const canonical = privacyUrl(language);
  const metadata: Metadata = {
    title: current.metadataTitle,
    description: current.metadataDescription,
    alternates: {
      canonical,
      languages: {
        'ru-RU': privacyUrl('ru'),
        'uz-UZ': privacyUrl('uz'),
        en: privacyUrl('en'),
        'x-default': privacyUrl('ru'),
      },
    },
  };

  if (project === 'botanika-saroyi' || project === 'bayterak' || isZamon || isYangiBaxt || isJomiy || isRegnumPlaza || isSun || legacyProject) {
    const image = legacyProject
      ? `${appBasePath}${legacyProject.image}`
      : isSun
      ? `${appBasePath}/sun/images/overview.webp`
      : isRegnumPlaza
      ? `${appBasePath}/regnum-plaza/images/hero.webp`
      : isJomiy
      ? `${appBasePath}/jomiy/images/hero-real.webp`
      : isYangiBaxt
      ? `${appBasePath}/yangibaxt/images/hero-real.webp`
      : isZamon
      ? `${appBasePath}/zamon/images/hero-phase-one.webp`
      : project === 'bayterak'
      ? `${appBasePath}/bayterak/images/hero-comfort.webp`
      : `${appBasePath}/botanika-saroyi/images/hero.webp`;
    metadata.openGraph = {
      title: current.metadataTitle,
      description: current.metadataDescription,
      images: [image],
      locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US',
      type: 'website',
      url: canonical,
    };
    metadata.twitter = {
      card: 'summary_large_image',
      title: current.metadataTitle,
      description: current.metadataDescription,
      images: [image],
    };
  }

  return metadata;
}

export default async function PrivacyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const legacyProject = params?.project ? legacyProjects[params.project] : undefined;
  const isMaftun = params?.project === 'maftun-makon';
  const isBotanika = params?.project === 'botanika-saroyi';
  const isBayterak = params?.project === 'bayterak';
  const isZamon = params?.project === 'zamon';
  const isYangiBaxt = params?.project === 'yangibaxt';
  const isJomiy = params?.project === 'jomiy';
  const isRegnumPlaza = params?.project === 'regnum-plaza';
  const isSun = params?.project === 'sun';
  const isLocalizedProject = isMaftun || isBotanika || isBayterak || isZamon || isYangiBaxt || isJomiy || isRegnumPlaza || isSun || Boolean(legacyProject);
  const language = isLocalizedProject ? getLanguage(params?.lang) : 'ru';
  const current = legacyProject ? legacyProjectCopy(legacyProject, language) : isSun ? sunCopy[language] : isRegnumPlaza ? regnumPlazaCopy[language] : isJomiy ? jomiyCopy[language] : isYangiBaxt ? yangiBaxtCopy[language] : isZamon ? zamonCopy[language] : isBotanika ? botanikaCopy[language] : isBayterak ? bayterakCopy[language] : isMaftun ? maftunCopy[language] : legacyCopy;
  const projectPath = legacyProject ? `${legacyProject.path}?lang=${language}` : isSun ? `/sun?lang=${language}` : isRegnumPlaza ? `/regnum-plaza?lang=${language}` : isJomiy ? `/jomiy?lang=${language}` : isYangiBaxt ? `/yangibaxt?lang=${language}` : isZamon ? `/zamon?lang=${language}` : isBotanika ? `/botanika-saroyi?lang=${language}` : isBayterak ? `/bayterak?lang=${language}` : isMaftun ? `/maftun-makon?lang=${language}` : '/mirador';
  // next/link applies next.config.basePath; pass an app-relative href so the configured prefix is added exactly once.
  const projectUrl = nextLinkHref(`${appBasePath}${projectPath}`);
  const catalogUrl = legacyProject
    ? legacyProject.path === '/' ? null : nextLinkHref(`${appBasePath}${legacyProject.path}/apartments?lang=${language}`)
    : isSun
    ? nextLinkHref(`${appBasePath}/sun/apartments?lang=${language}`)
    : isRegnumPlaza
    ? nextLinkHref(`${appBasePath}/regnum-plaza/apartments?lang=${language}`)
    : isJomiy
    ? nextLinkHref(`${appBasePath}/jomiy/apartments?lang=${language}`)
    : isYangiBaxt
    ? nextLinkHref(`${appBasePath}/yangibaxt/apartments?lang=${language}`)
    : isZamon
    ? nextLinkHref(`${appBasePath}/zamon/apartments?lang=${language}`)
    : isBotanika
    ? nextLinkHref(`${appBasePath}/botanika-saroyi/apartments?lang=${language}`)
    : isBayterak
      ? nextLinkHref(`${appBasePath}/bayterak/apartments?lang=${language}`)
      : null;
  const fromCatalog = (isYangiBaxt || isJomiy || isRegnumPlaza || isSun || Boolean(legacyProject)) && params?.from === 'catalog';
  const returnUrl = fromCatalog && catalogUrl ? catalogUrl : projectUrl;
  const back = fromCatalog && current.catalogBack ? current.catalogBack : current.back;
  const usesShortPhone = isZamon || isYangiBaxt || isJomiy;
  const contactHref = legacyProject ? legacyProject.phoneHref : isSun ? 'tel:+998781505500' : isRegnumPlaza ? 'tel:+998781228822' : usesShortPhone ? 'tel:1360' : 'tel:+998785552020';
  const contactLabel = legacyProject ? legacyProject.phoneLabel : isSun ? '+998 78 150 55 00' : isRegnumPlaza ? '+998 78 122 88 22' : usesShortPhone ? '1360' : '+998 78 555 20 20';

  return <main className="privacy-page" lang={language}>
    <PrivacyLanguageSync language={language} />
    <Link className="privacy-page__back" href={returnUrl}>{back}</Link>
    <header><small>{current.eyebrow}</small><h1>{current.title[0]}<br />{current.title[1]}</h1><p>{current.intro}</p></header>
    <section>
      <article><span>01</span><h2>{current.dataTitle}</h2><p>{current.dataText}</p></article>
      <article><span>02</span><h2>{current.purposeTitle}</h2><p>{current.purposeText}</p></article>
      <article><span>03</span><h2>{current.revokeTitle}</h2><p>{current.revokeBefore} <a href={contactHref}>{contactLabel}</a>{current.revokeAfter}</p></article>
    </section>
    <footer>
      <p>{current.warning}</p>
      <Link href={projectUrl}>{current.projectLink}</Link>
      {catalogUrl && current.catalogLink ? <Link href={catalogUrl}>{current.catalogLink}</Link> : null}
    </footer>
  </main>;
}
