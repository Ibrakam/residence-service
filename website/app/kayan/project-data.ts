export type KayanProjectSlug = 'mirador' | 'ofiyat' | 'meros';
export type KayanLanguage = 'ru' | 'uz' | 'en';

export type ProjectFeature = {
  number: string;
  title: string;
  description: string;
};

export type ProjectChapter = {
  number: string;
  title: string;
  description: string;
};

export type ProjectLocaleCopy = {
  eyebrow: string;
  address: string;
  headline: string;
  headlineAccent: string;
  description: string;
  storyTitle: string;
  storyAccent: string;
  storyCopy: string;
  facts: Array<{ value: string; label: string }>;
  features: ProjectFeature[];
  chapters: ProjectChapter[];
  consultationTitle: string;
  consultationAccent: string;
  consultationCopy: string;
  tagline: string;
};

export type KayanProjectConfig = {
  slug: KayanProjectSlug;
  name: string;
  heroImage: string | null;
  heroMobileImage?: string | null;
  storyImages?: string[];
  storyMobileImages?: string[];
  chapterImages?: string[];
  chapterMobileImages?: string[];
  palette: {
    ink: string;
    paper: string;
    paperAlt: string;
    accent: string;
    secondary: string;
    menu: string;
  };
  phasePins: Record<string, { left: string; top: string }>;
  copy: Record<KayanLanguage, ProjectLocaleCopy>;
};

