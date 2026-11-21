import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { formatNumber, formatCredits } from '../src/core/format.mjs';
import { demoData, demoContext } from '../scripts/demo-data.mjs';

// Plain digits, one decimal for shares, so expectations do not depend on the machine's locale.
const formats = { number: (value, options) => value == null ? 'Unavailable' : String(options?.maximumFractionDigits === 1 ? Math.round(value * 10) / 10 : value), credits: String };
const render = (report, context) => renderTokenTopic('skills', report, { ...formats, context });
const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const count = (html, pattern) => (html.match(pattern) || []).length;
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const row = (name, triggers, extra = {}) => ({ name, plugin: '', version: '', invocations: Object.values(triggers).reduce((sum, n) => sum + n, 0), failures: 0,
  triggers: { manual: 0, agent: 0, preloaded: 0, unknown: 0, ...triggers }, sessions: 1, projects: 1, lastUsed: '2026-11-13T12:00:00.000Z', ...extra });
const skillsOf = (rows, extra = {}) => ({ rows, invocations: rows.reduce((sum, r) => sum + r.invocations, 0), failures: rows.reduce((sum, r) => sum + (r.failures || 0), 0),
  sessions: 3, omitted: 0, omittedFailures: 0, unattributedUses: 0, unattributedFailures: 0, ...extra });
const snapshot = (entries, extra = {}) => ({ available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 10000, modelId: 'model-a',
  categories: { systemPrompt: 500, customInstructions: 300, systemTools: 900, mcpTools: 200, messages: 8100 }, entries, omitted: 0, ...extra });
const entry = (kind, label, tokens, parentId) => ({ kind, id: `${kind}:${label}`, label, tokens, ...(parentId ? { parentId } : {}) });

