import { redirect } from 'next/navigation';
import { attributionQuery, catalogHref, catalogLanguage, catalogPath, type CatalogQuery } from '../plan-catalog-data';

export default async function Page({ searchParams }: { searchParams?: Promise<CatalogQuery> }) {
  const query = (await searchParams) ?? {};
  redirect(catalogHref(catalogPath, catalogLanguage(query), attributionQuery(query)));
}
