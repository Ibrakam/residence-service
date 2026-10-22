// Explicit authenticated production route; nginx no longer serves the August static snapshot.
export const metadata = {
  openGraph: { images: ['/avalon-assets/avalon-city.webp'] },
  twitter: { images: ['/avalon-assets/avalon-city.webp'] },
};
export { default } from '../page';
