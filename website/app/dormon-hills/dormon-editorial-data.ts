import type { DormonLanguage } from './dormon-data';

type Item = { title: string; text: string; image: string };
type Editorial = {
  hero: string; heroBody: string; about: string; aboutBody: string[]; panorama: string; panoramaBody: string;
  featureTitle: string; features: Item[]; construction: string; constructionBody: string[]; facade: string;
  layerHint: string; layerNote: string; layers: { title: string; text: string }[];
  yard: string; stories: Item[]; masterplan: string; overview: string; zoneHint: string; zones: Item[];
  lounge: string; loungeBody: string[]; loungePhotos: Item[]; community: string; communityBody: string;
  hub: string; services: Item[]; plans: string; plansBody: string; rooms: string[];
  location: string; contact: string; contactBody: string; details: string; previous: string; next: string;
  sections: string[]; disclaimer: string; copyright: string;
};

const ru: Editorial = {
  hero: 'Природа ближе.\nЖизнь просторнее.',
  heroBody: 'Do‘rmon Hills — комплекс бизнес-класса в Кибрайском районе. Современная архитектура, зелёный двор и пространство для всей семьи.',
  about: 'Продуманный дом.\nСвободный ритм жизни.',
  aboutBody: ['Пять жилых блоков объединены общим двором на территории 0,8 гектара. Здесь есть место для прогулок, детских игр, встреч с друзьями и тихих вечеров на свежем воздухе.', 'Более 30% территории отведено озеленению. Декоративные деревья, цветники и газоны формируют спокойную среду вокруг дома.'],
  panorama: 'Горизонт\nбез спешки.', panoramaBody: 'Панорамные виды в сторону Угамского, Пскемского и Чаткальского хребтов.',
  featureTitle: 'Девять деталей\nвашего комфорта.',
  features: [
    {title:'Благоустроенная территория',text:'Деревья, цветники и прогулочные дорожки. Более 30% территории комплекса занимают зелёные зоны.',image:'about'},
    {title:'Охрана и видеонаблюдение',text:'Круглосуточное наблюдение за территорией и входными группами помогает сохранить спокойствие жителей.',image:'security'},
    {title:'Закрытый двор без автомобилей',text:'Внутреннее пространство принадлежит пешеходам. Движение машин вынесено за пределы мест отдыха.',image:'aerial'},
    {title:'Продуманное пространство',text:'Игровые площадки, фонтан, беседки и спортивная зона собраны в едином дворе.',image:'masterplan'},
    {title:'Подземный паркинг',text:'Защищённое место для автомобиля с удобной навигацией и переходом к жилой части.',image:'parking'},
    {title:'Контролируемый въезд',text:'Умный шлагбаум регулирует въезд на территорию жилого комплекса.',image:'entry'},
    {title:'Лаунж с летней кухней',text:'Отдельные пространства для отдыха, семейных встреч и совместных ужинов.',image:'lounge'},
    {title:'Пять авторских беседок',text:'Приватные уголки во дворе, где можно собраться с близкими или провести время в тишине.',image:'pavilion'},
    {title:'Декоративный фонтан',text:'Место встреч в центре двора. Скамейки и зелень вокруг воды продолжают прогулочный маршрут.',image:'fountain'},
  ],
  construction:'Красота снаружи.\nНадёжность внутри.',
  constructionBody:['В основе стен — керамический кирпич. Долговечный материал помогает сохранять тепло и уменьшать проникновение внешнего шума.', 'Вентилируемый фасад объединяет защиту здания и выразительную архитектуру. Облицовка из керамогранита и композитных панелей дополняет светлый силуэт комплекса.'],
  facade:'Фасад.\nСлой за слоем.', layerHint:'Выберите слой, чтобы узнать его назначение.', layerNote:'Условная схема системы вентилируемого фасада.',
  layers:[
    {title:'Керамический кирпич',text:'Кирпичная кладка марки М150 составляет основание фасадной системы и помогает обеспечивать теплоизоляцию и защиту от шума.'},
    {title:'Базальтовая теплоизоляция',text:'Негорючая плита закрепляется тарельчатыми дюбелями. Гидроветрозащитная мембрана защищает утеплитель от внешней влаги и ветра.'},
    {title:'Несущая подсистема',text:'Металлические профили 60 × 40 × 4 мм и 40 × 40 × 4 мм поддерживают наружную облицовку и формируют каркас фасада.'},
    {title:'Вентиляционный зазор',text:'Воздушное пространство 20–50 мм между теплоизоляцией и облицовкой обеспечивает циркуляцию воздуха и отвод влаги.'},
    {title:'Наружная облицовка',text:'Керамогранит и алюминиевые композитные панели образуют внешний декоративный и защитный слой здания.'},
  ],
  yard:'Выйти во двор.\nОстаться у себя.',
  stories:[
    {title:'Двор без автомобилей',text:'Безопасные дорожки, зелень и места для отдыха вместо транзитного движения. Дети играют рядом с домом, взрослые наслаждаются спокойными прогулками.',image:'calm'},
    {title:'Место для всей семьи',text:'Общий двор объединяет разные сценарии жизни: активные игры, встречи с соседями, семейные праздники и отдых на свежем воздухе.',image:'family'},
    {title:'Детство на свежем воздухе',text:'Игровые комплексы и качели расположены внутри закрытого двора. Мягкое покрытие и зоны отдыха рядом с площадками помогают родителям быть поблизости.',image:'playground'},
    {title:'Движение рядом с домом',text:'Функциональные тренажёры в workout-зоне позволяют выбрать свой темп тренировки. Спорт становится частью повседневности, без дороги до отдельного зала.',image:'workout'},
    {title:'Маршруты для прогулок',text:'Широкие аллеи проходят между цветниками, зелёными бульварами и арками с розами. Небольшая прогулка легко превращается в любимую ежедневную привычку.',image:'alleys'},
    {title:'Встретимся у фонтана',text:'Декоративный фонтан формирует центр двора. Удобные скамейки и мягкий звук воды создают место для встреч, разговоров и спокойных пауз.',image:'fountain'},
    {title:'Своя тихая беседка',text:'Пять дизайнерских беседок дают возможность провести время с семьёй и друзьями в приватной обстановке, не покидая территорию комплекса.',image:'gazebos'},
  ],
  masterplan:'Один двор.\nМного возможностей.', overview:'Весь двор', zoneHint:'Исследуйте пространства двора',
  zones:[
    {title:'Игровые площадки',text:'Место для игр и новых друзей внутри закрытой территории.',image:'playground'},
    {title:'Центральный фонтан',text:'Спокойное место встреч с удобными скамейками вокруг.',image:'fountain'},
    {title:'Беседки',text:'Пять авторских пространств для приватного отдыха.',image:'gazebos'},
    {title:'Лаунж',text:'Летняя кухня и места для встреч с близкими.',image:'lounge'},
    {title:'Workout',text:'Тренировки на свежем воздухе в удобное время.',image:'workout'},
    {title:'Прогулочные аллеи',text:'Зелёные маршруты между пространствами двора.',image:'alleys'},
  ],
  lounge:'Хорошие вечера\nначинаются здесь.', loungeBody:['Лаунж с летней кухней продолжает пространство вашей квартиры. Здесь можно приготовить ужин, пригласить друзей или вместе посмотреть важный матч.', 'Проект предусматривает отдельные зоны для мужчин и женщин, чтобы семейные события и встречи проходили в удобной, приватной атмосфере.'],
  loungePhotos:[
    {title:'Вечер на открытом воздухе',text:'Уютные места для семейных ужинов и неспешных разговоров.',image:'lounge-outside'},
    {title:'За общим столом',text:'Пространство для соседей, друзей и семейных встреч.',image:'lounge'},
    {title:'Летняя кухня',text:'Готовить вместе и проводить больше времени с близкими.',image:'kitchen'},
    {title:'Матчи и большие события',text:'Общий экран для спортивных трансляций и совместных вечеров.',image:'screen'},
  ],
  community:'Ближе не только к природе.\nБлиже друг к другу.', communityBody:'Общие пространства созданы для знакомства с соседями, тематических вечеров и добрых традиций вашего дома.',
  hub:'Комфорт начинается\nс первого шага.',
  services:[
    {title:'Входная группа',text:'Выразительный интерьер, зелёный мрамор и тщательно подобранные материалы. Холл продолжает архитектурную идею комплекса и встречает жителей спокойной, гостеприимной атмосферой.',image:'lobby'},
    {title:'Лифты для повседневной жизни',text:'Пассажирский лифт для ежедневных поездок и грузовой для мебели, крупных покупок и переезда. Разделение задач делает перемещение между этажами удобнее.',image:'elevators'},
    {title:'Автомобиль на своём месте',text:'Подземный паркинг с освещением, навигацией и продуманной организацией движения. Оставьте машину в защищённой зоне и переходите к жилой части комплекса.',image:'parking-interior'},
  ],
  plans:'Планировка\nпод вашу жизнь.',plansBody:'Отдельный каталог всех типовых планировок. Выберите количество комнат, сравните площади и посмотрите расположение квартиры на этаже.',rooms:['Одна комната','Две комнаты','Три комнаты'],
  location:'Кибрайский район.\nРядом с Ташкентом.', contact:'Давайте найдём\nвашу квартиру.', contactBody:'Обсудим ваши пожелания, сравним планировки и уточним актуальную цену и условия покупки.', details:'Подробнее',previous:'Предыдущее',next:'Следующее',
  sections:['О проекте','Особенности','Архитектура','Двор и семья','Лаунж','Сервис','Планировки','Контакты'],
  disclaimer:'Изображения — визуализации проекта. Характеристики, комплектацию и условия покупки уточняйте у менеджера.',copyright:'Консультации и подбор квартир — TenCorp.',
};

