import type { Metadata, Viewport } from 'next';
import { Golos_Text, Prata } from 'next/font/google';
import './globals.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

const golos = Golos_Text({
  variable: '--font-ui',
  subsets: ['cyrillic', 'latin'],
  weight: 'variable',
});

const prata = Prata({
  variable: '--font-display',
  subsets: ['cyrillic', 'latin'],
  weight: '400',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://form.tencorp.uz'),
  title: 'AVALON RESIDENCE — квартиры в Ташкенте',
  description: 'AVALON RESIDENCE — жилой комплекс класса комфорт+ рядом со станцией метро Тузель.',
  openGraph: {
    title: 'AVALON RESIDENCE — жизнь в ритме города',
    description: 'Интерактивный выбор квартир в жилом комплексе комфорт+ рядом с метро Тузель.',
    images: [`${appBasePath}/avalon-city.webp`],
    locale: 'ru_RU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AVALON RESIDENCE — жизнь в ритме города',
    description: 'Жилой комплекс комфорт+ рядом с метро Тузель.',
    images: [`${appBasePath}/avalon-city.webp`],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#102022',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={`${golos.variable} ${prata.variable}`}>{children}</body>
    </html>
  );
}
