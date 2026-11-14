const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const contextLabel = (value, limit = 160) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, limit) : '';
const contextCategories = ['systemPrompt', 'customInstructions', 'systemTools', 'mcpTools', 'messages'];

function normalizeContext(value) {
  if (value == null) return { available: false, reason: 'empty' };
  if (tokenCount(value.totalTokens) === null || !value.categories || typeof value.categories !== 'object') return { available: false, reason: 'invalid' };
  const entries = (Array.isArray(value.entries) ? value.entries : []).filter(e => e && tokenCount(e.tokens) !== null)
    .map(e => ({ kind: contextLabel(e.kind, 40), id: contextLabel(e.id, 512), label: contextLabel(e.label), tokens: e.tokens,
      ...(typeof e.parentId === 'string' ? { parentId: contextLabel(e.parentId, 512) } : {}) }))
    .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
  return { available: true, totalTokens: value.totalTokens, limit: tokenCount(value.limit),
    categories: Object.fromEntries(contextCategories.map(key => [key, tokenCount(value.categories[key])])),
    entries: entries.slice(0, 100), omitted: Math.max(0, entries.length - 100) };
}

export function createContextReader(getSession, { timeoutMs = 5000 } = {}) {
  let pending;
  return async () => {
    const metadata = getSession()?.rpc?.metadata;
    const checkedAt = new Date().toISOString();
    if (typeof metadata?.getContextAttribution !== 'function') return { available: false, reason: 'unsupported', checkedAt };
    // Keep an unresolved host request single-flight even after the UI timeout.
    if (!pending) {
      const operation = Promise.resolve().then(() => metadata.getContextAttribution())
        .then(result => normalizeContext(result?.contextAttribution))
        .catch(() => ({ available: false, reason: 'unavailable' }))
        .then(result => ({ ...result, checkedAt: new Date().toISOString() }));
      pending = operation;
      operation.finally(() => { if (pending === operation) pending = undefined; });
    }
    let timer;
    try {
      const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve({ available: false, reason: 'timeout' }), timeoutMs); })]);
      return { checkedAt, ...result };
    } finally { clearTimeout(timer); }
  };
}
