import path from 'node:path';

export function isLocalSkillFilePath(file) {
  const local = typeof file === 'string' && (process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(file) : /^\/(?!\/)/.test(file));
  return !!local && !/[\x00-\x1f]/.test(file) && path.isAbsolute(file) && path.basename(file).toLowerCase() === 'skill.md';
}
