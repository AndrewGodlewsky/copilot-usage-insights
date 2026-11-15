import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const copilotHome = () => path.resolve(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'));
export const enhancePromptUsageHome = () => path.resolve(process.env.ENHANCE_PROMPT_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'copilot-enhance-prompt'), 'usage');
export const reviewUsageHome = () => path.resolve(process.env.USAGE_INSIGHTS_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'copilot-usage-insights'), 'usage');
export function configDir() {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'copilot-usage-insights');
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Settings must be an object');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'reviewModel') {
      if (typeof value !== 'string' || value.length > 128 || value && !/^[a-z0-9][a-z0-9._:+/-]*$/i.test(value)) throw new TypeError('Choose a valid Copilot review model');
      result.reviewModel = value;
      continue;
    }
    if (key === 'simplifyNumbers' || key === 'includeWsl') {
      if (typeof value !== 'boolean') throw new TypeError(`${key} must be a boolean`);
      result[key] = value;
      continue;
    }
    if (key === 'textSize') {
      if (!['small', 'medium', 'large'].includes(value)) throw new TypeError('textSize must be small, medium, or large');
      result.textSize = value;
      continue;
    }
    if (!['extraHomes', 'disabledHomes'].includes(key)) throw new TypeError(`Unknown setting: ${key}`);
    if (!Array.isArray(value) || value.length > 50 || !value.every(p => typeof p === 'string' && p.length <= 4096 && !p.includes('\0'))) throw new TypeError(`${key} must be a list of at most 50 paths`);
    result[key] = [...new Set(value.map(p => {
      const expanded = p === '~' ? os.homedir() : /^~[\\/]/.test(p) ? path.join(os.homedir(), p.slice(2)) : p;
      if (!path.isAbsolute(expanded)) throw new TypeError('Copilot home paths must be absolute or start with ~/');
      return path.normalize(expanded);
    }))];
  }
  return result;
}
export function createSettings(dir = configDir()) {
  const file = path.join(dir, 'settings.json');
  let queue = Promise.resolve();
  async function get() {
    try { return { extraHomes: [], disabledHomes: [], textSize: 'small', simplifyNumbers: true, includeWsl: true, ...validate(JSON.parse(await fs.readFile(file, 'utf8'))) }; }
    catch (e) { if (e.code === 'ENOENT') return { extraHomes: [], disabledHomes: [], textSize: 'small', simplifyNumbers: true, includeWsl: true }; throw new Error(`Cannot read settings at ${file}: ${e.message}`); }
  }
  return {
    get,
    set(input) {
      const next = queue.then(async () => {
        const update = validate(input), value = { ...await get(), ...update };
        await fs.mkdir(dir, { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(temp, file); }
        finally { await fs.rm(temp, { force: true }); }
        return value;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
