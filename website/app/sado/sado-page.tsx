'use client';

/* eslint-disable @next/next/no-img-element */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type LightboxState = { images: Array<{ src: string; alt: string }>; index: number } | null;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const bookletUrl = 'https://s3.bi.group/biclick/content-manager/Sad_O_buklet_compressed_2_88c7f6fe2a.pdf';
const panoramaUrl = 'https://360.bi-group.org/2021/tashkent/index.html#pano668067/13.6/28.3/90.0';

const copy = {
  ru: {
    nav: [['about', 'О проекте'], ['architecture', 'Архитектура'], ['garden', 'Сад'], ['courtyard', 'Двор'], ['location', 'Локация'], ['progress', 'Строительство']],
    menu: 'Меню', close: 'Закрыть', choose: 'Выбрать квартиру', consult: 'Получить консультацию', language: 'Язык', explore: 'Исследовать проект',
    heroEyebrow: 'SAD’O · ЯШНАБАД · ТАШКЕНТ', heroTitle: 'Слушайте', heroAccent: 'сердцем.',
    heroCopy: 'Тихий сад внутри большого города — пространство, где архитектура, свет и природа возвращают внутреннее равновесие.',
    heroMeta: ['Business & Comfort', 'Потолки 3–3,3 м', 'Площади 37–118 м²'],
    ideaKicker: '01 · ИДЕЯ', ideaTitle: 'Город звучит тише,', ideaAccent: 'когда дом настроен на вас.',
    ideaCopy: 'Sad’O создаёт спокойную среду в ритме Ташкента: прогулочные аллеи, зелёные зоны и места для отдыха собраны вокруг повседневных сценариев семьи.',
    ideaAside: 'Не менее 40% территории занимает озеленение. Закрытый двор освобождён от автомобилей, а активные и тихие зоны разведены так, чтобы не мешать друг другу.',
    facts: [['40%+', 'территории — озеленение'], ['3–3,3 м', 'высота потолков'], ['37–118 м²', 'диапазон на лендинге проекта'], ['Business / Comfort', 'два класса жилья']],
    architectureKicker: '02 · АРХИТЕКТУРА', architectureTitle: 'Честные материалы.', architectureAccent: 'Спокойный ритм фасада.',
    architectureCopy: 'Конструкция и отделка сформулированы точно по официальному источнику — без декоративных обещаний.',
    architectureFeatures: [
      ['Каркас', 'Монолитный железобетон.'],
      ['Окна', 'Металлопластиковые, четырёхкамерный профиль.'],
      ['Фасад', 'Декоративные алюминиевые композитные панели и клинкерная плитка.'],
      ['Стены', 'Межквартирные стены из керамического кирпича толщиной 250 мм.'],
    ],
    gardenKicker: '03 · 40% САДА', gardenTitle: 'Ландшафт, который', gardenAccent: 'меняется вместе с сезоном.',
    gardenCopy: 'В проекте сочетаются лиственные и хвойные деревья, декоративные кустарники, многолетники и газон. В официальной палитре — магнолии, платан, сирень, сосна, можжевельник, гортензия, лаванда и шалфей.',
    gardenNames: ['Магнолия', 'Платан', 'Горная сосна', 'Лаванда', 'Гортензия'],
    courtyardKicker: '04 · СЦЕНАРИИ ДНЯ', courtyardTitle: 'Один двор.', courtyardAccent: 'Три способа прожить день.',
    courtyardTabs: ['Утро', 'День', 'Вечер'],
    courtyardStories: [
      ['Медленное утро', 'Прогулочные дорожки, зелень и места для короткой паузы до начала городского дня.'],
      ['Время вместе', 'Детские площадки, BBQ, крытая fitness-комната и пикниковая зона дают семье разные занятия рядом.'],
      ['Камерный вечер', 'Амфитеатр становится местом для встреч и спокойных событий под открытым небом.'],
    ],
    hallKicker: '05 · ДИЗАЙНЕРСКИЕ ХОЛЛЫ', hallTitle: 'Природная палитра', hallAccent: 'продолжается внутри.',
    hallCopy: 'Оттенки дерева, камня и земли, мягкие зоны ожидания, бесшумные лифты и сквозные входы создают спокойное первое впечатление.',
    hallItems: ['Мягкая зона ожидания', 'Бесшумные лифты', 'Сквозные входы', 'Колясочные'],
    functionKicker: '06 · ФУНКЦИЯ', functionTitle: 'Всё нужное', functionAccent: 'остаётся на своём месте.',
    functionItems: [
      ['Паркинг', 'Подземные места для Business и наземные — для Comfort.'],
      ['Boxroom', 'Кладовые помещения площадью 3 м².'],
      ['Велохранение', 'Специальные места для безопасного хранения велосипедов.'],
      ['Электромобили', 'На территории предусмотрено зарядное оборудование.'],
    ],
    locationKicker: '07 · ЛОКАЦИЯ', locationTitle: 'Яшнабад.', locationAccent: 'Между сложившимся и новым городом.',
    locationCopy: 'Комплекс расположен на улице Паркентской. Официальные материалы описывают локацию на пересечении направлений Паркент и Янги Узбекистон.',
    nearby: ['Парк «Янги Узбекистон»', 'Национальный детский медицинский центр', 'ST Golf Academy', 'Станция метро «Яшнабад»'],
    booklet: 'Скачать буклет',
    progressKicker: '08 · ХОД СТРОИТЕЛЬСТВА', progressTitle: 'Реальный прогресс.', progressAccent: 'Июль 2026.',
    progressCopy: 'Business 2-1: фасад, чистовая отделка, электромонтаж, котлован паркинга и инженерные системы. Comfort 2-1: монолит в блоках 1 и 2 на уровне пятого этажа и кладка на втором.',
    panorama: 'Панорама 360°', camera: 'Онлайн-камера', cameraUnavailable: 'Поток временно недоступен · проверено 30.08.2026',
    catalogKicker: '09 · ВЫБОР КВАРТИРЫ', catalogTitle: 'Найдите свой', catalogAccent: 'тихий ритм.',
    catalogCopy: (count: number) => `${count} предложений из официального каталога: реальные планировки, площади, этажи и цены.`, catalogButton: 'Открыть каталог',
    formKicker: 'ПЕРСОНАЛЬНАЯ КОНСУЛЬТАЦИЯ', formTitle: 'Расскажите,', formAccent: 'что важно именно вам.',
    formCopy: 'Менеджер проекта уточнит ваш сценарий и подготовит актуальные варианты Sad’O.', name: 'Ваше имя', namePlaceholder: 'Как к вам обращаться', phone: 'Телефон', submit: 'Получить подборку', pending: 'Отправляем…', success: 'Спасибо. Заявка принята — менеджер проекта свяжется с вами.', nameError: 'Введите имя — не менее 2 символов.', phoneError: 'Введите 9 цифр после +998.', sendError: 'Не удалось отправить заявку. Попробуйте ещё раз.', privacy: 'Нажимая кнопку, вы соглашаетесь на обработку персональных данных.',
    footerNote: 'Информация не является публичной офертой. Наличие, стоимость и условия покупки уточняйте у менеджера.', privacyLink: 'Конфиденциальность',
    galleryOpen: 'Открыть фотографию', previous: 'Предыдущее изображение', next: 'Следующее изображение', checked: 'Snapshot каталога',
  },
  uz: {
    nav: [['about', 'Loyiha'], ['architecture', 'Arxitektura'], ['garden', 'Bog‘'], ['courtyard', 'Hovli'], ['location', 'Joylashuv'], ['progress', 'Qurilish']],
    menu: 'Menyu', close: 'Yopish', choose: 'Xonadon tanlash', consult: 'Maslahat olish', language: 'Til', explore: 'Loyihani ko‘rish',
    heroEyebrow: 'SAD’O · YASHNOBOD · TOSHKENT', heroTitle: 'Qalbingiz bilan', heroAccent: 'tinglang.', heroCopy: 'Katta shahar ichidagi sokin bog‘ — arxitektura, yorug‘lik va tabiat ichki muvozanatni qaytaradigan makon.', heroMeta: ['Business & Comfort', 'Shiftlar 3–3,3 m', 'Maydon 37–118 m²'],
    ideaKicker: '01 · G‘OYA', ideaTitle: 'Uy sizga moslansa,', ideaAccent: 'shahar sokinroq eshitiladi.', ideaCopy: 'Sad’O Toshkent ritmida osoyishta muhit yaratadi: sayr yo‘laklari, yashil hududlar va dam olish joylari oilaning kundalik hayoti atrofida jamlangan.', ideaAside: 'Hududning kamida 40 foizi ko‘kalamzor. Yopiq hovli avtomobillardan xoli, faol va sokin zonalar esa bir-biriga xalaqit bermaydi.', facts: [['40%+', 'hudud — ko‘kalamzor'], ['3–3,3 m', 'shift balandligi'], ['37–118 m²', 'loyiha lentasidagi diapazon'], ['Business / Comfort', 'ikki uy-joy klassi']],
    architectureKicker: '02 · ARXITEKTURA', architectureTitle: 'Halol materiallar.', architectureAccent: 'Fasadning sokin ritmi.', architectureCopy: 'Konstruksiya va pardoz rasmiy manbadagi aniq ifodalar bilan berildi.', architectureFeatures: [['Karkas', 'Monolit temir-beton.'], ['Derazalar', 'Metall-plastik, to‘rt kamerali profil.'], ['Fasad', 'Dekorativ alyuminiy kompozit panellar va klinker plitka.'], ['Devorlar', 'Xonadonlararo 250 mm keramik g‘isht devorlar.']],
    gardenKicker: '03 · 40% BOG‘', gardenTitle: 'Fasllar bilan', gardenAccent: 'birga o‘zgaradigan landshaft.', gardenCopy: 'Loyihada bargli va ignabargli daraxtlar, butalar, ko‘p yillik gullar va maysazor uyg‘unlashadi. Rasmiy palitrada magnoliya, chinor, qarag‘ay, archa, gortenziya, lavanda va shalfey bor.', gardenNames: ['Magnoliya', 'Chinor', 'Tog‘ qarag‘ayi', 'Lavanda', 'Gortenziya'],
    courtyardKicker: '04 · KUN SSENARIYLARI', courtyardTitle: 'Bitta hovli.', courtyardAccent: 'Kunni uch xil yashash.', courtyardTabs: ['Tong', 'Kun', 'Oqshom'], courtyardStories: [['Sokin tong', 'Shahar kuni boshlanishidan avval sayr yo‘laklari va yashillik orasidagi qisqa tanaffus.'], ['Birga o‘tadigan vaqt', 'Bolalar maydoni, BBQ, yopiq fitness xonasi va piknik zonasi oilani yaqin tutadi.'], ['Kamer oqshom', 'Amfiteatr ochiq osmon ostidagi uchrashuvlar va sokin tadbirlar joyiga aylanadi.']],
    hallKicker: '05 · DIZAYNERLIK XOLLARI', hallTitle: 'Tabiiy palitra', hallAccent: 'ichkarida davom etadi.', hallCopy: 'Yog‘och, tosh va yer ranglari, yumshoq kutish joylari, shovqinsiz liftlar va ikki tomonlama kirishlar sokin taassurot yaratadi.', hallItems: ['Yumshoq kutish joyi', 'Shovqinsiz liftlar', 'Ikki tomonlama kirish', 'Aravachalar xonasi'],
    functionKicker: '06 · FUNKSIYA', functionTitle: 'Kerakli narsalar', functionAccent: 'o‘z joyida qoladi.', functionItems: [['Parking', 'Business uchun yer osti, Comfort uchun yer usti joylar.'], ['Boxroom', '3 m² ombor xonalari.'], ['Velosaqlash', 'Velosipedlar uchun maxsus xavfsiz joylar.'], ['Elektromobillar', 'Hududda quvvatlash uskunasi ko‘zda tutilgan.']],
    locationKicker: '07 · JOYLASHUV', locationTitle: 'Yashnobod.', locationAccent: 'Mavjud va yangi shahar orasida.', locationCopy: 'Majmua Parkent ko‘chasida joylashgan. Rasmiy materiallarda Parkent va Yangi O‘zbekiston yo‘nalishlari kesishmasi sifatida tasvirlanadi.', nearby: ['“Yangi O‘zbekiston” bog‘i', 'Milliy bolalar tibbiyot markazi', 'ST Golf Academy', '“Yashnobod” metro bekati'], booklet: 'Bukletni yuklash',
    progressKicker: '08 · QURILISH JARAYONI', progressTitle: 'Haqiqiy taraqqiyot.', progressAccent: '2026-yil iyul.', progressCopy: 'Business 2-1: fasad, toza pardoz, elektr montaj, parking kotlovani va muhandislik tizimlari. Comfort 2-1: 1 va 2 bloklarda beshinchi qavat darajasida monolit, ikkinchi qavatda g‘isht terish.', panorama: '360° panorama', camera: 'Onlayn kamera', cameraUnavailable: 'Oqim vaqtincha ishlamayapti · 30.08.2026 tekshirildi',
    catalogKicker: '09 · XONADON TANLASH', catalogTitle: 'O‘z sokin', catalogAccent: 'ritmingizni toping.', catalogCopy: (count: number) => `Rasmiy katalogdan ${count} ta taklif: haqiqiy rejalar, maydonlar, qavatlar va narxlar.`, catalogButton: 'Katalogni ochish',
    formKicker: 'SHAXSIY MASLAHAT', formTitle: 'Siz uchun', formAccent: 'nima muhimligini ayting.', formCopy: 'Loyiha menejeri istaklaringizni aniqlab, Sad’O bo‘yicha dolzarb variantlarni tayyorlaydi.', name: 'Ismingiz', namePlaceholder: 'Sizga qanday murojaat qilamiz', phone: 'Telefon', submit: 'Variantlarni olish', pending: 'Yuborilmoqda…', success: 'Rahmat. Ariza qabul qilindi — loyiha menejeri siz bilan bog‘lanadi.', nameError: 'Ismingizni kiriting — kamida 2 ta belgi.', phoneError: '+998 dan keyin 9 ta raqam kiriting.', sendError: 'Arizani yuborib bo‘lmadi. Qayta urinib ko‘ring.', privacy: 'Tugmani bosish orqali shaxsiy ma’lumotlarni qayta ishlashga rozilik bildirasiz.', footerNote: 'Ma’lumot ommaviy oferta emas. Mavjudlik, narx va xarid shartlarini menejerdan aniqlang.', privacyLink: 'Maxfiylik', galleryOpen: 'Rasmni ochish', previous: 'Oldingi rasm', next: 'Keyingi rasm', checked: 'Katalog snapshoti',
  },
  en: {
    nav: [['about', 'About'], ['architecture', 'Architecture'], ['garden', 'Garden'], ['courtyard', 'Courtyard'], ['location', 'Location'], ['progress', 'Construction']],
    menu: 'Menu', close: 'Close', choose: 'Choose an apartment', consult: 'Request a consultation', language: 'Language', explore: 'Explore the project',
    heroEyebrow: 'SAD’O · YASHNABAD · TASHKENT', heroTitle: 'Listen with', heroAccent: 'your heart.', heroCopy: 'A quiet garden within the big city — where architecture, light and nature restore a sense of balance.', heroMeta: ['Business & Comfort', '3–3.3 m ceilings', '37–118 m² on the project page'],
    ideaKicker: '01 · THE IDEA', ideaTitle: 'The city sounds quieter', ideaAccent: 'when home is tuned to you.', ideaCopy: 'Sad’O creates a calm setting within Tashkent’s rhythm, bringing walking paths, green spaces and places to pause around daily family life.', ideaAside: 'At least 40% of the territory is landscaped. The private courtyard is car-free, with active and quiet zones arranged so they can coexist.', facts: [['40%+', 'of the grounds landscaped'], ['3–3.3 m', 'ceiling height'], ['37–118 m²', 'range on the project page'], ['Business / Comfort', 'two residential classes']],
    architectureKicker: '02 · ARCHITECTURE', architectureTitle: 'Honest materials.', architectureAccent: 'A calm facade rhythm.', architectureCopy: 'Structure and finish are stated precisely as they appear in the official source.', architectureFeatures: [['Frame', 'Monolithic reinforced concrete.'], ['Windows', 'Metal-plastic, four-chamber profile.'], ['Facade', 'Decorative aluminium composite panels and clinker tile.'], ['Walls', '250 mm ceramic-brick walls between apartments.']],
    gardenKicker: '03 · 40% GARDEN', gardenTitle: 'A landscape that', gardenAccent: 'moves with the seasons.', gardenCopy: 'Deciduous and evergreen trees, ornamental shrubs, flowering perennials and lawn shape the landscape. Magnolia, plane, pine, juniper, hydrangea, lavender and sage are named in the official palette.', gardenNames: ['Magnolia', 'Plane tree', 'Mountain pine', 'Lavender', 'Hydrangea'],
    courtyardKicker: '04 · WAYS THROUGH THE DAY', courtyardTitle: 'One courtyard.', courtyardAccent: 'Three ways to live the day.', courtyardTabs: ['Morning', 'Day', 'Evening'], courtyardStories: [['A slower morning', 'Walking paths, greenery and a quiet pause before the city day begins.'], ['Time together', 'Playgrounds, BBQ, an indoor fitness room and a picnic lawn keep different family activities close.'], ['An intimate evening', 'The amphitheatre becomes a place for gatherings and quiet events beneath the open sky.']],
    hallKicker: '05 · DESIGNED LOBBIES', hallTitle: 'The natural palette', hallAccent: 'continues indoors.', hallCopy: 'Tones of wood, stone and earth, soft waiting areas, quiet lifts and through entrances create a composed first impression.', hallItems: ['Soft waiting area', 'Quiet lifts', 'Through entrances', 'Stroller rooms'],
    functionKicker: '06 · FUNCTION', functionTitle: 'Everything useful', functionAccent: 'has its place.', functionItems: [['Parking', 'Underground spaces for Business and surface parking for Comfort.'], ['Boxroom', 'Storage rooms with an area of 3 m².'], ['Cycle storage', 'Dedicated places for secure bicycle storage.'], ['Electric vehicles', 'Charging equipment is planned within the grounds.']],
    locationKicker: '07 · LOCATION', locationTitle: 'Yashnabad.', locationAccent: 'Between the established and new city.', locationCopy: 'The project is located on Parkent Street. Official materials describe the setting at the intersection of the Parkent and Yangi O‘zbekiston directions.', nearby: ['Yangi O‘zbekiston Park', 'National Children’s Medical Centre', 'ST Golf Academy', 'Yashnabad metro station'], booklet: 'Download the booklet',
    progressKicker: '08 · CONSTRUCTION', progressTitle: 'Visible progress.', progressAccent: 'July 2026.', progressCopy: 'Business 2-1: facade, final finishes, electrical installation, parking excavation and engineering systems. Comfort 2-1: frame works on blocks 1 and 2 at level five and masonry on level two.', panorama: '360° panorama', camera: 'Live camera', cameraUnavailable: 'Stream temporarily unavailable · checked 30 Aug 2026',
    catalogKicker: '09 · APARTMENT SELECTION', catalogTitle: 'Find your', catalogAccent: 'quiet rhythm.', catalogCopy: (count: number) => `${count} official listings with real plans, areas, floors and prices.`, catalogButton: 'Open the catalogue',
    formKicker: 'PERSONAL CONSULTATION', formTitle: 'Tell us', formAccent: 'what matters to you.', formCopy: 'The project manager will clarify your plans and prepare current options at Sad’O.', name: 'Your name', namePlaceholder: 'How should we address you?', phone: 'Phone', submit: 'Get a selection', pending: 'Sending…', success: 'Thank you. Your request has been received and the project manager will contact you.', nameError: 'Enter your name — at least 2 characters.', phoneError: 'Enter 9 digits after +998.', sendError: 'We could not send the request. Please try again.', privacy: 'By clicking the button, you consent to the processing of personal data.', footerNote: 'Information is not a public offer. Confirm availability, price and purchase terms with a project manager.', privacyLink: 'Privacy', galleryOpen: 'Open photograph', previous: 'Previous image', next: 'Next image', checked: 'Catalogue snapshot',
  },
} as const;

