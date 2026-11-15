import path from 'node:path';

// WSL aliases share an identity, but paths inside Linux remain case-sensitive.
export function sourceIdentity(value, platform = process.platform) {
  if (platform !== 'win32') return path.posix.normalize(value);
  const normalized = path.win32.normalize(value).replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/[\\]+$/, '');
  const wsl = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(.*)$/i.exec(normalized);
  return wsl ? `\\\\wsl.localhost\\${wsl[1].toLowerCase()}${wsl[2]}` : normalized.toLowerCase();
}

export function sourceEnvironment(value, platform = process.platform) {
  const wsl = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)/i.exec(path.win32.normalize(value).replace(/^\\\\\?\\UNC\\/i, '\\\\'));
  if (wsl) return { environment: `wsl:${wsl[1].toLowerCase()}`, environmentName: `WSL · ${wsl[1]}` };
  return { environment: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux', environmentName: platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux' };
}