const uz: Editorial = {
  ...ru,
  hero:'Tabiatga yaqin.\nHayotga kenglik.', heroBody:'Do‘rmon Hills — Qibray tumanidagi biznes toifasidagi majmua. Zamonaviy arxitektura, yashil hovli va butun oila uchun makon.',
  about:'Puxta o‘ylangan uy.\nO‘z hayot maromingiz.',aboutBody:['0,8 gektar hududdagi beshta turar joy bloki umumiy hovli bilan birlashgan. Sayr, bolalar o‘yini, do‘stlar bilan uchrashuv va ochiq havodagi sokin oqshomlar uchun joy bor.', 'Hududning 30% dan ortig‘i ko‘kalamzorlashtirishga ajratilgan. Manzarali daraxtlar, gulzorlar va maysazorlar uy atrofida sokin muhit yaratadi.'],
  panorama:'Shoshilmay\nufqqa qarang.',panoramaBody:'Ugom, Piskom va Chotqol tog‘ tizmalari tomon ochiladigan panoramalar.',featureTitle:'Qulaylikning\nto‘qqiz jihati.',
  features:[
    {title:'Obod hudud',text:'Daraxtlar, gulzorlar va sayr yo‘laklari. Majmua hududining 30% dan ortig‘i yashil zonalarga ajratilgan.',image:'about'},
    {title:'Qo‘riqlash va videokuzatuv',text:'Hudud va kirish guruhlari kecha-kunduz nazorat qilinadi.',image:'security'},
    {title:'Avtomobilsiz yopiq hovli',text:'Ichki makon piyodalar uchun. Avtomobillar harakati dam olish joylaridan tashqarida tashkil etilgan.',image:'aerial'},
    {title:'Puxta rejalashtirilgan makon',text:'O‘yin maydonchalari, favvora, shiyponlar va sport zonasi bitta hovlida.',image:'masterplan'},
    {title:'Yerosti avtoturargohi',text:'Qulay yo‘nalishlar va turar joy qismiga o‘tishga ega himoyalangan joy.',image:'parking'},
    {title:'Nazoratli kirish',text:'Aqlli shlagbaum majmua hududiga kirishni boshqaradi.',image:'entry'},
    {title:'Yozgi oshxonali lounge',text:'Dam olish, oilaviy uchrashuv va birgalikdagi kechki ovqatlar uchun makon.',image:'lounge'},
    {title:'Beshta mualliflik shiyponi',text:'Yaqinlar bilan suhbat yoki sokin dam uchun xususiy burchaklar.',image:'pavilion'},
    {title:'Manzarali favvora',text:'Hovli markazidagi uchrashuv joyi. Suv atrofida o‘rindiqlar va ko‘kalamzor.',image:'fountain'},
  ],
  construction:'Tashqarida nafislik.\nIchkarida ishonchlilik.',constructionBody:['Devorlar asosini keramik g‘isht tashkil etadi. U issiqlikni saqlash va tashqi shovqinni kamaytirishga yordam beradi.', 'Shamollatiladigan fasad binoni himoya qilish bilan ifodali arxitekturani birlashtiradi. Keramogranit va kompozit panellar majmua ko‘rinishini to‘ldiradi.'],facade:'Fasad.\nQatlamma-qatlam.',layerHint:'Vazifasini bilish uchun qatlamni tanlang.',layerNote:'Shamollatiladigan fasad tizimining shartli sxemasi.',
  layers:[{title:'Keramik g‘isht',text:'M150 markali g‘isht fasad tizimining asosini yaratadi va issiqlik hamda shovqindan himoyaga yordam beradi.'},{title:'Bazalt issiqlik izolyatsiyasi',text:'Yonmaydigan plita likopchasimon dyubellar bilan mahkamlanadi. Membrana izolyatsiyani namlik va shamoldan himoya qiladi.'},{title:'Tayanch tizim',text:'60 × 40 × 4 mm va 40 × 40 × 4 mm metall profillar tashqi qoplamani ushlab turadi.'},{title:'Shamollatish oralig‘i',text:'Izolyatsiya va qoplama orasidagi 20–50 mm oraliq havo aylanishi va namlik chiqishini ta’minlaydi.'},{title:'Tashqi qoplama',text:'Keramogranit va alyumin kompozit panellar binoning tashqi himoya va bezak qatlamini yaratadi.'}],
  yard:'Hovliga chiqing.\nO‘z makoningizda qoling.',
  stories:[
    {title:'Avtomobilsiz hovli',text:'Tranzit harakat o‘rniga xavfsiz yo‘laklar, ko‘kalamzor va dam olish joylari. Bolalar uy yonida o‘ynaydi, kattalar sokin sayr qiladi.',image:'calm'},
    {title:'Butun oila uchun',text:'Umumiy hovli faol o‘yinlar, qo‘shnilar bilan uchrashuv, oilaviy bayram va ochiq havodagi damni birlashtiradi.',image:'family'},
    {title:'Ochiq havodagi bolalik',text:'Yopiq hovlida o‘yin majmualari va arg‘imchoqlar. Yumshoq qoplama va yaqin dam olish zonalari ota-onalarga yonida bo‘lish imkonini beradi.',image:'playground'},
    {title:'Uy yonida sport',text:'Workout zonasidagi funksional trenajyorlar mashq sur’atini o‘zingiz tanlashga imkon beradi. Sport kundalik hayotingizning bir qismiga aylanadi.',image:'workout'},
    {title:'Sayr yo‘nalishlari',text:'Gulzorlar, yashil bulvarlar va atirgul arkalari orasidagi keng yo‘laklar har kungi sayr uchun.',image:'alleys'},
    {title:'Favvora yonida uchrashamiz',text:'Manzarali favvora hovli markazini shakllantiradi. Qulay o‘rindiqlar va suvning mayin shovqini suhbat va sokin tanaffuslar uchun.',image:'fountain'},
    {title:'O‘z sokin shiyponingiz',text:'Beshta dizaynerlik shiyponi majmuadan chiqmasdan yaqinlar bilan xususiy muhitda vaqt o‘tkazish uchun.',image:'gazebos'},
  ],
  masterplan:'Bitta hovli.\nKo‘p imkoniyatlar.',overview:'Butun hovli',zoneHint:'Hovli makonlarini kashf eting',
  zones:[{title:'O‘yin maydonchalari',text:'Yopiq hududda o‘yinlar va yangi do‘stlar uchun.',image:'playground'},{title:'Markaziy favvora',text:'Atrofida o‘rindiqlari bor sokin uchrashuv joyi.',image:'fountain'},{title:'Shiyponlar',text:'Xususiy dam uchun beshta mualliflik makoni.',image:'gazebos'},{title:'Lounge',text:'Yozgi oshxona va yaqinlar bilan uchrashuvlar.',image:'lounge'},{title:'Workout',text:'Qulay vaqtda ochiq havodagi mashg‘ulotlar.',image:'workout'},{title:'Sayr yo‘laklari',text:'Hovli makonlarini bog‘lovchi yashil yo‘nalishlar.',image:'alleys'}],
  lounge:'Yaxshi oqshomlar\nshu yerda boshlanadi.',loungeBody:['Yozgi oshxonali lounge xonadoningiz makonini davom ettiradi. Kechki ovqat tayyorlang, do‘stlarni taklif qiling yoki birga muhim o‘yinni tomosha qiling.', 'Loyihada erkaklar va ayollar uchun alohida zonalar ko‘zda tutilgan. Oilaviy tadbirlar qulay va xususiy muhitda o‘tadi.'],
  loungePhotos:[{title:'Ochiq havodagi oqshom',text:'Oilaviy kechki ovqat va sokin suhbatlar uchun.',image:'lounge-outside'},{title:'Umumiy dasturxon',text:'Qo‘shnilar, do‘stlar va oilaviy uchrashuvlar makoni.',image:'lounge'},{title:'Yozgi oshxona',text:'Birga ovqat tayyorlash va yaqinlar bilan vaqt o‘tkazish.',image:'kitchen'},{title:'Sport va katta voqealar',text:'Sport translyatsiyalari va birgalikdagi oqshomlar uchun ekran.',image:'screen'}],
  community:'Nafaqat tabiatga.\nBir-biringizga yaqinroq.',communityBody:'Umumiy makonlar qo‘shnilar bilan tanishish, mavzuli oqshomlar va uyingizning yaxshi an’analari uchun yaratilgan.',hub:'Qulaylik birinchi\nqadamdan boshlanadi.',
  services:[{title:'Kirish guruhi',text:'Ifodali interyer, yashil marmar va puxta tanlangan materiallar. Xoll majmuaning arxitektura g‘oyasini davom ettirib, sokin muhit bilan kutib oladi.',image:'lobby'},{title:'Kundalik hayot uchun liftlar',text:'Kundalik qatnov uchun yo‘lovchi lifti, mebel va yirik xaridlar uchun yuk lifti. Vazifalarning bo‘linishi qavatlar orasidagi harakatni qulaylashtiradi.',image:'elevators'},{title:'Avtomobil o‘z joyida',text:'Yoritish, yo‘nalish belgilari va puxta harakat tashkiliga ega yerosti avtoturargohi. Avtomobilni himoyalangan zonada qoldiring va turar joy qismiga o‘ting.',image:'parking-interior'}],
  plans:'Hayotingizga\nmos reja.',plansBody:'Barcha namunaviy rejalar alohida katalogda. Xonalar sonini tanlang, maydonlarni solishtiring va xonadonning qavatdagi joylashuvini ko‘ring.',rooms:['Bir xona','Ikki xona','Uch xona'],location:'Qibray tumani.\nToshkentga yaqin.',contact:'Xonadoningizni\nbirga topamiz.',contactBody:'Istaklaringizni muhokama qilib, rejalarni solishtiramiz hamda amaldagi narx va xarid shartlarini aniqlaymiz.',details:'Batafsil',previous:'Oldingi',next:'Keyingi',sections:['Loyiha','Xususiyatlar','Arxitektura','Hovli va oila','Lounge','Servis','Rejalar','Aloqa'],disclaimer:'Tasvirlar loyiha vizualizatsiyalaridir. Xususiyatlar, jihozlanish va xarid shartlarini menejerdan aniqlang.',copyright:'Maslahat va xonadon tanlash — TenCorp.',
};

