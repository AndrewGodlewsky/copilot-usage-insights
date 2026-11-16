// Public identity allowlist, not a price list. Exact IDs only; no suffix removal or label matching.
// Sources and extension procedure: docs/model-reference.md.
export const publicModelLabels = Object.freeze({
  'gpt-4.1': 'GPT-4.1', 'gpt-5': 'GPT-5', 'claude-sonnet-4': 'Claude Sonnet 4',
  'gpt-5.3-codex': 'GPT-5.3-Codex', 'gpt-5.4-nano': 'GPT-5.4 nano',
  'gpt-5.6-luna': 'GPT-5.6 Luna', 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-6-astra': 'GPT-6 Astra', 'gpt-6-luna': 'GPT-6 Luna', 'gpt-6-sol': 'GPT-6 Sol',
  'claude-haiku-4.5': 'Claude Haiku 4.5', 'claude-haiku-5.5': 'Claude Haiku 5.5',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5', 'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-sonnet-5': 'Claude Sonnet 5', 'claude-sonnet-5.5': 'Claude Sonnet 5.5',
  'claude-opus-4.6': 'Claude Opus 4.6', 'claude-opus-4.7': 'Claude Opus 4.7', 'claude-opus-4.8': 'Claude Opus 4.8',
  'claude-opus-5': 'Claude Opus 5', 'claude-opus-5.5': 'Claude Opus 5.5',
});
export function publicModelId(id) { return typeof id === 'string' && Object.hasOwn(publicModelLabels, id) ? id : null; }
