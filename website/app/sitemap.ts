import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://form.tencorp.uz').replace(/\/+$/, '');
  const base = `${origin}${appBasePath}`;
  const routes = ['', '/privacy'];
  const regularRoutes: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${base}${route}`,
    changeFrequency: route.includes('apartments') ? 'daily' : 'weekly',
    priority: route === '' ? 1 : .6,
  }));

  const projects = ['mirador', 'ofiyat', 'meros', 'sado', 'flagman', '4u', 'voha', 'maftun-makon', 'botanika-saroyi', 'bayterak', 'zamon', 'yangibaxt', 'jomiy', 'regnum-plaza', 'sun'];
  const projectRoutes = projects.flatMap((project) => [`/${project}`, `/${project}/apartments`]);
  const localizedProjectRoutes: MetadataRoute.Sitemap = projectRoutes.flatMap((route) => (
    (['ru', 'uz', 'en'] as const).map((language) => ({
      url: `${base}${route}?lang=${language}`,
      changeFrequency: route.includes('apartments') ? 'daily' as const : 'weekly' as const,
      priority: route.includes('apartments') ? .9 : 1,
      alternates: {
        languages: {
          'ru-RU': `${base}${route}?lang=ru`,
          'uz-UZ': `${base}${route}?lang=uz`,
          en: `${base}${route}?lang=en`,
          'x-default': `${base}${route}?lang=ru`,
        },
      },
    }))
  ));

  return [...regularRoutes, ...localizedProjectRoutes];
}
