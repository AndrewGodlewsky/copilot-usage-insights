import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sourceEnvironment, sourceIdentity } from './source-paths.mjs';
import { diagnosticError } from '../core/diagnostics.mjs';

const absent = e => ['ENOENT', 'ENOTDIR'].includes(e?.code);
const MAX_WORKSPACES = 2000, MAX_LOGS = 20000;
export function standardVSCodeHomes({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const base = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return ['Code', 'Code - Insiders'].map(name => path.join(base, name, 'User'));
}

export function workspaceInfo(data, fallback) {
  let project = 'VS Code', cwd = '', location = fallback;
  try {
    const uri = new URL(data?.folder || data?.workspace);
    if (uri.protocol === 'file:') cwd = fileURLToPath(uri, { windows: fallback?.environment?.startsWith('wsl:') ? false : undefined });
    else if (uri.protocol === 'vscode-remote:') {
      const authority = decodeURIComponent(uri.host);
      const name = authority.startsWith('wsl+') ? authority.slice(4) : authority;
      if (name && name.length <= 480 && !/[\x00-\x1f\x7f]/.test(name)) location = authority.startsWith('wsl+')
        ? { environment: `wsl:${name.toLowerCase()}`, environmentName: `WSL · ${name}` }
        : { environment: `remote:${name}`, environmentName: `Remote · ${name}` };
      cwd = decodeURIComponent(uri.pathname);
    }
    project = cwd.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/\.code-workspace$/i, '').slice(0, 256) || project;
  } catch { /* Missing workspace metadata does not erase accounting. */ }
  return { project, cwd, ...location };
}

// Discovery uses fixed storage folders; journal reading/caching belongs to the existing scanner.
export function createVSCodeSources({ defaultHomes = standardVSCodeHomes(), platform = process.platform } = {}) {
  const metadata = new Map();
  async function info(workspace, fallback) {
    const file = path.join(workspace, 'workspace.json');
    try {
      const stat = await fs.stat(file), known = metadata.get(file);
      if (known?.size === stat.size && known.mtime === stat.mtimeMs && known.ctime === stat.ctimeMs) return workspaceInfo(known.data, fallback);
      if (!stat.isFile() || stat.size > 16384) return workspaceInfo(null, fallback);
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      // Discard any unrelated metadata, including names and arbitrary payloads.
      const selected = { folder: data.folder, workspace: data.workspace };
      metadata.set(file, { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, data: selected });
      return workspaceInfo(selected, fallback);
    } catch { return workspaceInfo(null, fallback); }
  }
  return async ({ homes = [], extraHomes = [], include = true, disabled = [], cliSessions = new Set(), readJournal, force = false }) => {
    const sources = [], snapshots = [], owners = [], files = [], identities = new Set();
    const disabledIds = new Set(disabled.map(p => sourceIdentity(p, platform)));
    const roots = [...(include ? [...defaultHomes, ...homes] : []), ...extraHomes];
    let logs = 0;
    for (const root of roots) {
      const identity = sourceIdentity(root, platform);
      if (identities.has(identity)) continue;
      identities.add(identity);
      const location = sourceEnvironment(root, platform), rootSource = { path: root, kind: 'vscode', ...location, files: 0, records: 0, state: 'empty', message: '' };
      if (disabledIds.has(identity)) { sources.push({ ...rootSource, state: 'off' }); continue; }
      let profiles = [];
      try { if (!(await fs.stat(root)).isDirectory()) continue; }
      catch (error) { if (!absent(error) || extraHomes.includes(root)) sources.push({ ...rootSource, state: 'warning', message: 'VS Code User storage is unavailable.', diagnostic: diagnosticError(error) }); continue; }
      const warning = error => { rootSource.state = 'warning'; rootSource.message = 'Some VS Code storage could not be read; available histories are included.'; rootSource.diagnostic = diagnosticError(error); };
      const dirs = async dir => { try { return (await fs.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory() && !d.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)); } catch (error) { if (!absent(error)) warning(error); return []; } };
      profiles = await dirs(path.join(root, 'profiles'));
      if (profiles.length > 50) { rootSource.state = 'warning'; rootSource.message = 'VS Code profile discovery reached its limit.'; }
      const candidates = [], bases = [root, ...profiles.slice(0, 50).map(d => path.join(root, 'profiles', d.name))];
      for (const base of bases) {
        candidates.push({ dir: path.join(base, 'globalStorage', 'github.copilot-chat', 'debug-logs'), ...workspaceInfo(null, location) });
        const workspaces = await dirs(path.join(base, 'workspaceStorage'));
        if (workspaces.length > MAX_WORKSPACES) { rootSource.state = 'warning'; rootSource.message = 'VS Code workspace discovery reached its limit.'; }
        for (const w of workspaces.slice(0, MAX_WORKSPACES)) {
          const workspace = path.join(base, 'workspaceStorage', w.name);
          candidates.push({ dir: path.join(workspace, 'github.copilot-chat', 'debug-logs'), ...await info(workspace, location) });
        }
      }
      let found = false;
      for (const candidate of candidates) {
        if (disabledIds.has(sourceIdentity(candidate.dir, platform))) {
          found = true;
          sources.push({ path: candidate.dir, kind: 'vscode', environment: candidate.environment, environmentName: candidate.environmentName, files: 0, records: 0, state: 'off', message: '' });
          continue;
        }
        const sessionDirs = await dirs(candidate.dir);
        if (!sessionDirs.length) continue;
        found = true;
        const source = { path: candidate.dir, kind: 'vscode', environment: candidate.environment, environmentName: candidate.environmentName, files: 0, records: 0, state: 'ok', message: '' };
        sources.push(source);
        for (const session of sessionDirs) {
          // VS Code also logs CLI sessions; the richer CLI journal owns the entire session.
          if (cliSessions.has(session.name)) { source.message = 'Overlapping CLI sessions use their CLI receipts.'; continue; }
          const directory = path.join(candidate.dir, session.name);
          let entries;
          try { entries = (await fs.readdir(directory, { withFileTypes: true })).filter(d => d.isFile() && d.name.endsWith('.jsonl')).sort((a, b) => a.name.localeCompare(b.name)); }
          catch (error) { source.state = 'warning'; source.message = 'A VS Code debug session could not be read.'; source.diagnostic = diagnosticError(error); continue; }
          for (const entry of entries) {
            if (++logs > MAX_LOGS) { source.state = 'warning'; source.message = 'VS Code log discovery reached its limit.'; break; }
            const file = path.join(directory, entry.name);
            try {
              const stat = await fs.stat(file);
              const snapshot = await readJournal(file, stat, candidate.dir, session.name, force, { format: 'vscode', project: candidate.project, cwd: candidate.cwd, environment: candidate.environment });
              files.push(file); snapshots.push(snapshot); owners.push(source); source.files++;
              if (snapshot.unclassified || snapshot.invalid) { source.state = 'warning'; source.message = 'Some VS Code calls lack valid recorded Copilot charges or have conflicting data and were excluded.'; }
            } catch (error) { source.state = 'warning'; source.message = 'A VS Code debug log could not be read.'; source.diagnostic = diagnosticError(error); }
          }
          if (logs > MAX_LOGS) break;
        }
        if (logs > MAX_LOGS) break;
      }
      if (!found || rootSource.state === 'warning') {
        if (!rootSource.message) rootSource.message = 'No retained VS Code Copilot debug logs found. See README for logging setup; ordinary saved chats do not contain reliable accounting.';
        sources.push(rootSource);
      }
    }
    return { sources, snapshots, owners, files };
  };
}