const courtyardImages = ['/sado/summer-kitchen.webp', '/sado/playground.webp', '/sado/amphitheatre.webp'];
const hallImages = ['/sado/hall-1.webp', '/sado/hall-2.webp', '/sado/hall-3.webp'];
const constructionImages = ['/sado/construction-1.webp', '/sado/construction-2.webp', '/sado/construction-3.webp'];
const functionImages = ['/sado/parking.webp', '/sado/storage.webp', '/sado/bicycle.webp', '/sado/charging.webp'];

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function leadSubmitUrl() {
  return `${appBasePath}/v1/leads`;
}
function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('998') ? digits.slice(3) : digits;
  return `+998${local}`;
}

function Lightbox({ state, onClose, onMove, labels }: { state: NonNullable<LightboxState>; onClose: () => void; onMove: (step: number) => void; labels: { close: string; previous: string; next: string } }) {
  const touchStart = useRef<number | null>(null);
  return <div className="sado-lightbox" role="dialog" aria-modal="true" aria-label={state.images[state.index].alt} onClick={onClose} onTouchStart={(event) => { touchStart.current = event.changedTouches[0]?.clientX ?? null; }} onTouchEnd={(event) => { if (touchStart.current == null) return; const distance = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current; if (Math.abs(distance) > 48) onMove(distance > 0 ? -1 : 1); touchStart.current = null; }}>
    <button className="sado-lightbox__close" type="button" onClick={onClose} aria-label={labels.close} autoFocus>×</button>
    {state.images.length > 1 ? <button className="sado-lightbox__arrow is-prev" type="button" aria-label={labels.previous} onClick={(event) => { event.stopPropagation(); onMove(-1); }}>←</button> : null}
    <figure onClick={(event) => event.stopPropagation()}><img src={asset(state.images[state.index].src)} alt={state.images[state.index].alt} /><figcaption>{String(state.index + 1).padStart(2, '0')} / {String(state.images.length).padStart(2, '0')}</figcaption></figure>
    {state.images.length > 1 ? <button className="sado-lightbox__arrow is-next" type="button" aria-label={labels.next} onClick={(event) => { event.stopPropagation(); onMove(1); }}>→</button> : null}
  </div>;
}

