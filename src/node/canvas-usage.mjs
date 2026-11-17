// Loaded only when a usage endpoint needs history, after the canvas shell is available.
import { createScanner } from './copilot-source.mjs';
import { createWslDiscovery } from './wsl-sources.mjs';
import { createVSCodeSources } from './vscode-sources.mjs';
import { enhancePromptUsageHome, reviewUsageHome } from './settings.mjs';
export { buildReport, buildRequestPage, buildModelSessionPage, buildModelProjectPage, buildSessionModels } from '../core/copilot-report.mjs';
export { readRequestPrompts } from './request-prompts.mjs';
export { addInstalledSkillVersions } from './skill-version.mjs';

export function createCanvasScanner({ diagnostics, signal }) {
  return createScanner({ optionalHomes: [enhancePromptUsageHome(), reviewUsageHome()],
    discoverWsl: createWslDiscovery({ diagnostics }), discoverVSCode: createVSCodeSources(), diagnostics, signal });
}
