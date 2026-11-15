import path from 'node:path';

// WSL aliases share an identity, but paths inside Linux remain case-sensitive.
export function sourceIdentity(value, platform = process.platform) {
  if (platform !== 'win32') return path.posix.normalize(value);
  const normalized = path.win32.normalize(value).replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/[\\]+$/, '');
  const wsl = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(.*)$/i.exec(normalized);
  return wsl ? `\\\\wsl.localhost\\${wsl[1].toLowerCase()}${wsl[2]}` : normalized.toLowerCase();
}