function SadoInlineForm({ language }: { language: Language }) {
  const t = copy[language];
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const phone = normalizePhone(String(data.get('phone') || ''));
    const consent = data.get('consent') === 'on';
    if (name.length < 2) { setStatus('error'); setMessage(t.nameError); return; }
    if (!/^\+998\d{9}$/.test(phone)) { setStatus('error'); setMessage(t.phoneError); return; }
    if (!consent) { setStatus('error'); setMessage(language === 'ru' ? 'Подтвердите согласие на обработку данных.' : language === 'uz' ? 'Ma’lumotlarni qayta ishlashga rozilikni tasdiqlang.' : 'Confirm your consent to data processing.'); return; }
    setPending(true); setStatus('idle'); setMessage('');
    try {
      const response = await fetch(leadSubmitUrl(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name, phone, goal: 'live', consent, lang: language, language, projectSlug: 'sado', formContext: 'sado:landing:contact', landing_url: window.location.href, referrer_url: document.referrer || undefined }) });
      const body = await response.json().catch(() => null) as { success?: boolean } | null;
      if (!response.ok || body?.success !== true) throw new Error('Submission failed');
      form.reset(); setStatus('success'); setMessage(t.success);
    } catch { setStatus('error'); setMessage(t.sendError); }
    finally { setPending(false); }
  };
  return <form className="sado-contact-form" onSubmit={onSubmit} noValidate>
    <label><span>{t.name}</span><input name="name" autoComplete="name" placeholder={t.namePlaceholder} required /></label>
    <label><span>{t.phone}</span><div className="sado-phone"><b>+998</b><input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="90 000 00 00" required onInput={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/[^0-9 ]/g, '').slice(0, 12); }} /></div></label>
    <button type="submit" disabled={pending}>{pending ? t.pending : t.submit}<span>↗</span></button>
    {message ? <p className={`sado-contact-form__status is-${status}`} role="status">{message}</p> : null}
    <label className="sado-contact-form__consent"><input name="consent" type="checkbox" required /><span>{t.privacy} <a href={`${appBasePath}/privacy?project=sado&lang=${language}`}>{t.privacyLink}</a></span></label>
  </form>;
}

