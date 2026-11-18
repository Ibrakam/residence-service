/** Semantic events contain no values entered into the enquiry form. */
export function notifyWebAnalytics(name: 'form_open' | 'form_success') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tencorp:analytics', { detail: { name, target: 'lead_form' } }));
  }
}
