import { esc } from './charts.mjs';
import { renderTokenInsight } from './token-insights.mjs';

export const TOKEN_TOPICS = [
  { id: 'overview', label: 'Overview', iconPath: 'M4 19v-6h3v6m4 0V9h3v10m4 0V5h3v14M3 21h19', group: '', question: 'See the overall balance of input and output.' },
  { id: 'context', label: 'Always-loaded context', iconPath: 'm3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4', group: 'Context', question: 'What occupies context before your next request?' },
  { id: 'tools', label: 'Tool and MCP footprint', iconPath: 'M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0ZM12 18v4', group: 'Context', question: 'How much input describes the tools available to the agent?' },
  { id: 'results', label: 'Files, searches, and tool results', iconPath: 'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6m-6 4h6', group: 'Context', question: 'How much material is the agent bringing into the conversation?' },
  { id: 'cache', label: 'Cache reuse', iconPath: 'M20 4v6h-6M4 20v-6h6M5.5 8A7 7 0 0 1 17 5l3 3M4 16l3 3a7 7 0 0 0 11.5-3', group: 'Context', question: 'How much input is reused from cache rather than processed fresh?' },
  { id: 'skills', label: 'Skills and instruction footprint', iconPath: 'M5 3h14v18l-7-4-7 4ZM8 7h8m-8 4h6', group: 'Context', question: 'Which loaded skills or instruction sources occupy context?' },
  { id: 'prompts', label: 'Work behind each prompt', iconPath: 'M4 4h16v12H9l-5 4ZM8 8h8m-8 4h5', group: 'Agent work', question: 'How much recorded work follows one user-submitted message?' },
  { id: 'delegation', label: 'Delegated work', iconPath: 'M12 7v3M5 14v-4h14v4M3 14h4v5H3Zm14 0h4v5h-4ZM10 3h4v4h-4Z', group: 'Agent work', question: 'How much usage happens in subagents?' },
  { id: 'output', label: 'Reasoning and generated output', iconPath: 'm8 6-5 6 5 6m8-12 5 6-5 6m-3-14-2 16', group: 'Agent work', question: 'How much output is reported reasoning, and how much output is generated overall?' },
  { id: 'drivers', label: 'Biggest spend drivers', iconPath: 'M12 3v9h9a9 9 0 1 1-9-9Zm3 0a9 9 0 0 1 6 6h-6Z', group: 'Spending', question: 'Which sessions account for the largest recorded charges?' },
];

export function tokenTopicIcon(topic, framed = false) {
  const glyph = `<path d="${esc(topic.iconPath)}"/>`;
  const frame = '<path d="M10 4H5a1 1 0 0 0-1 1v5m22-6h5a1 1 0 0 1 1 1v5M4 26v5a1 1 0 0 0 1 1h5m22-6v5a1 1 0 0 1-1 1h-5"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${framed ? '36 36' : '24 24'}" fill="none" stroke="${framed ? '#123953' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${framed ? frame + `<g transform="translate(6 6)">${glyph}</g>` : glyph}</svg>`;
}

