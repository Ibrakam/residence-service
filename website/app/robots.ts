import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://form.tencorp.uz').replace(/\/+$/, '');
  return { rules: { userAgent: '*', allow: `${appBasePath}/` }, sitemap: `${origin}${appBasePath}/sitemap.xml` };
}
