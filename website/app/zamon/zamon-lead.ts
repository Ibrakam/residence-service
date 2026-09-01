export function zamonLeadSubmitUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const basePath = configured ? `/${configured.replace(/^\/+|\/+$/g, '')}` : '';

  // The same-origin receipt endpoint exists only so local development and tests can
  // exercise the complete form contract without transmitting personal data.
  if (process.env.NODE_ENV !== 'production') {
    return `${basePath}/api/zamon-lead`;
  }

  return `${basePath}/v1/leads`;
}