export const PATTERN_TOPICS = [
  { id: 'findings', label: 'Findings', iconPath: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6M7 10l2 2 4-4', group: '', question: 'Review measured patterns and practical experiments.' },
  { id: 'habits', label: 'Conversation habits', iconPath: 'M3 3h13v10H7l-4 4ZM10 17h7l4 4V9h-2M6 7h7m-7 3h4', group: '', question: 'How do your prompts and conversations relate to the work that follows?' },
  { id: 'growth', label: 'Context growth', iconPath: 'M3 3v18h18M6 16l5-5 4 2 6-8m-5 0h5v5', group: '', question: 'Why do later calls in a conversation process more input?' },
  { id: 'compaction', label: 'Context reduction', iconPath: 'M3 4h18M3 20h18M12 6v4m-3-3 3 3 3-3M12 18v-4m-3 3 3-3 3 3M7 12h10', group: '', question: 'What changes when a conversation is compacted?' },
  { id: 'recovery', label: 'Calls and recovery', iconPath: 'M3 10a9 9 0 1 1 2 8M3 4v6h6m0 3 3 3 5-6', group: '', question: 'Which operations have recorded failures that deserve attention?' },
  { id: 'transitions', label: 'Model and effort changes', iconPath: 'M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4', group: '', question: 'Which models and effort levels are used, and which settings change?' },
  { id: 'repetition', label: 'Repeated exploration', iconPath: 'M8 7h12v14H8ZM16 7V3H4v14h4m3-6h6m-6 4h6', group: '', question: 'Is the agent repeatedly searching or reading the same material?' },
  { id: 'models', label: 'Model comparisons', iconPath: 'M4 4v16h16M7 6h7v3H7Zm0 6h13v3H7Z', group: '', question: 'Compare recorded charges and context use across models.' },
];

export function renderTokenTopic(id, report, formats) {
  if (TOKEN_TOPICS.some(topic => topic.id === id)) return renderTokenInsight(id, report, formats);
  const { number } = formats;
  const metric = (label, value, detail, format = number) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(format(value))}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const note = text => `<p class="footnote">${esc(text)}</p>`;
  const unmeasured = text => `<p class="token-topic-status">Not measured yet</p><p>${esc(text)}</p>`;

  if (id === 'growth') {
    const growth = report.efficiency?.insights?.find(i => i.kind === 'growth');
    if (!growth) return '<p class="muted">No comparable context-growth finding is available for these filters. This does not establish that context stayed small.</p>' + note(`The current comparison needs at least six input measurements, 80% coverage, and a rise of at least 2x and ${number(10000)} tokens within one project, session, model, and call initiator.`);
    return `<p><strong>${esc(growth.sessionName)}</strong> · ${esc(growth.model)}</p>` + metrics(
      metric('Earlier input / call', growth.early, 'Median of the first three measured calls'),
      metric('Later input / call', growth.late, 'Median of the last three measured calls'),
    ) + note(`${number(growth.samples)} of ${number(growth.requests)} calls measured. This is the largest rise meeting the current comparison rules in the selected history. Larger input can be necessary; this is not proof of waste.`);
  }
  if (id === 'compaction') return unmeasured('Before-and-after compaction measurements are not available here yet. Context reductions need recorded compaction boundaries and comparable calls. A lower input count alone does not show what information was retained.');
  if (id === 'transitions') {
    const changes = report.efficiency?.switches, efforts = report.efficiency?.efforts || [];
    if (!changes && !efforts.length) return '<p class="muted">No recorded model or effort measurements for these filters.</p>';
    const n = value => esc(number(value)), credit = value => esc((formats.credits || number)(value));
    const effortName = value => value === 'unknown' ? 'Unknown' : value;
    const switchSummary = changes ? metrics(
      metric('Model changes', changes.modelChanges, 'Explicit changes, excluding no-ops'),
      metric('Effort changes', changes.effortChanges, 'Both old and new levels recorded'),
      metric('Sessions with changes', changes.sessions, `${number(changes.events)} distinct change events`),
      metric('Manual selections', changes.manual, `${number(changes.automatic)} automatic · ${number(changes.unknownSource)} source unknown`),
    ) : '';
    const rows = efforts.map(r => `<tr><td class="text-cell">${esc(r.name)}</td><td>${esc(effortName(r.effort))}</td><td>${n(r.requests)}</td><td title="${n(r.creditRequests)} of ${n(r.requests)} calls have complete charges">${credit(r.credits)}</td><td>${credit(r.averageCredits)}</td><td title="${n(r.reasoningRequests)} of ${n(r.requests)} calls have comparable reasoning and output">${r.reasoningShare == null ? 'Unavailable' : n(r.reasoningShare) + '%'}</td><td title="${n(r.durationRequests)} of ${n(r.requests)} calls have recorded duration">${r.averageDuration == null ? 'Unavailable' : n(r.averageDuration / 1000) + ' s'}</td></tr>`).join('');
    const transitions = (changes?.transitions || []).slice(0, 10).map(r => `<tr><td class="text-cell">${esc(r.fromModel || 'Unknown')} → ${esc(r.toModel || 'Unknown')}</td><td>${esc(effortName(r.fromEffort))} → ${esc(effortName(r.toEffort))}</td><td>${esc({ model_picker: 'Manual', sdk: 'SDK', agent: 'Agent', startup: 'Startup', unknown: 'Unknown' }[r.source])}</td><td>${n(r.count)}</td></tr>`).join('');
    return switchSummary + note('Selected dates and current filters. Model filters include changes touching that model. Manual selections and automatic changes are separate; model and effort changes can occur in the same event. Missing change events are not inferred from request order.') +
      (changes?.omitted ? note(`${number(changes.omitted)} change events omitted because provider attribution is missing or mixed.`) : '') +
      '<h3>Effort by model</h3>' + (rows ? `<div class="table-wrap"><table><thead><tr><th>Model</th><th>Effort</th><th>Model turns</th><th>AI credits</th><th>Credits / turn</th><th>Reasoning / output</th><th>Average duration</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No recorded model calls in these filters.</p>') +
      note('Compare effort within the same model and similar workload. Averages use complete recorded charges, including zero; hover for coverage. Reasoning is part of output. Unknown effort is not a default level. Cost differences do not establish whether changing effort helped.') +
      (transitions ? `<h3>Most frequent recorded changes</h3><div class="table-wrap"><table><thead><tr><th>Model</th><th>Effort</th><th>Source</th><th>Changes</th></tr></thead><tbody>${transitions}</tbody></table></div>` : '') +
      note('Before/after cost and cache comparisons, resumed-session settings and VS Code effort are not measured here yet.');
  }
  if (id === 'repetition') return unmeasured('Repeated searches or file reads are not identified here yet. Calling the same tool several times is not proof of repeating the same work. A useful comparison also needs evidence about what was requested and whether the underlying material changed.');
  return '';
}