test('the load split adds every skill and each table row repeats it for one skill', () => {
  const rows = [
    row('review', { preloaded: 6, agent: 2 }, { plugin: 'team-tools', sessions: 5, projects: 2, failures: 1, lastUsed: '2026-11-12T12:00:00.000Z' }),
    row('testing', { agent: 3, manual: 1 }, { sessions: 4, projects: 3 }),
    row('notes', { manual: 2, unknown: 1 }),
  ];
  const html = render({ skills: skillsOf(rows, { sessions: 7 }), totals: { sessions: 12 } }), text = plain(html);
  assert.match(html, /aria-label="Preloaded at start: 40%; Invoked by the agent: 33.3%; Invoked by you: 20%; Not recorded: 6.7%"/);
  for (const legend of ['Preloaded at start <b>6</b> · 40%', 'Invoked by the agent <b>5</b> · 33.3%', 'Invoked by you <b>3</b> · 20%', 'Not recorded <b>1</b> · 6.7%']) assert.ok(html.includes(legend), legend);
  assert.match(text, /Skill Source plugin Uses How it was loaded Conversations Projects Last used Failed loads/);
  // Most common way first, with the bar in a fixed order so rows can be compared.
  assert.match(text, new RegExp(`review team-tools 8 6 preloaded, 2 by the agent 5 2 ${day('2026-11-12T12:00:00.000Z')} 1 `));
  assert.match(text, /testing None recorded 4 3 by the agent, 1 by you 4 3 /);
  assert.match(text, /notes None recorded 3 2 by you, 1 not recorded 1 1 /);
  assert.ok(html.includes('<i style="width:75.0%;background:var(--s4)"></i><i style="width:25.0%;background:var(--s1)"></i>'));
  assert.doesNotMatch(html, /2026-11-12T|Invalid Date/);
  assert.match(text, /Recorded skill uses 15 /);
  assert.match(text, /Skills used 3 Different skills with at least one recorded use/);
  assert.match(text, /Failed skill loads 1 /);
  assert.match(text, /Showing 3 of 3 skills with recorded activity, most used first\./);
  assert.match(text, /6 of 15 recorded skill uses \(40%\) were preloaded at the start of a conversation\./);
  assert.match(text, /No skill was preloaded more often than review: 6 of its 8 recorded uses\./);
  assert.match(text, /Compare afterward: a new context snapshot/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('reach is a count, with conversations that had model calls beside it only when the two are comparable', () => {
  const skills = skillsOf([row('review', { agent: 2 })], { sessions: 7 });
  const reach = report => plain(render(report)).match(/Conversations with skill activity (.*?) Failed skill loads/)[1];
  assert.equal(reach({ skills, totals: { sessions: 12 } }), '7 At least one recorded use or failed load. For scale, 12 conversations had model calls in this view.');
  assert.equal(reach({ skills: { ...skills, sessions: 1 }, totals: { sessions: 1 } }), '1 At least one recorded use or failed load. For scale, 1 conversation had model calls in this view.');
  // Skill activity ignores the model filter, so a model-filtered count is not its scale.
  assert.equal(reach({ skills, totals: { sessions: 12 }, query: { models: ['model-a'] } }), '7 At least one recorded use or failed load. The model filter does not apply here.');
  for (const report of [{ skills, totals: {} }, { skills }, { skills, totals: { sessions: 6 } }, { skills: { ...skills, unattributedUses: 1 }, totals: { sessions: 12 } },
    { skills: { ...skills, unattributedFailures: 1 }, totals: { sessions: 12 } }, { skills: { ...skills, unattributedUses: undefined }, totals: { sessions: 12 } }]) {
    assert.equal(reach(report), '7 At least one recorded use or failed load.');
  }
  assert.equal(reach({ skills: { ...skills, sessions: undefined }, totals: { sessions: 12 } }), 'Unavailable At least one recorded use or failed load.');
  // A share would need a matched denominator, which the report does not carry.
  assert.doesNotMatch(plain(render({ skills, totals: { sessions: 12 } })), /7 of 12|58\.3%/);
});

test('the table keeps five rows, most used first, while the split still covers every skill', () => {
  const rows = [3, 9, 1, 7, 9, 5, 2].map((uses, index) => row(`skill-${index}`, { agent: uses }));
  const html = render({ skills: skillsOf(rows) }), text = plain(html);
  assert.equal(count(html, /<tr>/g), 6);
  assert.deepEqual(text.match(/skill-\d(?= None recorded)/g), ['skill-1', 'skill-4', 'skill-3', 'skill-5', 'skill-0']);
  assert.match(text, /Showing 5 of 7 skills with recorded activity/);
  assert.ok(html.includes('Invoked by the agent <b>36</b> · 100%'));
  assert.match(text, /Skills used 7 /);
});

test('missing skill data stays unavailable and recorded zeros stay zero', () => {
  const absent = render({}), none = render({ skills: skillsOf([], { sessions: 0 }) });
  for (const label of ['Recorded skill uses', 'Skills used', 'Conversations with skill activity', 'Failed skill loads']) {
    assert.ok(absent.includes(`${label}</span><strong class="value">Unavailable</strong>`), label);
    assert.ok(none.includes(`${label}</span><strong class="value">0</strong>`), label);
  }
  assert.match(plain(absent), /Skill activity is not available for this view\./);
  assert.match(plain(none), /No skill uses or failed loads were recorded in this view\. Try a wider date range or fewer filters\./);
  for (const html of [absent, none]) {
    assert.match(html, /No skill uses or failed loads match these filters\./);
    assert.doesNotMatch(html, /role="img"|How skills were loaded|<table|NaN|undefined|Infinity/);
    assert.match(html, /Compare afterward:/);
    assert.match(html, /ignores the model filter/);
    assert.match(html, /do not price a skill/);
  }
  // Without a report there are no counts to describe, so none are claimed.
  assert.doesNotMatch(absent, /unverified provider|left out/);
  assert.match(none, /No uses or failed loads are included with an unverified provider\. None were left out for rejected or mixed billing-provider evidence\./);
});

test('partial rows keep unknown values unknown instead of turning them into zeros', () => {
  const rows = [{ name: 'bare', invocations: 4 }, row('part', {}, { invocations: 5, triggers: { agent: 2 }, sessions: null, projects: undefined, failures: null, lastUsed: 'not a date' })];
  const html = render({ skills: { rows, invocations: 9, failures: null } }), text = plain(html);
  // A use with no recorded trigger is "not recorded", never counted as another kind of load.
  assert.match(text, /part None recorded 5 3 not recorded, 2 by the agent Unavailable Unavailable Unavailable Unavailable /);
  assert.match(text, /bare None recorded 4 4 not recorded Unavailable Unavailable Unavailable Unavailable /);
  assert.ok(html.includes('Not recorded <b>7</b> · 77.8%'));
  assert.ok(html.includes('Failed skill loads</span><strong class="value">Unavailable</strong>'));
  assert.match(text, /How many uses had an unverified provider, or were left out for rejected or mixed billing-provider evidence, is unavailable for this view\./);
  assert.doesNotMatch(text, /No uses or failed loads are included|None were left out|For scale/);
  assert.match(text, /How the skill was loaded was not recorded for 7 of 9 skill uses\./);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|Invalid Date/);
});

test('the caveats keep every boundary in three short sentences', () => {
  const some = render({ skills: skillsOf([row('review', { agent: 2 })], { unattributedUses: 2, unattributedFailures: 1, omitted: 1, omittedFailures: 0 }) });
  assert.equal(count(some, /<li>/g), 3);
  const items = [...some.matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1]);
  assert.equal(items[0], 'Skill activity ignores the model filter, the same as Breakdown → Skills.');
  assert.equal(items[1], '2 uses and 1 failed load are included although the provider could not be verified. 1 use and 0 failed loads were left out because the billing-provider evidence was rejected or mixed.');
  assert.equal(items[2], 'Counts show activity, not cost. Uses and failed loads do not price a skill, and they cannot show that a skill sat unused in context.');
  const mixed = render({ skills: skillsOf([row('review', { agent: 2 })], { omittedFailures: 3 }) });
  assert.match(mixed, /No uses or failed loads are included with an unverified provider\. 0 uses and 3 failed loads were left out/);
});

test('the insight sentence follows the evidence', () => {
  const insight = (rows, extra) => plain(render({ skills: skillsOf(rows, extra) }).match(/<aside class="token-insight">.*<\/aside>/)[0]);
  // A quarter of uses preloaded leads with preloading; just under a quarter does not.
  assert.match(insight([row('a', { preloaded: 1, agent: 3 })]), /^ 1 of 4 recorded skill uses \(25%\) was preloaded at the start of a conversation\. No skill was preloaded more often than a: 1 of its 4 recorded uses\./);
  assert.match(insight([row('a', { preloaded: 1 })]), /1 of its 1 recorded use\. For one comparable task, try a conversation where that skill is not preloaded/);
  assert.match(insight([row('a', { preloaded: 6, agent: 19 })]), /^ 19 of 25 recorded skill uses \(76%\) were invoked by the agent during a conversation\./);
  // A tie is worded so that it stays true whichever skill is named.
  assert.match(insight([row('a', { preloaded: 2 }), row('b', { preloaded: 2 })]), /No skill was preloaded more often than a: 2 of its 2 recorded uses\./);
  const failed = insight([row('a', { agent: 5 }, { failures: 1 }), row('b', { agent: 1 }, { failures: 2 })]);
  assert.match(failed, /^ 3 skill loads failed in this view\. No skill had more failed loads than b \(2\)\. Retry it on a small task/);
  assert.match(failed, /does not show that work stopped or why the load failed/);
  assert.match(insight([row('a', { agent: 1 }, { failures: 1 })]), /^ 1 skill load failed in this view\./);
  // Failed loads recorded in the summary but on no row still point somewhere useful.
  assert.match(insight([row('a', { agent: 1 })], { failures: 2 }), /2 skill loads failed in this view\. Find the skill in Breakdown → Skills/);
  assert.match(insight([row('a', { manual: 3, agent: 1 })]), /^ 3 of 4 recorded skill uses \(75%\) were invoked by you during a conversation\. Take a context snapshot before and after/);
  assert.match(insight([row('a', { unknown: 3, agent: 1 })]), /^ How the skill was loaded was not recorded for 3 of 4 skill uses\./);
  // Preloading outranks failed loads: it is the part of the question about what occupies context.
  assert.match(insight([row('a', { preloaded: 3 }, { failures: 4 })]), /^ 3 of 3 recorded skill uses \(100%\) were preloaded/);
  for (const rows of [[row('a', { preloaded: 1 })], [row('a', { agent: 1 }, { failures: 1 })], [row('a', { agent: 1 })], []]) assert.match(insight(rows), /Compare afterward: /);
});

test('skills that only failed to load are shown without an invented load split', () => {
  const html = render({ skills: skillsOf([row('broken', {}, { failures: 2 })]) }), text = plain(html);
  assert.match(text, /How skills were loaded No recorded skill uses match these filters, only failed loads\./);
  assert.match(text, /broken None recorded 0 No recorded uses 1 1 /);
  assert.match(text, /Skills used 0 Different skills with a recorded use; 1 other had only failed loads/);
  assert.doesNotMatch(html, /role="img"|token-skill-split|NaN|Infinity/);
});

test('a snapshot shows instructions, skill sources and plugin sources beside the history without joining them', () => {
  const context = snapshot([
    entry('plugin', 'team-tools', 1000), entry('plugin', 'other-plugin', 400),
    entry('skill', 'review', 250, 'plugin:team-tools'), entry('skill', 'orphan', 100, 'plugin:missing'),
    ...[90, 80, 70, 60, 50].map((tokens, index) => entry('skill', `extra-${index}`, tokens)),
    entry('tool', 'skill result', 3000), entry('mcpServer', 'skill server', 2000), entry('toolDefinition', 'skill definition', 1500), entry('newKind', 'skill plugin lookalike', 999),
    { kind: 'skill', id: 'skill:broken', label: 'no token count', tokens: null },
  ], { omitted: 2 });
  const before = JSON.stringify(context);
  const report = { skills: skillsOf([row('review', { agent: 2 })]) }, html = render(report, context), text = plain(html);
  assert.match(text, /Custom instructions 300 3% of occupied context System instructions 500 5% of occupied context; excludes custom instructions/);
  // Largest first, five at most, on one scale across both lists.
  assert.match(text, /Skill sources review 250 · 2\.5% Parent source: team-tools orphan 100 · 1% extra-0 90 · 0\.9% extra-1 80 · 0\.8% extra-2 70 · 0\.7% Plugin sources team-tools 1000 · 10% other-plugin 400 · 4% /);
  assert.equal(count(html, /class="token-bar-row"/g), 7);
  assert.match(html, /team-tools<\/span><span class="token-bar-track" aria-hidden="true"><i style="width:100\.0%"/);
  assert.match(html, /review<\/span><span class="token-bar-track" aria-hidden="true"><i style="width:25\.0%"/);
  assert.match(text, /Showing 5 of 7 skill sources and 2 of 2 plugin sources in the retained snapshot; 2 entries were omitted from the snapshot\. Parent and child sources can overlap; do not add these rows\./);
  assert.match(text, /These sources sit beside the recorded uses above without being matched to them\. Context sources are not joined to uses by display name/);
  assert.doesNotMatch(text, /skill result|skill server|skill definition|lookalike|no token count|extra-3|extra-4|Parent source: missing/);
  // The history row for the same name carries no snapshot tokens, and the snapshot row no uses.
  assert.match(text, /review None recorded 2 2 by the agent 1 1 /);
  assert.equal(count(html, /data-token-context="true"/g), 1);
  assert.match(text, /Current hosting conversation · snapshot 2026-11-14T12:00:00Z · model-a\./);
  assert.equal(JSON.stringify(context), before);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('snapshot gaps are named rather than filled in', () => {
  const report = { skills: skillsOf([row('review', { agent: 2 })]) };
  const sparse = plain(render(report, snapshot([entry('skill', 'empty', 0)], { categories: { systemPrompt: null, customInstructions: 20000 } })));
  // A category that is missing, or larger than the whole context, is not a measurement.
  assert.match(sparse, /Custom instructions Unavailable Not available in this snapshot System instructions Unavailable Not available in this snapshot/);
  assert.match(sparse, /Skill sources 1 skill source listed with 0 tokens in this snapshot\./);
  assert.match(sparse, /Plugin sources Copilot returned no attributed plugin sources in this snapshot\. This does not establish that none were loaded\./);
  const bare = render(report, { available: true, totalTokens: 0, categories: { systemPrompt: 0, customInstructions: 0 } });
  assert.match(plain(bare), /Custom instructions 0 Share of context unavailable/);
  assert.match(plain(bare), /Skill sources Copilot returned no attributed skill sources in this snapshot\./);
  assert.match(plain(bare), /snapshot time unavailable/);
  assert.doesNotMatch(bare, /NaN|undefined|Infinity/);
});

test('without a snapshot the view offers the context inspector and claims nothing about current context', () => {
  const report = { skills: skillsOf([row('review', { preloaded: 2 })]) };
  for (const context of [undefined, null, { available: false, reason: 'timeout', checkedAt: '2026-11-14T12:00:00Z' }]) {
    const html = render(report, context), text = plain(html);
    assert.equal(count(html, /<button data-token-context="true">Open context inspector<\/button>/g), 1);
    assert.match(text, /Current context has not been measured here\. Open the inspector and choose Inspect context; it does not run automatically\./);
    assert.match(text, /Custom instructions Unavailable Needs a context snapshot System instructions Unavailable Needs a context snapshot/);
    assert.match(text, /Context sources are not joined to uses by display name\./);
    assert.doesNotMatch(html, /token-bar-list|token-skill-sources|of occupied context|NaN|undefined|Infinity/);
    // The history half of the view does not depend on the snapshot.
    assert.match(text, /2 of 2 recorded skill uses \(100%\) were preloaded/);
    assert.match(text, /Most-used skills in selected history/);
  }
});

test('names from logs and snapshots are escaped everywhere they appear', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const rows = [row(hostile, { preloaded: 2 }, { plugin: hostile, failures: 1 }), row(`${hostile}2`, { agent: 1 }, { failures: 3 })];
  const context = snapshot([entry('plugin', hostile, 500), entry('skill', hostile, 200, `plugin:${hostile}`), { kind: 'skill', id: hostile, label: '', tokens: 50 }], { modelId: hostile, checkedAt: hostile });
  for (const report of [{ skills: skillsOf(rows) }, { skills: skillsOf([row(hostile, { agent: 4 }, { failures: 2 })]) }]) {
    const html = render(report, context);
    assert.doesNotMatch(html, /<img|onerror=alert\(1\)>/);
    assert.ok(count(html, /&lt;img src=x onerror=alert\(1\)&gt;/g) >= 6);
  }
  assert.match(render({ skills: skillsOf(rows) }, context), /Parent source: &lt;img src=x/);
  assert.match(render({ skills: skillsOf([{ invocations: 1 }]) }), /Unnamed skill/);
});

test('the demo history renders a complete view whose split matches the report', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now), report = buildReport(data.records, { range: '30d' }, now, data);
  const before = JSON.stringify(report.skills), real = { number: formatNumber, credits: formatCredits };
  assert.ok(report.skills.rows.length > 0 && report.skills.rows.some(skill => skill.triggers.preloaded > 0));
  for (const context of [demoContext(now), undefined]) {
    const html = renderTokenTopic('skills', report, { ...real, context });
    assert.doesNotMatch(html, /NaN|undefined|Infinity|Invalid Date/);
    const legend = [...html.matchAll(/<\/i>[^<]+<b>(\d+)<\/b>/g)].map(match => Number(match[1]));
    assert.equal(legend.length, 4);
    assert.equal(legend.reduce((sum, n) => sum + n, 0), report.skills.invocations);
    assert.equal(legend[0], report.skills.rows.reduce((sum, skill) => sum + skill.triggers.preloaded, 0));
    assert.ok(count(html, /<tr>/g) <= 6);
    assert.match(html, /Compare afterward:/);
    assert.equal(count(html, /data-token-context="true"/g), 1);
  }
  assert.equal(JSON.stringify(report.skills), before);
});
