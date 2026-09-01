export function maftunLeadSubmitUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const basePath = configured ? `/${configured.replace(/^\/+|\/+$/g, '')}` : '';
  return `${basePath}/v1/leads`;
}
