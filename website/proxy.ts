import { type NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const requestedLanguage = request.nextUrl.searchParams.get('lang');
  const language = requestedLanguage === 'uz' || requestedLanguage === 'en' ? requestedLanguage : 'ru';
  requestHeaders.set('x-document-language', language);
  requestHeaders.set('x-jomiy-document-language', language);
  requestHeaders.set('x-jomiy-evaluation-time', String(Date.now()));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Run only for document routes so the root layout receives the requested
  // language during SSR. Static media and API routes stay outside the proxy.
  matcher: [
    '/',
    '/4u/:path*',
    '/bayterak/:path*',
    '/botanika-saroyi/:path*',
    '/flagman/:path*',
    '/jomiy/:path*',
    '/maftun-makon/:path*',
    '/meros/:path*',
    '/mirador/:path*',
    '/ofiyat/:path*',
    '/privacy',
    '/regnum-plaza/:path*',
    '/sado/:path*',
    '/sun/:path*',
    '/voha/:path*',
    '/yangibaxt/:path*',
    '/zamon/:path*',
  ],
};
