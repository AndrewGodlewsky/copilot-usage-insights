// Names used by the shared chart components.
export const PROVIDER_LABELS = Object.freeze({ copilot: 'GitHub Copilot' });
export function providerLabel(provider, fallback = provider) {
  return Object.hasOwn(PROVIDER_LABELS, provider) ? PROVIDER_LABELS[provider] : fallback;
}
