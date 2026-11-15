import { open, stat } from 'node:fs/promises';
import { load, CORE_SCHEMA } from '../vendor/js-yaml/js-yaml.mjs';
import { isLocalSkillFilePath } from './skill-folder.mjs';

const MAX_HEADER_BYTES = 64 * 1024, MAX_REMEMBERED = 512;
// A skill file's version is reread only when the file's size or timestamps change.
const remembered = new Map();
const result = (status, value = null) => ({ value, status });
const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseSkillVersion(source) {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(source);
  if (!opening) return result('not-declared');
  const rest = source.slice(opening[0].length), closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return result('unavailable');
  const header = rest.slice(0, closing.index);
  if (!header.trim()) return result('not-declared');
  try {
    const data = load(header, { schema: CORE_SCHEMA, maxDepth: 20, maxAliases: 50 });
    if (!mapping(data)) return result('unavailable');
    if (!Object.hasOwn(data, 'metadata')) return result('not-declared');
    const metadata = data.metadata;
    if (!mapping(metadata)) return result('unavailable');
    if (!Object.hasOwn(metadata, 'version')) return result('not-declared');
    const version = metadata.version;
    if (typeof version !== 'string' || version.length > 256 || /[\x00-\x1f\x7f]/.test(version)) return result('unavailable');
    return version.trim() ? result('available', version.trim()) : result('not-declared');
  } catch { return result('unavailable'); }
}

export async function readInstalledSkillVersion(file) {
  if (!isLocalSkillFilePath(file)) return result('unavailable');
  let handle;
  try {
    const found = await stat(file);
    if (!found.isFile()) return result('unavailable');
    const known = remembered.get(file);
    if (known && known.size === found.size && known.mtime === found.mtimeMs && known.ctime === found.ctimeMs) return { ...known.version };
    handle = await open(file, 'r');
    // Read only a bounded prefix; retain the version, never the skill instructions.
    const buffer = Buffer.allocUnsafe(MAX_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const version = parseSkillVersion(buffer.toString('utf8', 0, bytesRead));
    if (remembered.size >= MAX_REMEMBERED) remembered.clear();
    remembered.set(file, { size: found.size, mtime: found.mtimeMs, ctime: found.ctimeMs, version: { ...version } });
    return version;
  } catch { remembered.delete(file); return result('unavailable'); }
  finally { await handle?.close(); }
}

export async function addInstalledSkillVersions(rows) {
  const versions = new Map();
  for (const row of rows) if (!versions.has(row.path)) versions.set(row.path, null);
  await Promise.all([...versions.keys()].map(async file => versions.set(file, await readInstalledSkillVersion(file))));
  for (const row of rows) row.installedVersion = versions.get(row.path);
}