const en: Editorial = {
  ...ru,
  hero:'Closer to nature.\nRoom for living.',heroBody:'Do‘rmon Hills is a business-class development in Qibray District. Contemporary architecture, a green courtyard and space for the whole family.',
  about:'A considered home.\nA rhythm of your own.',aboutBody:['Five residential blocks share a courtyard on a 0.8-hectare site, with places to walk, play, meet friends and enjoy quiet evenings outdoors.', 'More than 30% of the grounds are dedicated to greenery. Ornamental trees, lawns and flower beds bring a calmer setting to everyday life.'],panorama:'A little more\nperspective.',panoramaBody:'Panoramic views towards the Ugam, Pskem and Chatkal mountain ranges.',featureTitle:'Nine details.\nOne considered home.',
  features:[{title:'Landscaped grounds',text:'Trees, flower beds and walking paths. Over 30% of the site is dedicated to green space.',image:'about'},{title:'Security and CCTV',text:'Round-the-clock monitoring of the grounds and entrances supports residents’ peace of mind.',image:'security'},{title:'A private, car-free courtyard',text:'The inner grounds belong to pedestrians, with vehicle movement kept away from places to relax.',image:'aerial'},{title:'A considered layout',text:'Playgrounds, a fountain, pavilions and exercise areas come together in one courtyard.',image:'masterplan'},{title:'Underground parking',text:'A sheltered space for your car, with clear wayfinding and access towards the residential buildings.',image:'parking'},{title:'Controlled access',text:'A smart barrier regulates vehicle access to the development.',image:'entry'},{title:'Lounge and summer kitchen',text:'Separate spaces to unwind, gather with family and share a meal.',image:'lounge'},{title:'Five bespoke pavilions',text:'Private courtyard corners for time with loved ones or a quiet moment.',image:'pavilion'},{title:'A decorative fountain',text:'A central meeting point, surrounded by benches, greenery and garden paths.',image:'fountain'}],
  construction:'Beautiful outside.\nConsidered within.',constructionBody:['Ceramic brick forms the walls, providing a durable base that helps retain warmth and reduce external noise.', 'A ventilated façade combines building protection with a distinct architectural identity. Porcelain stoneware and composite panels finish the development’s light silhouette.'],facade:'The façade.\nLayer by layer.',layerHint:'Choose a layer to explore its role.',layerNote:'Schematic illustration of the ventilated façade system.',
  layers:[{title:'Ceramic brick',text:'M150 ceramic masonry forms the base of the façade system, helping provide thermal and sound insulation.'},{title:'Basalt insulation',text:'Non-combustible boards are fixed with disc dowels and protected by a weather-resistant membrane.'},{title:'Supporting framework',text:'Metal profiles measuring 60 × 40 × 4 mm and 40 × 40 × 4 mm support the exterior cladding.'},{title:'Ventilation gap',text:'A 20–50 mm air gap between insulation and cladding allows air circulation and moisture removal.'},{title:'Exterior cladding',text:'Porcelain stoneware and aluminium composite panels create the exterior protective and decorative surface.'}],
  yard:'Step outside.\nStay in your element.',stories:[{title:'A car-free courtyard',text:'Safe paths, greenery and places to relax replace through traffic. Children play near home while adults enjoy quieter walks.',image:'calm'},{title:'For the whole family',text:'Shared grounds bring together active play, neighbourly meetings, family celebrations and time outdoors.',image:'family'},{title:'Childhood outdoors',text:'Play structures and swings sit inside the private courtyard, with soft surfaces and nearby seating for parents.',image:'playground'},{title:'Movement close to home',text:'Functional outdoor equipment lets you choose your own training pace. Exercise becomes part of everyday life.',image:'workout'},{title:'Walk a little further',text:'Broad paths connect flower beds, planted boulevards and rose arches, turning a short walk into a favourite daily ritual.',image:'alleys'},{title:'Meet by the fountain',text:'A decorative fountain sits at the heart of the courtyard. Benches and the soft sound of water invite conversation and quiet pauses.',image:'fountain'},{title:'Your own quiet pavilion',text:'Five designed pavilions offer a more private setting for family and friends without leaving the grounds.',image:'gazebos'}],
  masterplan:'One courtyard.\nSo many possibilities.',overview:'The whole courtyard',zoneHint:'Explore the courtyard spaces',zones:[{title:'Playgrounds',text:'Space to play and make friends within the private grounds.',image:'playground'},{title:'Central fountain',text:'A calm meeting point with benches around the water.',image:'fountain'},{title:'Pavilions',text:'Five bespoke spaces for private moments outdoors.',image:'gazebos'},{title:'Lounge',text:'A summer kitchen and room to gather with loved ones.',image:'lounge'},{title:'Workout',text:'Outdoor exercise whenever it suits your day.',image:'workout'},{title:'Garden paths',text:'Green routes connecting the courtyard spaces.',image:'alleys'}],
  lounge:'Good evenings\nstart here.',loungeBody:['A lounge with a summer kitchen extends the space of your home. Cook dinner, invite friends or watch a big match together.', 'The project includes separate areas for men and women, providing a comfortable, private atmosphere for family events and gatherings.'],loungePhotos:[{title:'An evening outdoors',text:'Welcoming spaces for family dinners and unhurried conversation.',image:'lounge-outside'},{title:'Around the table',text:'A place for neighbours, friends and family gatherings.',image:'lounge'},{title:'Summer kitchen',text:'Cook together and spend more time with the people you love.',image:'kitchen'},{title:'Matches and shared moments',text:'A communal screen for sporting events and evenings together.',image:'screen'}],community:'Closer to nature.\nCloser to each other.',communityBody:'Shared spaces make room for meeting neighbours, themed evenings and the traditions that turn a building into a community.',hub:'Comfort begins\nat the first step.',services:[{title:'A welcoming entrance',text:'An expressive interior, green marble and carefully chosen materials. The lobby continues the architectural concept with a calm, welcoming atmosphere.',image:'lobby'},{title:'Lifts for everyday life',text:'A passenger lift for daily journeys and a goods lift for furniture, large purchases and moving day. Separate functions make travelling between floors more convenient.',image:'elevators'},{title:'A place for your car',text:'Underground parking with lighting, wayfinding and considered circulation. Leave your car in a sheltered area and head towards the residential buildings.',image:'parking-interior'}],plans:'Room for\nthe life you lead.',plansBody:'Explore every typical layout in our separate catalogue. Compare room counts and floor areas, and see each apartment’s position on the floor.',rooms:['One room','Two rooms','Three rooms'],location:'Qibray District.\nClose to Tashkent.',contact:'Let’s find\nyour next home.',contactBody:'Tell us what you need. We will compare layouts and confirm current pricing and purchase terms.',details:'Explore',previous:'Previous',next:'Next',sections:['The project','Features','Architecture','Courtyard','Lounge','Services','Layouts','Contact'],disclaimer:'Images are project visualisations. Confirm specifications, inclusions and purchase terms with your adviser.',copyright:'Advice and apartment selection by TenCorp.',
};

export const dormonEditorial: Record<DormonLanguage, Editorial> = { ru, uz, en };