export const projectConfigs: Record<KayanProjectSlug, KayanProjectConfig> = {
  mirador: {
    slug: 'mirador',
    name: 'MIRADOR',
    heroImage: '/kayan/mirador/hero.webp',
    heroMobileImage: '/kayan/mirador/hero-mobile.webp',
    storyImages: ['/kayan/mirador/courtyard.webp', '/kayan/mirador/terrace.webp'],
    storyMobileImages: ['/kayan/mirador/courtyard-mobile.webp', '/kayan/mirador/terrace-mobile.webp'],
    chapterImages: [
      '/kayan/mirador/location.webp',
      '/kayan/mirador/architecture.webp',
      '/kayan/mirador/layouts.webp',
      '/kayan/mirador/landscaping.webp',
      '/kayan/mirador/engineering.webp',
    ],
    chapterMobileImages: [
      '/kayan/mirador/location-mobile.webp',
      '/kayan/mirador/architecture-mobile.webp',
      '/kayan/mirador/layouts-mobile.webp',
      '/kayan/mirador/landscaping-mobile.webp',
      '/kayan/mirador/engineering-mobile.webp',
    ],
    palette: {
      ink: '#0c0f0e',
      paper: '#f0eadf',
      paperAlt: '#d2c8b9',
      accent: '#c8ad76',
      secondary: '#9d725f',
      menu: '#121412',
    },
    phasePins: { main: { left: '51%', top: '53%' } },
    copy: {
      ru: {
        eyebrow: 'MIRADOR · БИЗНЕС-КЛАСС',
        address: 'Ташкент · Фаргона йули, 52',
        headline: 'Город —',
        headlineAccent: 'с новой точки зрения.',
        description: 'Mirador — современный квартал с переменной этажностью и квартирами с террасами. Жилая и деловая среда объединены в едином пространстве.',
        storyTitle: 'Архитектура для города.',
        storyAccent: 'Приватность для дома.',
        storyCopy: 'Панорамные окна, выразительная переменная этажность и закрытый двор создают современную городскую среду, в которой общественное и личное остаются в правильном балансе.',
        facts: [
          { value: '7–16', label: 'этажей в квартале' },
          { value: '3 м', label: 'высота потолков' },
          { value: '2', label: 'уровня паркинга' },
          { value: '24/7', label: 'приватная территория' },
        ],
        features: [
          { number: '01', title: 'Квартиры с террасами', description: 'Просторные террасы становятся дополнительным приватным пространством для отдыха, работы и встреч с близкими.' },
          { number: '02', title: 'Двор без автомобилей', description: 'Внутренняя территория предназначена для прогулок, спокойного отдыха и общения жителей.' },
          { number: '03', title: 'Двухуровневый паркинг', description: 'Транспорт остаётся под землёй, а к подъездам можно пройти напрямую и с комфортом.' },
        ],
        chapters: [
          { number: '01', title: 'Локация', description: 'Фаргона йули, 52 — адрес, связанный с городом и его повседневной инфраструктурой.' },
          { number: '02', title: 'Архитектура', description: 'Переменная этажность от 7 до 16 этажей формирует динамичный силуэт комплекса и открывает больше света.' },
          { number: '03', title: 'Планировки', description: 'Панорамные окна, потолки высотой 3 метра и отдельные квартиры с просторными террасами.' },
          { number: '04', title: 'Благоустройство', description: 'Закрытая от автомобилей территория поддерживает приватный и спокойный сценарий жизни.' },
          { number: '05', title: 'Инженерия', description: 'Два уровня подземного паркинга освобождают двор и обеспечивают удобный доступ к дому.' },
        ],
        consultationTitle: 'Найдём квартиру,',
        consultationAccent: 'которая подходит вам.',
        consultationCopy: 'Оставьте контакты — менеджер проекта уточнит ваши пожелания и подготовит актуальные варианты в Mirador.',
        tagline: 'Новый взгляд на городскую жизнь.',
      },
      uz: {
        eyebrow: 'MIRADOR · BIZNES-KLASS',
        address: 'Toshkent · Farg‘ona yo‘li, 52',
        headline: 'Shahar —',
        headlineAccent: 'yangi nigoh bilan.',
        description: 'Mirador — turli balandlikdagi binolar va terrasali xonadonlardan iborat zamonaviy kvartal. Turar joy va ish muhiti yagona makonda birlashadi.',
        storyTitle: 'Shahar uchun arxitektura.',
        storyAccent: 'Uy uchun maxfiylik.',
        storyCopy: 'Panorama oynalar, ifodali qavatlilik va yopiq hovli zamonaviy shahar muhitini yaratadi — jamoat va shaxsiy hayot muvozanatda.',
        facts: [
          { value: '7–16', label: 'kvartaldagi qavatlar' },
          { value: '3 m', label: 'shift balandligi' },
          { value: '2', label: 'parking darajasi' },
          { value: '24/7', label: 'yopiq hudud' },
        ],
        features: [
          { number: '01', title: 'Terrasali xonadonlar', description: 'Keng terrasalar dam olish, ishlash va yaqinlar bilan uchrashish uchun shaxsiy makon beradi.' },
          { number: '02', title: 'Avtomobilsiz hovli', description: 'Ichki hudud sayr, sokin dam olish va qo‘shnilar bilan muloqot uchun mo‘ljallangan.' },
          { number: '03', title: 'Ikki qavatli parking', description: 'Transport yer ostida qoladi, kirish yo‘laklariga esa qulay tarzda o‘tiladi.' },
        ],
        chapters: [
          { number: '01', title: 'Joylashuv', description: 'Farg‘ona yo‘li, 52 — shahar va kundalik infratuzilma bilan bog‘langan manzil.' },
          { number: '02', title: 'Arxitektura', description: '7 dan 16 qavatgacha bo‘lgan binolar majmuaning dinamik siluetini yaratadi.' },
          { number: '03', title: 'Rejalar', description: 'Panorama oynalar, 3 metrli shiftlar va ayrim xonadonlarda keng terrasalar.' },
          { number: '04', title: 'Obodonlashtirish', description: 'Avtomobillardan yopiq hudud sokin va xususiy hayot ssenariysini qo‘llab-quvvatlaydi.' },
          { number: '05', title: 'Muhandislik', description: 'Ikki darajali yer osti parkingi hovlini bo‘shatadi va uyga qulay kirishni ta’minlaydi.' },
        ],
        consultationTitle: 'Sizga mos',
        consultationAccent: 'xonadonni topamiz.',
        consultationCopy: 'Kontaktlaringizni qoldiring — loyiha menejeri istaklaringizni aniqlab, Mirador bo‘yicha dolzarb variantlarni tayyorlaydi.',
        tagline: 'Shahar hayotiga yangi nigoh.',
      },
      en: {
        eyebrow: 'MIRADOR · BUSINESS CLASS',
        address: 'Tashkent · 52 Fargona Yuli',
        headline: 'The city —',
        headlineAccent: 'from a new perspective.',
        description: 'Mirador is a contemporary quarter of varied heights and apartments with terraces, bringing residential and business life together in one place.',
        storyTitle: 'Architecture for the city.',
        storyAccent: 'Privacy for home.',
        storyCopy: 'Panoramic windows, an expressive stepped skyline and a private car-free courtyard shape a modern environment where public and personal life stay in balance.',
        facts: [
          { value: '7–16', label: 'storeys across the quarter' },
          { value: '3 m', label: 'ceiling height' },
          { value: '2', label: 'parking levels' },
          { value: '24/7', label: 'private territory' },
        ],
        features: [
          { number: '01', title: 'Apartments with terraces', description: 'Generous terraces create a private extension for rest, work and time with family and friends.' },
          { number: '02', title: 'Car-free courtyard', description: 'The inner territory is designed for walking, quiet recreation and the residents’ community.' },
          { number: '03', title: 'Two-level parking', description: 'Vehicles stay underground, with convenient direct access to the residential entrances.' },
        ],
        chapters: [
          { number: '01', title: 'Location', description: '52 Fargona Yuli connects the residence to the city and its everyday infrastructure.' },
          { number: '02', title: 'Architecture', description: 'Buildings ranging from 7 to 16 storeys create a dynamic silhouette and bring in more daylight.' },
          { number: '03', title: 'Layouts', description: 'Panoramic windows, three-metre ceilings and selected homes with spacious terraces.' },
          { number: '04', title: 'Landscape', description: 'A territory closed to cars supports a calm, private and pedestrian-first way of life.' },
          { number: '05', title: 'Engineering', description: 'Two underground parking levels free the courtyard and provide convenient access to each home.' },
        ],
        consultationTitle: 'We will find a home',
        consultationAccent: 'that fits your life.',
        consultationCopy: 'Leave your details and the project manager will clarify your needs and prepare current options at Mirador.',
        tagline: 'A new perspective on city living.',
      },
    },
  },
  ofiyat: {
    slug: 'ofiyat',
    name: 'OFIYAT',
    heroImage: '/kayan/ofiyat/frame-4-desktop.webp',
    heroMobileImage: '/kayan/ofiyat/frame-4-mobile.webp',
    storyImages: ['/kayan/ofiyat/courtyard.webp', '/kayan/ofiyat/lifestyle.webp'],
    chapterImages: [
      '/kayan/ofiyat/location.webp',
      '/kayan/ofiyat/architecture.webp',
      '/kayan/ofiyat/layouts.webp',
      '/kayan/ofiyat/landscape.webp',
      '/kayan/ofiyat/engineering.webp',
    ],
    palette: {
      ink: '#2f342a',
      paper: '#f6f1e8',
      paperAlt: '#e9e1d2',
      accent: '#b86f52',
      secondary: '#78866b',
      menu: '#30372c',
    },
    phasePins: {
      'phase-1': { left: '29%', top: '48%' },
      'phase-2': { left: '57%', top: '40%' },
      parking: { left: '68%', top: '65%' },
    },
    copy: {
      ru: {
        eyebrow: 'OFIYAT · ГОТОВАЯ СРЕДА',
        address: 'Ташкент · Яшнабадский район · Фаргона йули, 33–35',
        headline: 'Гармония внутри.',
        headlineAccent: 'Город рядом.',
        description: 'Ofiyat Residence — место для тех, кто стремится к исключительному стилю жизни в гармонии с собой и окружающим миром.',
        storyTitle: 'Готовый сценарий жизни.',
        storyAccent: 'Свобода сделать своим.',
        storyCopy: 'Благоустроенный двор, квартиры с подготовкой White box и подземный паркинг складываются в спокойную и функциональную среду на каждый день.',
        facts: [
          { value: '2', label: 'жилые очереди' },
          { value: '15', label: 'этажей' },
          { value: 'White box', label: 'подготовка квартир' },
          { value: '200', label: 'мест в паркинге' },
        ],
        features: [
          { number: '01', title: 'Детские площадки', description: 'Безопасная и контролируемая среда для активного отдыха детей разных возрастов.' },
          { number: '02', title: 'Квартиры White box', description: 'Основная подготовка уже выполнена, поэтому интерьер можно быстрее сделать под себя.' },
          { number: '03', title: 'Подземный паркинг', description: 'Паркинг на 200 мест эффективно использует пространство и освобождает двор от автомобилей.' },
        ],
        chapters: [
          { number: '01', title: 'Расположение', description: 'Комплекс расположен в Яшнабадском районе по адресу Фаргона йули, 33–35.' },
          { number: '02', title: 'Архитектура', description: 'Сдержанная современная архитектура формирует цельный облик жилого комплекса.' },
          { number: '03', title: 'Планировки', description: 'Квартиры передаются с готовой подготовкой White box — основой для индивидуального интерьера.' },
          { number: '04', title: 'Благоустройство', description: 'Детские площадки дают семьям безопасное пространство для ежедневного отдыха.' },
          { number: '05', title: 'Инженерия', description: 'Подземный паркинг на 200 мест сохраняет пешеходный характер внутренней территории.' },
        ],
        consultationTitle: 'Выберите квартиру,',
        consultationAccent: 'готовую к вашей истории.',
        consultationCopy: 'Оставьте контакты — менеджер проекта расскажет об очередях Ofiyat, актуальных квартирах и условиях покупки.',
        tagline: 'Пространство для жизни в гармонии.',
      },
      uz: {
        eyebrow: 'OFIYAT · TAYYOR MUHIT',
        address: 'Toshkent · Yashnobod tumani · Farg‘ona yo‘li, 33–35',
        headline: 'Ichki uyg‘unlik.',
        headlineAccent: 'Shahar yoningizda.',
        description: 'Ofiyat Residence — o‘zi va atrofidagi olam bilan uyg‘un, o‘ziga xos hayot tarzini tanlaydiganlar uchun maskan.',
        storyTitle: 'Hayot uchun tayyor ssenariy.',
        storyAccent: 'Uni o‘zingizniki qilish erkinligi.',
        storyCopy: 'Obodonlashtirilgan hovli, White box holatidagi xonadonlar va yer osti parkingi kundalik hayot uchun sokin va funksional muhit yaratadi.',
        facts: [
          { value: '2', label: 'turar joy bosqichi' },
          { value: '15', label: 'qavat' },
          { value: 'White box', label: 'xonadon tayyorligi' },
          { value: '200', label: 'parking o‘rni' },
        ],
        features: [
          { number: '01', title: 'Bolalar maydonchalari', description: 'Turli yoshdagi bolalarning faol dam olishi uchun xavfsiz va nazorat qilinadigan muhit.' },
          { number: '02', title: 'White box xonadonlar', description: 'Asosiy tayyorgarlik bajarilgan — individual interyerni tezroq boshlash mumkin.' },
          { number: '03', title: 'Yer osti parkingi', description: '200 o‘rinli parking makondan samarali foydalanadi va hovlini avtomobillardan ozod qiladi.' },
        ],
        chapters: [
          { number: '01', title: 'Joylashuv', description: 'Majmua Yashnobod tumanida, Farg‘ona yo‘li 33–35 manzilida joylashgan.' },
          { number: '02', title: 'Arxitektura', description: 'Sokin zamonaviy arxitektura turar joy majmuasining yaxlit qiyofasini yaratadi.' },
          { number: '03', title: 'Rejalar', description: 'Xonadonlar individual interyer uchun tayyor asos — White box holatida topshiriladi.' },
          { number: '04', title: 'Obodonlashtirish', description: 'Bolalar maydonchalari oilalar uchun har kungi xavfsiz dam olish makonini beradi.' },
          { number: '05', title: 'Muhandislik', description: '200 o‘rinli yer osti parkingi ichki hududning piyodalar uchun qulayligini saqlaydi.' },
        ],
        consultationTitle: 'Sizning hikoyangizga',
        consultationAccent: 'mos xonadonni tanlang.',
        consultationCopy: 'Kontaktlaringizni qoldiring — loyiha menejeri Ofiyat bosqichlari, mavjud xonadonlar va xarid shartlarini tushuntiradi.',
        tagline: 'Uyg‘un hayot uchun makon.',
      },
      en: {
        eyebrow: 'OFIYAT · READY ENVIRONMENT',
        address: 'Tashkent · Yashnabad district · 33–35 Fargona Yuli',
        headline: 'Harmony within.',
        headlineAccent: 'The city close by.',
        description: 'Ofiyat Residence is a place for those seeking an exceptional way of life in harmony with themselves and the world around them.',
        storyTitle: 'A ready way of life.',
        storyAccent: 'Freedom to make it yours.',
        storyCopy: 'A landscaped courtyard, White box apartments and underground parking come together as a calm and functional everyday environment.',
        facts: [
          { value: '2', label: 'residential phases' },
          { value: '15', label: 'storeys' },
          { value: 'White box', label: 'apartment finish' },
          { value: '200', label: 'parking spaces' },
        ],
        features: [
          { number: '01', title: 'Children’s playgrounds', description: 'A safe and supervised environment for active recreation across different age groups.' },
          { number: '02', title: 'White box apartments', description: 'The essential preparation is complete, making it faster to create an individual interior.' },
          { number: '03', title: 'Underground parking', description: 'Parking for 200 cars uses space efficiently and keeps vehicles out of the courtyard.' },
        ],
        chapters: [
          { number: '01', title: 'Location', description: 'The residence is located at 33–35 Fargona Yuli in Tashkent’s Yashnabad district.' },
          { number: '02', title: 'Architecture', description: 'Restrained contemporary architecture gives the residential complex a coherent identity.' },
          { number: '03', title: 'Layouts', description: 'Apartments are delivered in White box condition — a prepared base for a personal interior.' },
          { number: '04', title: 'Landscape', description: 'Children’s playgrounds create a safe place for families to spend time every day.' },
          { number: '05', title: 'Engineering', description: 'Underground parking for 200 cars preserves the pedestrian character of the inner territory.' },
        ],
        consultationTitle: 'Choose a home',
        consultationAccent: 'ready for your story.',
        consultationCopy: 'Leave your details and the project manager will explain Ofiyat’s phases, available apartments and purchase terms.',
        tagline: 'A place for life in harmony.',
      },
    },
  },
  meros: {
    slug: 'meros',
    name: 'MEROS',
    heroImage: '/meros/hero.webp',
    heroMobileImage: '/meros/hero-mobile.webp',
    storyImages: ['/meros/story.webp', '/meros/story-detail.webp'],
    chapterImages: ['/meros/location-view.webp', '/meros/architecture.webp', '/meros/selection.webp', '/meros/courtyard-heritage.webp', '/meros/hall-2.webp'],
    palette: {
      ink: '#241c18',
      paper: '#eee5d8',
      paperAlt: '#d9c8b4',
      accent: '#b58b62',
      secondary: '#6b2438',
      menu: '#211915',
    },
    phasePins: {
      business: { left: '54%', top: '52%' },
      'comfort-1': { left: '30%', top: '45%' },
      'comfort-2': { left: '67%', top: '42%' },
    },
    copy: {
      ru: {
        eyebrow: 'MEROS · СОВРЕМЕННОЕ НАСЛЕДИЕ',
        address: 'Ташкент · Мирабадский район · ул. 8 Марта',
        headline: 'Создано сегодня.',
        headlineAccent: 'Останется на поколения.',
        description: 'Meros соединяет современную архитектуру, природный камень и тёплую семейную среду в Мирабадском районе.',
        storyTitle: 'Наследие на века.',
        storyAccent: 'Жизнь в настоящем.',
        storyCopy: 'Сдержанная архитектура, закрытые дворы и выразительные общественные пространства создают дом, рассчитанный на долгую семейную историю.',
        facts: [
          { value: '256', label: 'активных предложений в каталоге' },
          { value: '11–16', label: 'этажей' },
          { value: '3', label: 'очереди в каталоге' },
          { value: '1–4', label: 'комнаты' },
        ],
        features: [
          { number: '01', title: 'Природная тактильность', description: 'Вентилируемые фасады и натуральный камень рассчитаны на долгий срок службы.' },
          { number: '02', title: 'Семейный двор', description: 'Закрытая территория, сад, детские и спортивные пространства поддерживают жизнь разных поколений.' },
          { number: '03', title: 'Продуманная инженерия', description: 'Монолитный сейсмостойкий каркас, увеличенные окна и современные системы доступа.' },
        ],
        chapters: [
          { number: '01', title: 'Мирабад', description: 'Городская локация рядом с ежедневной инфраструктурой.' },
          { number: '02', title: 'Архитектура', description: 'Выразительный силуэт высотой 11, 13 и 16 этажей.' },
          { number: '03', title: 'Планировки', description: 'Точные планы активных квартир из официального каталога.' },
          { number: '04', title: 'Двор', description: 'Приватная семейная территория без лишнего транзита.' },
          { number: '05', title: 'Холлы', description: 'Авторская отделка, Face ID и бесшумные лифты.' },
        ],
        consultationTitle: 'Выберите пространство,',
        consultationAccent: 'которое станет наследием.',
        consultationCopy: 'Оставьте контакты — менеджер уточнит актуальность выбранной квартиры и условия покупки в Meros.',
        tagline: 'Современное наследие для будущих поколений.',
      },
      uz: {
        eyebrow: 'MEROS · ZAMONAVIY MEROS',
        address: 'Toshkent · Mirobod tumani · 8 Mart ko‘chasi',
        headline: 'Bugun yaratilgan.',
        headlineAccent: 'Avlodlarga qoladi.',
        description: 'Meros zamonaviy arxitektura, tabiiy tosh va iliq oilaviy muhitni Mirobod tumanida birlashtiradi.',
        storyTitle: 'Asrlar uchun meros.',
        storyAccent: 'Bugungi hayot uchun.',
        storyCopy: 'Sokin arxitektura, yopiq hovlilar va ifodali jamoat makonlari uzoq oilaviy tarix uchun yaratilgan uy muhitini shakllantiradi.',
        facts: [
          { value: '256', label: 'katalogdagi faol takliflar' },
          { value: '11–16', label: 'qavat' },
          { value: '3', label: 'katalog bosqichi' },
          { value: '1–4', label: 'xona' },
        ],
        features: [
          { number: '01', title: 'Tabiiy materiallar', description: 'Shamollatiladigan fasad va tabiiy tosh uzoq xizmat qilish uchun tanlangan.' },
          { number: '02', title: 'Oilaviy hovli', description: 'Yopiq hudud, bog‘, bolalar va sport maydonlari turli avlodlar hayotini birlashtiradi.' },
          { number: '03', title: 'Aniq muhandislik', description: 'Zilzilaga chidamli monolit karkas, kengaytirilgan derazalar va zamonaviy kirish tizimlari.' },
        ],
        chapters: [
          { number: '01', title: 'Mirobod', description: 'Kundalik infratuzilmaga yaqin shahar manzili.' },
          { number: '02', title: 'Arxitektura', description: '11, 13 va 16 qavatli ifodali siluet.' },
          { number: '03', title: 'Rejalar', description: 'Rasmiy katalogdagi faol xonadonlarning aniq rejalari.' },
          { number: '04', title: 'Hovli', description: 'Ortiqcha tranzitsiz, yopiq oilaviy hudud.' },
          { number: '05', title: 'Xollar', description: 'Mualliflik bezagi, Face ID va shovqinsiz liftlar.' },
        ],
        consultationTitle: 'Merosga aylanadigan',
        consultationAccent: 'makonni tanlang.',
        consultationCopy: 'Kontaktlaringizni qoldiring — menejer tanlangan xonadonning dolzarbligi va xarid shartlarini aniqlashtiradi.',
        tagline: 'Kelajak avlodlar uchun zamonaviy meros.',
      },
      en: {
        eyebrow: 'MEROS · CONTEMPORARY HERITAGE',
        address: 'Tashkent · Mirobod district · 8 Marta Street',
        headline: 'Created today.',
        headlineAccent: 'Made to outlast generations.',
        description: 'Meros brings contemporary architecture, natural stone and a warm family setting together in Mirobod.',
        storyTitle: 'A legacy for generations.',
        storyAccent: 'A home for today.',
        storyCopy: 'Restrained architecture, private courtyards and considered shared spaces create a home designed for a long family story.',
        facts: [
          { value: '256', label: 'active catalogue listings' },
          { value: '11–16', label: 'storeys' },
          { value: '3', label: 'catalogue phases' },
          { value: '1–4', label: 'bedrooms' },
        ],
        features: [
          { number: '01', title: 'Natural tactility', description: 'Ventilated façades and natural stone are specified for lasting performance.' },
          { number: '02', title: 'A family courtyard', description: 'Private grounds, gardens, play and workout areas support life across generations.' },
          { number: '03', title: 'Precise engineering', description: 'An earthquake-resistant frame, larger windows and contemporary access systems.' },
        ],
        chapters: [
          { number: '01', title: 'Mirobod', description: 'An urban address connected to everyday infrastructure.' },
          { number: '02', title: 'Architecture', description: 'An expressive skyline of 11, 13 and 16 storeys.' },
          { number: '03', title: 'Layouts', description: 'Exact plans for active homes from the official catalogue.' },
          { number: '04', title: 'Courtyard', description: 'A private family territory without unnecessary through traffic.' },
          { number: '05', title: 'Lobbies', description: 'Bespoke finishes, Face ID access and quiet lifts.' },
        ],
        consultationTitle: 'Choose a home',
        consultationAccent: 'to become your legacy.',
        consultationCopy: 'Leave your details and the manager will confirm the selected apartment and current purchase terms at Meros.',
        tagline: 'A contemporary legacy for future generations.',
      },
    },
  },
};
