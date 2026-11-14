const text = (value, limit = 256) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, limit) : '';
const boolean = value => typeof value === 'boolean' ? value : null;
const statuses = new Set(['connected', 'failed', 'needs-auth', 'pending', 'disabled', 'stopped', 'not_configured']);
const credentialKey = String.raw`(?:(?:access|refresh|auth)[-_]?)?token|password|(?:client[-_]?)?secret|api[-_]?key|authorization|cookie`;
const credentialValue = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)`;
function connectionError(value) {
  if (typeof value !== 'string') return '';
  return text(value.replace(/https?:\/\/[^\s<>"']+/gi, '[server URL]')
    .replace(/\b(authorization|cookie)\s*:\s*[^\r\n]*/gi, '$1: [redacted]')
    .replace(new RegExp(String.raw`(["'])(${credentialKey})\1\s*:\s*${credentialValue}`, 'gi'), '$1$2$1: "[redacted]"')
    .replace(new RegExp(String.raw`--(${credentialKey})(?:=|\s+)${credentialValue}`, 'gi'), '--$1 [redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(new RegExp(String.raw`\b(${credentialKey})\s*[:=]\s*[^\r\n,;]+`, 'gi'), '$1=[redacted]'), 512);
}

export function createIntegrationReader(getSession, { timeoutMs = 3000 } = {}) {
  const pending = new Map();
  async function read(kind, session) {
    const api = kind === 'mcp' ? session?.rpc?.mcp : session?.rpc?.plugins;
    const method = kind === 'mcp' ? 'listConfigured' : 'list';
    const unavailable = { available: false, rows: [], sessionId: session?.sessionId || '' };
    if (typeof api?.[method] !== 'function') return unavailable;
    let timer;
    try {
      if (!pending.has(kind)) {
        const operation = Promise.resolve().then(() => api[method]());
        pending.set(kind, operation);
        operation.then(() => pending.delete(kind), () => pending.delete(kind));
      }
      const result = await Promise.race([pending.get(kind), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Inventory timed out')), timeoutMs);
      })]);
      const entries = result?.[kind === 'mcp' ? 'servers' : 'plugins'];
      if (!Array.isArray(entries)) return unavailable;
      const rows = entries.filter(entry => entry && typeof entry.name === 'string' && entry.name.trim()).map(entry => kind === 'mcp' ? {
        name: entry.name, displayName: text(entry.displayName), enabled: boolean(entry.enabled),
        status: statuses.has(entry.live?.status) ? entry.live.status : 'unavailable',
        source: text(entry.source), plugin: text(entry.sourcePlugin), version: text(entry.sourcePluginVersion),
        toolsLoaded: boolean(entry.live?.toolsLoaded), error: connectionError(entry.live?.error),
      } : {
        name: text(entry.name), version: text(entry.version), marketplace: text(entry.marketplace), source: text(entry.source),
        enabled: boolean(entry.enabled), managed: entry.managed === true, installed: entry.installed !== false,
      });
      return { available: true, rows, sessionId: session.sessionId || '', checkedAt: new Date().toISOString() };
    } catch { return unavailable; }
    finally { clearTimeout(timer); }
  }
  return async () => {
    const session = getSession();
    const [mcp, plugins] = await Promise.all([read('mcp', session), read('plugins', session)]);
    return { mcp, plugins };
  };
}
