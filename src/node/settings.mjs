import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const DEFAULT_REVIEW_MODEL = 'claude-sonnet-5.5';

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
    if (key === 'reviewReasoning') {
      if (!['default', 'medium', 'high'].includes(value)) throw new TypeError('Choose model default, medium, or high reasoning');
      result[key] = value;
      continue;
    }
    if (key === 'reviewModel') {
      if (typeof value !== 'string' || value.length > 128 || value && !/^[a-z0-9][a-z0-9._:+/-]*$/i.test(value)) throw new TypeError('Choose a valid Copilot review model');
      result.reviewModel = value;
      continue;
    }
    if (key === 'paused' || key === 'simplifyNumbers' || key === 'includeWsl' || key === 'readWslDatabases' || key === 'includeVSCode' || key === 'reviewAllowSamples') {
      if (typeof value !== 'boolean') throw new TypeError(`${key} must be a boolean`);
      result[key] = value;
      continue;
    }
    if (key === 'textSize') {
      if (!['small', 'medium', 'large'].includes(value)) throw new TypeError('textSize must be small, medium, or large');
      result.textSize = value;
      continue;
    }
    if (!['extraHomes', 'disabledHomes', 'extraVSCodeHomes'].includes(key)) throw new TypeError(`Unknown setting: ${key}`);
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
  const pauseFile = path.join(dir, 'pause.json');
  let queue = Promise.resolve();
  const defaults = (saved = {}) => ({ extraHomes: [], disabledHomes: [], extraVSCodeHomes: [], textSize: 'small', simplifyNumbers: true, paused: false,
    includeWsl: true, readWslDatabases: true, includeVSCode: true, reviewAllowSamples: true,
    // Keep the legacy effort selection for a previously chosen different model.
    ...(!saved.reviewModel || saved.reviewModel === DEFAULT_REVIEW_MODEL ? { reviewReasoning: 'high' } : {}),
    ...saved, reviewModel: saved.reviewModel || DEFAULT_REVIEW_MODEL });
  async function get() {
    let saved;
    try { saved = defaults(validate(JSON.parse(await fs.readFile(file, 'utf8')))); }
    catch (e) { if (e.code === 'ENOENT') saved = defaults(); else throw new Error('Cannot read saved settings file; check settings.json for valid JSON.'); }
    try {
      const paused = JSON.parse(await fs.readFile(pauseFile, 'utf8'));
      if (typeof paused !== 'boolean') throw new TypeError('Pause state must be a boolean');
      return { ...saved, paused };
    } catch (e) { if (e.code === 'ENOENT') return saved; throw new Error('Cannot read saved pause state; check pause.json for a valid boolean.'); }
  }
  async function write(target, value) {
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(temp, target); }
    finally { await fs.rm(temp, { force: true }); }
  }
  return {
    get,
    set(input) {
      const next = queue.then(async () => {
        const update = validate(input), value = { ...await get(), ...update };
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const changesPause = Object.hasOwn(update, 'paused');
        if (!changesPause || Object.keys(update).length > 1) await write(file, value);
        // A separate atomic value prevents another canvas/process's older general
        // settings write from silently undoing an explicit pause or resume.
        if (changesPause) await write(pauseFile, update.paused);
        return get();
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
