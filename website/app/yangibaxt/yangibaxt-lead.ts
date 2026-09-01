export function yangiBaxtLeadSubmitUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const basePath = configured ? `/${configured.replace(/^\/+|\/+$/g, '')}` : '';
  if (process.env.NODE_ENV !== 'production') {
    return `${basePath}/api/yangibaxt-lead`;
  }
  return `${basePath}/v1/leads`;
}