export function SadoPage({ initialAvailable, snapshotGeneratedAt }: { initialAvailable: number; snapshotGeneratedAt: string }) {
  const [language, setLanguageState] = useState<Language>('ru');
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [intro, setIntro] = useState(true);
  const [skipIntro, setSkipIntro] = useState(false);
  const [scenario, setScenario] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const t = copy[language];

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const stored = window.localStorage.getItem('sado-language');
    const next = languages.includes(query as Language) ? query : stored;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seen = window.sessionStorage.getItem('sado-intro-seen-v1') === '1';
    let timer = 0;
    const frame = window.requestAnimationFrame(() => {
      if (languages.includes(next as Language)) setLanguageState(next as Language);
      if (reduced || seen) { setSkipIntro(true); setIntro(false); return; }
      document.body.classList.add('is-sado-intro');
      timer = window.setTimeout(() => { setIntro(false); document.body.classList.remove('is-sado-intro'); window.sessionStorage.setItem('sado-intro-seen-v1', '1'); }, 2200);
    });
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); document.body.classList.remove('is-sado-intro'); };
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    document.body.classList.toggle('is-sado-menu-open', menuOpen);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (lightbox) setLightbox(null); else if (menuOpen) setMenuOpen(false); } if (lightbox && event.key === 'ArrowRight') setLightbox((current) => current ? ({ ...current, index: (current.index + 1) % current.images.length }) : null); if (lightbox && event.key === 'ArrowLeft') setLightbox((current) => current ? ({ ...current, index: (current.index - 1 + current.images.length) % current.images.length }) : null); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('is-sado-menu-open'); window.removeEventListener('keydown', onKey); };
  }, [menuOpen, lightbox]);

  const setLanguage = (next: Language) => {
    setLanguageState(next); window.localStorage.setItem('sado-language', next);
    const url = new URL(window.location.href); url.searchParams.set('lang', next); window.history.replaceState({}, '', url);
  };
  const gallery = (paths: string[], label: string) => paths.map((src, index) => ({ src, alt: `${label} · ${index + 1}` }));
  const openGallery = (paths: string[], index: number, label: string) => setLightbox({ images: gallery(paths, label), index });
  const moveLightbox = (step: number) => setLightbox((current) => current ? ({ ...current, index: (current.index + step + current.images.length) % current.images.length }) : null);
  const formattedSnapshot = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Tashkent' }).format(new Date(snapshotGeneratedAt));

  return <main className="sado-site">
    <div className={`sado-intro ${intro ? 'is-visible' : ''} ${skipIntro ? 'is-skip' : ''}`} aria-hidden={!intro}><div className="sado-intro__line" /><span>SAD’O</span><small>{t.heroAccent}</small></div>
    <header className="sado-header">
      <a className="sado-logo" href={withLanguage('/sado', language)} aria-label="Sad'O"><span>SAD</span><i>’</i><span>O</span></a>
      <nav aria-label="Sad'O">{t.nav.map(([id, label]) => <a key={id} href={`${withLanguage('/sado', language)}#${id}`}>{label}</a>)}</nav>
      <div className="sado-header__actions"><div className="sado-language" aria-label={t.language}>{languages.map((item) => <button key={item} className={item === language ? 'is-active' : ''} type="button" onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><a className="sado-header__choose" href={withLanguage('/sado/apartments', language)}>{t.choose}</a><button className="sado-menu-button" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="sado-menu"><span /><span /><em>{t.menu}</em></button></div>
    </header>
    <div id="sado-menu" className={`sado-menu ${menuOpen ? 'is-open' : ''}`} aria-hidden={!menuOpen} inert={!menuOpen ? true : undefined}>
      <button className="sado-menu__close" type="button" onClick={() => setMenuOpen(false)} aria-label={t.close}>×</button>
      <div className="sado-menu__brand">SAD’O<small>{t.heroEyebrow}</small></div>
      <nav>{t.nav.map(([id, label], index) => <a key={id} href={`${withLanguage('/sado', language)}#${id}`} onClick={() => setMenuOpen(false)}><small>0{index + 1}</small>{label}<span>↘</span></a>)}</nav>
      <a className="sado-menu__catalog" href={withLanguage('/sado/apartments', language)}>{t.choose}<span>→</span></a>
    </div>

    <section className="sado-hero" aria-labelledby="sado-title">
      <picture><source media="(max-width: 640px)" srcSet={asset('/sado/hero-mobile.webp')} /><img src={asset('/sado/hero.webp')} alt="Sad'O" fetchPriority="high" /></picture><div className="sado-hero__veil" />
      <div className="sado-hero__content"><p className="sado-kicker">{t.heroEyebrow}</p><h1 id="sado-title">{t.heroTitle}<em>{t.heroAccent}</em></h1><p className="sado-hero__copy">{t.heroCopy}</p><div className="sado-hero__buttons"><a className="sado-button is-light" href={withLanguage('/sado/apartments', language)}>{t.choose}<span>↗</span></a><button className="sado-button is-ghost" type="button" onClick={() => setLeadOpen(true)}>{t.consult}</button></div></div>
      <div className="sado-hero__meta">{t.heroMeta.map((item) => <span key={item}>{item}</span>)}</div><a className="sado-hero__scroll" href="#about"><i>↓</i>{t.explore}</a>
    </section>

    <section id="about" className="sado-section sado-idea"><div className="sado-section__head"><p className="sado-kicker is-dark">{t.ideaKicker}</p><h2>{t.ideaTitle}<em>{t.ideaAccent}</em></h2></div><div className="sado-idea__copy"><p>{t.ideaCopy}</p><aside>{t.ideaAside}</aside></div><div className="sado-facts">{t.facts.map(([value, label]) => <div key={value}><strong>{value}</strong><span>{label}</span></div>)}</div><div className="sado-idea__image"><img src={asset('/sado/courtyard-wide.webp')} alt="Sad'O" loading="lazy" /><span>SAD’O · A QUIET GARDEN</span></div></section>

    <section id="architecture" className="sado-section sado-architecture"><div className="sado-section__head is-light"><p className="sado-kicker">{t.architectureKicker}</p><h2>{t.architectureTitle}<em>{t.architectureAccent}</em></h2><p>{t.architectureCopy}</p></div><div className="sado-architecture__layout"><button className="sado-organic-image" type="button" onClick={() => openGallery(['/sado/architecture.webp', '/sado/terrace.webp'], 0, t.architectureTitle)} aria-label={`${t.galleryOpen}: ${t.architectureTitle}`}><img src={asset('/sado/architecture.webp')} alt="Sad'O" loading="lazy" /><span>↗</span></button><ol>{t.architectureFeatures.map(([title, description], index) => <li key={title}><small>0{index + 1}</small><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol></div></section>

    <section id="garden" className="sado-section sado-garden"><div className="sado-botanical" aria-hidden="true"><i /><i /><i /><i /></div><div className="sado-garden__number">40<sup>%</sup></div><div className="sado-garden__content"><p className="sado-kicker is-dark">{t.gardenKicker}</p><h2>{t.gardenTitle}<em>{t.gardenAccent}</em></h2><p>{t.gardenCopy}</p><ul>{t.gardenNames.map((name) => <li key={name}>{name}</li>)}</ul></div><div className="sado-garden__gallery">{['/sado/landscape-1.webp', '/sado/landscape-2.webp', '/sado/landscape-3.webp'].map((src, index) => <button key={src} type="button" onClick={() => openGallery(['/sado/landscape-1.webp', '/sado/landscape-2.webp', '/sado/landscape-3.webp'], index, t.gardenTitle)} aria-label={`${t.galleryOpen}: ${index + 1}`}><img src={asset(src)} alt="Sad'O" loading="lazy" /></button>)}</div></section>

    <section id="courtyard" className="sado-section sado-courtyard"><div className="sado-section__head"><p className="sado-kicker is-dark">{t.courtyardKicker}</p><h2>{t.courtyardTitle}<em>{t.courtyardAccent}</em></h2></div><div className="sado-courtyard__stage"><button className="sado-courtyard__image" type="button" onClick={() => openGallery(courtyardImages, scenario, t.courtyardTitle)} aria-label={`${t.galleryOpen}: ${t.courtyardTabs[scenario]}`}><img key={courtyardImages[scenario]} src={asset(courtyardImages[scenario])} alt={t.courtyardTabs[scenario]} loading="lazy" /><span>0{scenario + 1} / 03</span></button><div className="sado-courtyard__panel"><div className="sado-tabs" role="tablist">{t.courtyardTabs.map((label, index) => <button key={label} type="button" role="tab" aria-selected={scenario === index} className={scenario === index ? 'is-active' : ''} onClick={() => setScenario(index)}>{label}</button>)}</div><h3>{t.courtyardStories[scenario][0]}</h3><p>{t.courtyardStories[scenario][1]}</p><div className="sado-courtyard__arrows"><button type="button" aria-label={t.previous} onClick={() => setScenario((scenario + 2) % 3)}>←</button><button type="button" aria-label={t.next} onClick={() => setScenario((scenario + 1) % 3)}>→</button></div></div></div></section>

    <section className="sado-section sado-halls"><div className="sado-section__head is-light"><p className="sado-kicker">{t.hallKicker}</p><h2>{t.hallTitle}<em>{t.hallAccent}</em></h2><p>{t.hallCopy}</p></div><div className="sado-halls__gallery">{hallImages.map((src, index) => <button key={src} type="button" className={index === 0 ? 'is-large' : ''} onClick={() => openGallery(hallImages, index, t.hallTitle)} aria-label={`${t.galleryOpen}: ${index + 1}`}><img src={asset(src)} alt="Sad'O" loading="lazy" /><span>0{index + 1}</span></button>)}</div><ul>{t.hallItems.map((item) => <li key={item}>{item}</li>)}</ul></section>

    <section className="sado-section sado-function"><div className="sado-section__head"><p className="sado-kicker is-dark">{t.functionKicker}</p><h2>{t.functionTitle}<em>{t.functionAccent}</em></h2></div><div className="sado-function__grid">{t.functionItems.map(([title, description], index) => <article key={title}><button type="button" onClick={() => openGallery(functionImages, index, t.functionTitle)} aria-label={`${t.galleryOpen}: ${title}`}><img src={asset(functionImages[index])} alt={title} loading="lazy" /><span>↗</span></button><small>0{index + 1}</small><h3>{title}</h3><p>{description}</p></article>)}</div></section>

    <section id="location" className="sado-section sado-location"><div className="sado-location__image"><img src={asset('/sado/location.webp')} alt="Sad'O" loading="lazy" /><div><span>41°17′ N</span><span>69°22′ E</span></div></div><div className="sado-location__content"><p className="sado-kicker">{t.locationKicker}</p><h2>{t.locationTitle}<em>{t.locationAccent}</em></h2><p>{t.locationCopy}</p><ul>{t.nearby.map((item, index) => <li key={item}><small>0{index + 1}</small>{item}</li>)}</ul><div className="sado-location__links"><a href={bookletUrl} target="_blank" rel="noreferrer">{t.booklet}<span>↓</span></a></div></div></section>

    <section id="progress" className="sado-section sado-progress"><div className="sado-section__head"><p className="sado-kicker is-dark">{t.progressKicker}</p><h2>{t.progressTitle}<em>{t.progressAccent}</em></h2><p>{t.progressCopy}</p></div><div className="sado-progress__gallery">{constructionImages.map((src, index) => <button key={src} type="button" onClick={() => openGallery(constructionImages, index, t.progressTitle)} aria-label={`${t.galleryOpen}: ${index + 1}`}><img src={asset(src)} alt="Sad'O" loading="lazy" /><span>0{index + 1}</span></button>)}</div><div className="sado-progress__links"><a href={panoramaUrl} target="_blank" rel="noreferrer"><small>LIVE 360</small>{t.panorama}<span>↗</span></a><div aria-disabled="true"><small>{t.camera}</small>{t.cameraUnavailable}<span>—</span></div></div></section>

    <section className="sado-catalog-cta"><div><p className="sado-kicker">{t.catalogKicker}</p><h2>{t.catalogTitle}<em>{t.catalogAccent}</em></h2><p>{t.catalogCopy(initialAvailable)}</p><small>{t.checked}: {formattedSnapshot}</small><a className="sado-button is-light" href={withLanguage('/sado/apartments', language)}>{t.catalogButton}<span>→</span></a></div><img src={asset('/sado/terrace.webp')} alt="Sad'O" loading="lazy" /></section>

    <section className="sado-contact"><div><p className="sado-kicker">{t.formKicker}</p><h2>{t.formTitle}<em>{t.formAccent}</em></h2><p>{t.formCopy}</p></div><SadoInlineForm language={language} /></section>
    <footer className="sado-footer"><a className="sado-logo is-footer" href={withLanguage('/sado', language)}><span>SAD</span><i>’</i><span>O</span></a><div><a href="tel:1360">1360</a><a href={withLanguage('/sado/apartments', language)}>{t.choose}</a><a href={`${appBasePath}/privacy?project=sado&lang=${language}`}>{t.privacyLink}</a></div><p>{t.footerNote}</p><small>© NRG-BI · SAD’O · 2026</small></footer>

    <LeadModal open={leadOpen} language={language} context="sado:landing:modal" brandName="NRG-BI" projectName="Sad'O" tagline={t.heroAccent} facts={t.heroMeta} submitUrl={leadSubmitUrl()} projectSlug="sado" privacyUrl={`${appBasePath}/privacy?project=sado&lang=${language}`} requireConsent onClose={() => setLeadOpen(false)} />
    {lightbox ? <Lightbox state={lightbox} onClose={() => setLightbox(null)} onMove={moveLightbox} labels={{ close: t.close, previous: t.previous, next: t.next }} /> : null}
  </main>;
}
