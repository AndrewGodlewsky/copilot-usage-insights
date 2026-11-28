import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { diagnosticError } from '../core/diagnostics.mjs';
import { sourceIdentity } from './source-paths.mjs';

const execute = promisify(execFile), MAX_DISTROS = 16, MAX_USERS = 64;
const runWsl = async (file, args, options) => (await execute(file, args, options)).stdout;
const absent = error => ['ENOENT', 'ENOTDIR'].includes(error?.code);
const component = name => typeof name === 'string' && name.length > 0 && name.length <= 128
  && name !== '.' && name !== '..' && !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(name);

export function parseWslDistributions(output) {
  const text = Buffer.isBuffer(output) ? output.toString(output.includes(0) ? 'utf16le' : 'utf8') : String(output);
  return [...new Set(text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(component))];
}

// A timed-out UNC read cannot be cancelled in Node. Keep these reads out of the
// dashboard's shared filesystem pool and terminate the helper after every result.
export function createWslDiscovery(options = {}) {
  if (options.run || options.io) return createDirectWslDiscovery(options);
  const { platform = process.platform, timeoutMs = 3000, diagnostics, launch = execute } = options;
  return async ({ disabled = [], signal } = {}) => {
    signal?.throwIfAborted();
    if (platform !== 'win32') return { homes: [], sources: [] };
    const fields = {};
    const discover = async () => {
      try {
        const entry = fileURLToPath(new URL('./wsl-discovery-process.mjs', import.meta.url));
        const embedded = /^(copilot|copilot-runtime)(\.exe)?$/i.test(path.basename(process.execPath));
        const bootstrap = process.argv.find(arg => path.isAbsolute(arg) && path.basename(arg) === 'extension_bootstrap.mjs');
        if (embedded && !bootstrap) throw new Error('Missing absolute extension bootstrap path');
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|COPILOT_SDK_PATH)$/i.test(key)));
        Object.assign(env, { EXTENSION_PATH: entry, COPILOT_EXTENSION_PARENT_PID: String(process.pid), COPILOT_EXTENSION_SANDBOXED: '0', WSL_DISCOVERY_INPUT: JSON.stringify({ disabled, timeoutMs }) });
        const { stdout } = await launch(process.execPath, [embedded ? bootstrap : entry], {
          env, shell: false, windowsHide: true, timeout: timeoutMs * (1 + Math.ceil(MAX_DISTROS / 4)) + 2000,
          killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8', ...(signal ? { signal } : {}),
        });
        const { result, counts } = JSON.parse(stdout);
        if (!Array.isArray(result?.homes) || !Array.isArray(result?.sources)) throw new Error('Invalid discovery response');
        for (const key of ['distributions', 'running', 'homes', 'vscodeHomes', 'unavailable']) if (Number.isFinite(counts?.[key])) fields[key] = counts[key];
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        fields.unavailable = 1;
        return { homes: [], sources: [{ path: 'WSL discovery', state: 'warning', message: 'Could not complete WSL discovery. Check WSL and refresh, or disable WSL discovery in Settings.',
          diagnostic: { ...diagnosticError(error), ...(error.killed ? { errorCode: 'ETIMEDOUT' } : {}) } }] };
      }
    };
    return diagnostics ? diagnostics.measure('wsl.discovery', fields, discover) : discover();
  };
}

