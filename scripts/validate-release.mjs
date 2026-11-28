import { readFileSync } from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+$/;
const MAX_SUMMARY_LENGTH = 400;

export function validateRelease(read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')) {
  const pkg = JSON.parse(read('package.json'));
  const version = pkg?.version;
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`Invalid package.json version (${version}): expected 3-part MAJOR.MINOR.PATCH`);
  }

  const plugin = JSON.parse(read('plugin.json'));
  const marketplace = JSON.parse(read('.github/plugin/marketplace.json'));
  const extensionPkg = JSON.parse(read('com.github.copilot/extensions/usage-insights/package.json'));
  const marketEntry = marketplace?.plugins?.find(p => p.name === plugin.name);

  const manifests = [
    ['plugin.json', plugin?.version],
    ['.github/plugin/marketplace.json', marketEntry?.version],
    ['com.github.copilot/extensions/usage-insights/package.json', extensionPkg?.version],
  ];
  for (const [file, found] of manifests) {
    if (found !== version) {
      throw new Error(`Version mismatch: ${file} has ${found ?? 'missing'}, expected ${version} (matching package.json)`);
    }
  }

  const releaseNotes = JSON.parse(read('release-notes.json'));
  if (!Array.isArray(releaseNotes) || releaseNotes[0]?.version !== version) {
    throw new Error(`Add release notes for ${version} at the top of release-notes.json`);
  }
  const seen = new Set();
  for (const entry of releaseNotes) {
    if (!entry || typeof entry.version !== 'string' || !SEMVER.test(entry.version)) {
      throw new Error(`Invalid release-notes.json version: ${entry?.version}`);
    }
    if (seen.has(entry.version)) throw new Error(`Duplicate version in release-notes.json: ${entry.version}`);
    seen.add(entry.version);
    if (typeof entry.summary !== 'string' || !entry.summary.trim()) {
      throw new Error(`Missing summary in release-notes.json for ${entry.version}`);
    }
    if (/[\r\n]/.test(entry.summary)) {
      throw new Error(`Release note summary for ${entry.version} must be a single paragraph`);
    }
    if (entry.summary.length > MAX_SUMMARY_LENGTH) {
      throw new Error(`Release note summary for ${entry.version} exceeds ${MAX_SUMMARY_LENGTH} characters (${entry.summary.length})`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes(`Version **${version}**`)) {
    throw new Error(`README.md update paragraph must mention Version **${version}**`);
  }

  return { version, releaseNotes };
}
