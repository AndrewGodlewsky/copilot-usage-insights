import { stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function folderCommand(folder, platform = process.platform) {
  if (platform === 'win32') return { file: path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), args: [folder] };
  if (platform === 'darwin') return { file: '/usr/bin/open', args: ['-a', 'Finder', '--', folder] };
  if (platform === 'linux') return { file: 'xdg-open', args: [folder] };
  throw new Error('Opening skill folders is not supported on this operating system.');
}

export function launchFolder(file, args, platform = process.platform) {
  return new Promise((resolve, reject) => {
    // Explorer is the requested GUI; windowsHide can hide the folder window itself.
    const child = spawn(file, args, { shell: false, stdio: 'ignore', windowsHide: platform !== 'win32' });
    child.once('error', reject);
    // Explorer can exit nonzero after successfully handing the folder to an existing window.
    if (platform === 'win32') child.once('spawn', () => { child.unref(); resolve(); });
    else child.once('close', code => code === 0 ? resolve() : reject(new Error('The file manager could not open the recorded folder.')));
  });
}

export async function openSkillFolder(file, { launch = launchFolder } = {}) {
  const local = typeof file === 'string' && (process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(file) : /^\/(?!\/)/.test(file));
  if (!local || /[\x00-\x1f]/.test(file) || !path.isAbsolute(file) || path.basename(file).toLowerCase() !== 'skill.md') {
    throw new TypeError('The recorded skill path is not a local SKILL.md file on this computer.');
  }
  const folder = path.dirname(file);
  try {
    if (!(await stat(file)).isFile()) throw new TypeError('The recorded SKILL.md location is not a file.');
    if (!(await stat(folder)).isDirectory()) throw new TypeError('The recorded skill folder is not a directory.');
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new TypeError('The recorded skill location is no longer available. It may have moved or been removed.');
    throw error;
  }
  const command = folderCommand(folder);
  await launch(command.file, command.args);
}