// Only filesystem metadata is discovered here. The normal scanner owns all log parsing.
// Production calls this only in the disposable helper; run/io are fixture seams.
export function createDirectWslDiscovery({ platform = process.platform, run = runWsl, io = fs, timeoutMs = 3000, diagnostics } = {}) {
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', process.arch === 'ia32' ? 'Sysnative' : 'System32', 'wsl.exe');
  return async ({ disabled = [] } = {}) => {
    const result = { homes: [], sources: [] };
    if (platform !== 'win32') return result;
    const fields = {};
    async function discover() {
      let installed, running;
      try {
        const options = { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024, encoding: 'buffer' };
        // Let both bounded commands finish before the disposable helper exits.
        const settled = await Promise.allSettled([run(executable, ['--list', '--quiet'], options), run(executable, ['--list', '--running', '--quiet'], options)]);
        const failed = settled.find(item => item.status === 'rejected');
        if (failed) throw failed.reason;
        const lists = settled.map(item => item.value);
        installed = parseWslDistributions(lists[0]).filter(name => !/^docker-desktop(?:-data)?$/i.test(name)).sort();
        running = new Set(parseWslDistributions(lists[1]).map(name => name.toLowerCase()));
      } catch (error) {
        // WSL is optional; its executable is absent on some supported Windows installations.
        if (!absent(error)) {
          fields.unavailable = 1;
          result.sources.push({ path: 'WSL discovery', state: 'warning', message: 'Could not list WSL distributions. Check wsl --list --verbose, or disable WSL discovery in Settings.',
            diagnostic: { ...diagnosticError(error), ...(error.killed ? { errorCode: 'ETIMEDOUT' } : {}), ...(Number.isInteger(error.code) && error.code >= 0 ? { exitCode: error.code } : {}) } });
        }
        return result;
      }
      fields.distributions = installed.length;
      fields.running = installed.filter(name => running.has(name.toLowerCase())).length;
      const disabledIds = new Set(disabled.map(p => sourceIdentity(p, 'win32')));
      const inspect = async name => {
        const root = `\\\\wsl.localhost\\${name}`, found = { homes: [], sources: [], vscodeHomes: [] };
        if (!running.has(name.toLowerCase())) {
          found.sources.push({ path: root, state: 'warning', message: 'WSL distribution is stopped; its history is not included. Start it and refresh to include its Copilot usage.' });
          return found;
        }
        const deadline = Date.now() + timeoutMs;
        const read = async task => {
          const remaining = deadline - Date.now();
          const timeout = () => Object.assign(new Error('WSL discovery timed out'), { code: 'ETIMEDOUT' });
          if (remaining <= 0) throw timeout();
          let timer;
          try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(timeout()), remaining); })]); }
          finally { clearTimeout(timer); }
        };
        let users = [];
        try { users = (await read(() => io.readdir(path.win32.join(root, 'home'), { withFileTypes: true }))).filter(d => d.isDirectory() && component(d.name) && !d.name.startsWith('.')).map(d => d.name).sort(); }
        catch (error) {
          if (!absent(error)) found.sources.push({ path: root, state: 'warning', message: 'Could not inspect WSL home folders. Start the distribution and refresh, or add its Copilot home in Settings.', diagnostic: diagnosticError(error) });
        }
        if (users.length > MAX_USERS) found.sources.push({ path: root, state: 'warning', message: 'WSL home discovery reached its limit. Add any remaining Copilot homes in Settings.' });
        for (const directory of [...users.slice(0, MAX_USERS).map(user => path.win32.join(root, 'home', user)), path.win32.join(root, 'root')]) {
          for (const [subdir, target] of [['.copilot', found.homes], ['.vscode-server/data/User', found.vscodeHomes], ['.vscode-server-insiders/data/User', found.vscodeHomes]]) {
            const home = path.win32.join(directory, subdir);
            if (disabledIds.has(sourceIdentity(home, 'win32'))) { found.sources.push({ path: home, state: 'off', message: '' }); continue; }
            try { if ((await read(() => io.stat(home))).isDirectory()) target.push(home); }
            catch (error) {
              // A non-root WSL user normally cannot inspect /root; that is not an unreadable configured source.
              if (directory === path.win32.join(root, 'root') && ['EACCES', 'EPERM'].includes(error.code)) continue;
              if (!absent(error)) {
                found.sources.push({ path: home, state: 'warning', message: 'Could not inspect this WSL usage folder. Check access inside WSL or add a readable copy in Settings.', diagnostic: diagnosticError(error) });
                if (error.code === 'ETIMEDOUT') break;
              }
            }
          }
          if (Date.now() >= deadline) break;
        }
        if (!found.homes.length && !found.vscodeHomes.length && !found.sources.length) found.sources.push({ path: root, state: 'empty', message: 'No standard Copilot CLI or VS Code Server storage found. Add a custom location in Settings.' });
        return found;
      };
      // Keep source order stable without probing every distribution at once.
      for (let at = 0; at < Math.min(installed.length, MAX_DISTROS); at += 4) {
        for (const found of await Promise.all(installed.slice(at, Math.min(at + 4, MAX_DISTROS)).map(inspect))) {
          result.homes.push(...found.homes); result.sources.push(...found.sources);
          if (found.vscodeHomes.length) (result.vscodeHomes ??= []).push(...found.vscodeHomes);
        }
      }
      if (installed.length > MAX_DISTROS) result.sources.push({ path: 'WSL discovery', state: 'warning', message: 'WSL distribution discovery reached its limit. Add other Copilot homes in Settings.' });
      fields.homes = result.homes.length;
      fields.vscodeHomes = result.vscodeHomes?.length || 0;
      fields.unavailable = result.sources.filter(s => s.state === 'warning').length;
      return result;
    }
    return diagnostics ? diagnostics.measure('wsl.discovery', fields, discover) : discover();
  };
}
