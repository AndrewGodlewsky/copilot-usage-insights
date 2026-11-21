// "Work behind each prompt": the spread, credit concentration, call mix and heaviest prompts
// that sit beside the per-prompt averages, and the view that shows them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const now = new Date(2026, 10, 14, 12);
function fixture(session = 's1', project = 'Project A') {
  const events = []; let serial = 0, ms = new Date(2026, 10, 14, 10).getTime();
  const push = (type, data, envelope = {}) => {
    const e = { type, id: `${session}-e${serial++}`, timestamp: new Date(ms++).toISOString(), data, ...envelope }; events.push(e); return e;
  };
  push('session.start', { sessionId: session, context: { repository: project } });
  const user = (interaction, data = {}, envelope = {}) => push('user.message', { interactionId: interaction, messageId: `${interaction}-prompt`, source: 'user', content: 'PRIVATE PROMPT', ...data }, envelope);
  const call = (interaction, api, nano, opts = {}) => {
    const { turn = '0', model = 'Model A', initiator = 'user', agentId, parentToolCallId, terminal = true, tools = [], complete = true } = opts;
    const envelope = agentId ? { agentId } : {};
    const links = { interactionId: interaction, turnId: turn, ...(parentToolCallId ? { parentToolCallId } : {}) };
    push('assistant.turn_start', links, envelope);
    push('session.usage_record', { usage: { apiCallId: api, provider: { kind: 'copilot' }, model, initiator, parentToolCallId,
      accounting: { sourceSessionId: session, usageId: api }, copilotUsage: nano == null ? undefined : { totalNanoAiu: nano }, aiCreditsStatus: 'complete',
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10 } }, envelope);
    push('assistant.message', { ...links, apiCallId: api, content: 'PRIVATE RESPONSE', phase: terminal ? 'final_answer' : 'commentary', toolRequests: tools.map(toolCallId => ({ toolCallId, arguments: 'PRIVATE TOOL' })) }, envelope);
    if (complete) push('assistant.turn_end', { turnId: turn, ...(parentToolCallId ? { parentToolCallId } : {}) }, envelope);
  };
  return { events, push, user, call };
}
function snapshot(events) {
  const parser = createReceiptParser({ sessionId: 'fallback', source: 'fixture' });
  for (const e of events) parser.push(JSON.stringify(e));
  return parser.snapshot();
}
const report = (events, query = {}) => { const s = snapshot(events); return buildReport(s.records, { range: 'all', ...query }, now, s); };
const metrics = (events, query) => report(events, query).promptCredits;
// One prompt whose first call starts a subagent: 1 credit, then 2 in the subagent, then 3.
function delegated() {
  const f = fixture(); f.user('root'); f.call('root', 'root-initial', 1e9, { terminal: false, tools: ['task'] });
  f.push('tool.execution_start', { toolCallId: 'task', toolName: 'task', arguments: 'PRIVATE TASK' });
  f.push('subagent.started', { toolCallId: 'task' }, { agentId: 'worker' });
  f.user('child', { source: 'agent-root', parentToolCallId: 'task' }, { agentId: 'worker' });
  f.call('child', 'child-call', 2e9, { agentId: 'worker', parentToolCallId: 'task', initiator: 'sub-agent', model: 'Model B' });
  f.push('subagent.completed', { toolCallId: 'task' }, { agentId: 'worker' });
  f.push('tool.execution_complete', { toolCallId: 'task', success: true });
  f.call('root', 'root-final', 3e9, { turn: '1', initiator: 'agent' });
  return f;
}
// Ten finished prompts of one call each, charged 1 to 10 credits.
function ladder(session, project) {
  const f = fixture(session, project);
  for (let i = 1; i <= 10; i++) { f.user(`p${i}`); f.call(`p${i}`, `c${i}`, i * 1e9); }
  return f;
}
const emptyBins = ['1 call', '2 to 5 calls', '6 to 15 calls', '16+ calls'].map(label => ({ label, prompts: 0, credits: null }));

test('the spread, mix and heaviest prompts use the eligible prompts behind the averages', () => {
  const f = fixture(); f.user('a'); f.call('a', 'a1', 200000000, { terminal: false }); f.call('a', 'a2', 800000000, { turn: '1', initiator: 'agent' });
  f.user('b'); f.call('b', 'b1', 3000000000);
  f.user('free'); f.call('free', 'c1', 0);
  f.user('unfinished'); f.call('unfinished', 'open', 9000000000, { complete: false });
  const r = report([...f.events, ...f.events]), p = r.promptCredits;
  assert.equal(p.prompts, 4); assert.equal(p.eligiblePrompts, 3); assert.equal(p.credits, 4);
  assert.deepEqual(p.spread, { medianRequests: 1,
    bins: [{ label: '1 call', prompts: 2, credits: 3 }, { label: '2 to 5 calls', prompts: 1, credits: 1 }, emptyBins[2], emptyBins[3]],
    medianCredits: 1, heavyPrompts: 0, heavyCredits: null, heavyShare: null, halfPrompts: 1 });
  assert.deepEqual(p.mix, { delegatedPrompts: 0, initial: { requests: 3, credits: 3.2 }, continuation: { requests: 1, credits: .8 },
    subagent: { requests: 0, credits: null }, unrecorded: { requests: 0, credits: null } });
  const name = r.sessions[0].name;
  assert.match(name, /^Project A/);
  // The unfinished 9-credit prompt and the free prompt are not ranked.
  assert.deepEqual(p.heaviest, [{ day: '2026-11-14', session: 's1', sessionName: name, project: 'Project A', requests: 1, tokens: 120, credits: 3 },
    { day: '2026-11-14', session: 's1', sessionName: name, project: 'Project A', requests: 2, tokens: 240, credits: 1 }]);
  assert.equal(p.spread.bins.reduce((sum, bin) => sum + bin.prompts, 0), p.eligiblePrompts);
  assert.equal(Object.values(p.mix).reduce((sum, kind) => sum + (kind.requests || 0), 0), p.work.requests);
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE|prompt"|a-prompt/);
});

test('the heaviest tenth, the median and the prompts behind half the credits are exact', () => {
  const p = metrics(ladder('s1', 'Project A').events);
  assert.equal(p.eligiblePrompts, 10); assert.equal(p.credits, 55);
  assert.equal(p.spread.medianCredits, 5.5);
  assert.equal(p.spread.heavyPrompts, 1); assert.equal(p.spread.heavyCredits, 10);
  assert.equal(p.spread.heavyShare, 10 / 55 * 100);
  // 10 + 9 + 8 is under half of 55; one more prompt passes it.
  assert.equal(p.spread.halfPrompts, 4);
  assert.equal(p.spread.medianRequests, 1);
  assert.deepEqual(p.heaviest.map(row => row.credits), [10, 9, 8, 7, 6]);
  const eleven = ladder('s1', 'Project A'); eleven.user('p11'); eleven.call('p11', 'c11a', 5e8, { terminal: false }); eleven.call('p11', 'c11b', 5e8, { turn: '1', initiator: 'agent' });
  const odd = metrics(eleven.events).spread;
  assert.equal(odd.medianCredits, 5); assert.equal(odd.heavyPrompts, 1); assert.equal(odd.medianRequests, 1);
  assert.deepEqual(odd.bins.map(bin => [bin.prompts, bin.credits]), [[10, 55], [1, 1], [0, null], [0, null]]);
});

test('unknown stays unknown: no prompts, free prompts and missing token counts are not zero', () => {
  const none = metrics([]);
  assert.deepEqual(none.spread, { medianRequests: null, bins: emptyBins, medianCredits: null, heavyPrompts: 0, heavyCredits: null, heavyShare: null, halfPrompts: null });
  assert.deepEqual(none.mix, { delegatedPrompts: 0, initial: { requests: 0, credits: null }, continuation: { requests: 0, credits: null },
    subagent: { requests: 0, credits: null }, unrecorded: { requests: 0, credits: null } });
  assert.deepEqual(none.heaviest, []);
  const free = fixture(); for (let i = 0; i < 10; i++) { free.user(`f${i}`); free.call(`f${i}`, `free-${i}`, 0); }
  const zero = metrics(free.events);
  assert.equal(zero.spread.medianCredits, 0, 'a recorded zero charge is a value');
  assert.equal(zero.spread.heavyCredits, 0); assert.equal(zero.spread.heavyShare, null, 'no share of a zero total');
  assert.equal(zero.spread.halfPrompts, null);
  assert.equal(zero.spread.bins[0].credits, 0);
  assert.deepEqual(zero.heaviest, [], 'a prompt without a charge above zero is not ranked as heavy');
  const partial = fixture(); partial.user('a'); partial.call('a', 'a1', 2e9, { terminal: false }); partial.call('a', 'a2', 1e9, { turn: '1', initiator: 'agent' });
  delete partial.events.find(e => e.data?.usage?.apiCallId === 'a2').data.usage.outputTokens;
  const row = metrics(partial.events).heaviest[0];
  assert.equal(row.credits, 3); assert.equal(row.requests, 2);
  assert.equal(row.tokens, null, 'a partial token total is not shown as a smaller number');
});

test('calls under a parent tool link are subagent work; other calls keep their recorded initiator', () => {
  const p = metrics(delegated().events);
  assert.equal(p.eligiblePrompts, 1);
  assert.deepEqual(p.mix, { delegatedPrompts: 1, initial: { requests: 1, credits: 1 }, continuation: { requests: 1, credits: 3 },
    subagent: { requests: 1, credits: 2 }, unrecorded: { requests: 0, credits: null } });
  assert.equal(p.spread.medianRequests, 3);
  assert.deepEqual(p.heaviest.map(row => [row.requests, row.tokens, row.credits]), [[3, 360, 6]]);
  // A model filter keeps the prompt and counts only the selected model's part of it.
  const filtered = metrics(delegated().events, { models: ['Model B'] });
  assert.equal(filtered.modelFiltered, true);
  assert.deepEqual(filtered.mix.subagent, { requests: 1, credits: 2 });
  assert.deepEqual(filtered.mix.initial, { requests: 0, credits: null });
  assert.equal(filtered.spread.medianRequests, 1); assert.equal(filtered.spread.medianCredits, 2);
  assert.deepEqual(filtered.heaviest.map(row => [row.requests, row.tokens, row.credits]), [[1, 120, 2]]);
  // The parent link decides, not the label on the call; a root call without a label stays unlabelled.
  const unlabelled = delegated();
  for (const e of unlabelled.events) if (e.type === 'session.usage_record' && ['child-call', 'root-final'].includes(e.data.usage.apiCallId)) delete e.data.usage.initiator;
  const mix = metrics(unlabelled.events).mix;
  assert.deepEqual([mix.initial.requests, mix.continuation.requests, mix.subagent.requests, mix.unrecorded.requests], [1, 0, 1, 1]);
  assert.equal(mix.unrecorded.credits, 3);
});

test('the report additions stay small and rank equal charges the same however history is read', () => {
  const a = ladder('a', 'A'), b = ladder('b', 'B');
  const forward = metrics([...a.events, ...b.events]), backward = metrics([...b.events, ...a.events]);
  for (const key of ['spread', 'mix', 'heaviest']) assert.deepEqual(backward[key], forward[key], key);
  assert.equal(forward.eligiblePrompts, 20);
  assert.equal(forward.heaviest.length, 5);
  // Equal charges at the same instant fall back to the session, so the order is total.
  assert.deepEqual(forward.heaviest.map(row => [row.credits, row.session]), [[10, 'a'], [10, 'b'], [9, 'a'], [9, 'b'], [8, 'a']]);
  assert.equal(forward.spread.heavyPrompts, 2); assert.equal(forward.spread.heavyCredits, 20);
  assert.deepEqual(Object.keys(forward.heaviest[0]), ['day', 'session', 'sessionName', 'project', 'requests', 'tokens', 'credits']);
  assert.ok(JSON.stringify({ spread: forward.spread, mix: forward.mix }).length < 800);
  assert.ok(JSON.stringify(forward.heaviest).length < 1500);
  // Among equal charges the later prompt ranks first, whichever session it is in.
  for (const [late, early] of [['a', 'b'], ['b', 'a']]) {
    const first = fixture(early, 'P'), second = fixture(late, 'P');
    first.user('x'); first.call('x', 'x1', 1e9); second.user('x'); second.call('x', 'x1', 1e9);
    for (const e of second.events) e.timestamp = new Date(Date.parse(e.timestamp) + 60_000).toISOString();
    assert.deepEqual(metrics([...first.events, ...second.events]).heaviest.map(row => row.session), [late, early]);
  }
  const ties = fixture(); for (const id of ['first', 'second', 'third']) { ties.user(id); ties.call(id, `${id}-call`, 1e9); }
  const tied = report(ties.events).promptCredits;
  assert.equal(tied.heaviest.length, 3);
  assert.deepEqual(metrics(ties.events, { session: 'other' }).heaviest, []);
  assert.deepEqual(metrics(ties.events, { project: 'Other' }).spread.medianRequests, null);
});

const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => value == null ? 'Unavailable' : `${value}cr` };
const render = (promptCredits, options = {}) => renderTokenTopic('prompts', { promptCredits }, { ...formats, ...options });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the view puts the typical prompt beside the average and shows where the credits went', () => {
  const p = metrics([...ladder('a', 'A').events, ...delegated().events]);
  const html = render(p), shown = text(html);
  assert.equal(p.eligiblePrompts, 11);
  assert.match(shown, /Typical calls \/ prompt 1 Half of eligible prompts/);
  assert.match(shown, /Average calls \/ prompt [\d.]+ 11 of 11 prompts eligible/);
  assert.match(shown, /Typical credits \/ prompt 6cr/);
  assert.match(shown, /Held by the heaviest tenth [\d.]+% 1 of 11 eligible prompts · 10cr of 61cr credits/);
  assert.match(shown, /Prompts behind half the credits 4 /);
  assert.match(shown, /1 call 10 [\d.]+% of eligible prompts · [\d.]+% of their credits/);
  assert.match(shown, /2 to 5 calls 1 /);
  assert.match(shown, /Started by the message 11 /);
  assert.match(shown, /Subagent calls 1 [\d.]+% of linked calls · [\d.]+% of credits · in 1 of 11 eligible prompts/);
  assert.doesNotMatch(shown, /Initiator not recorded/, 'an empty unlabelled group is not drawn');
  assert.match(shown, /The average \([\d.]+\) is above the typical prompt \(1\)/);
  assert.match(shown, /The heaviest tenth of prompts averaged 1\.6\d* times the credits of a typical prompt\./);
  assert.match(shown, /Compare afterward:/);
  assert.match(shown, /No prompt text is read or shown/);
  assert.equal((html.match(/data-prompt-session=/g) || []).length, 5, 'five rows, each able to open its conversation');
  assert.match(html, /<button class="[^"]*" data-prompt-session="a" data-prompt-project="A" title="Open this conversation in Breakdown">[^<]+<span class="sr-only">: open this conversation in Breakdown<\/span><\/button>/);
  assert.match(html, /role="list"/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|PRIVATE/);
  assert.doesNotMatch(shown, /Unavailable/);
});

test('the view keeps empty and partial measurements distinct from zero', () => {
  const none = text(render(metrics([])));
  assert.match(none, /Typical calls \/ prompt Unavailable/);
  assert.match(none, /Typical credits \/ prompt Unavailable/);
  assert.match(none, /No eligible prompts in these filters/);
  assert.match(none, /Needs at least 10 eligible prompts/);
  assert.match(none, /No eligible prompt has a recorded charge above zero/);
  assert.match(none, /Complete prompt chains are needed/);
  assert.doesNotMatch(none, /NaN|undefined|Infinity/);
  const free = fixture(); for (let i = 0; i < 10; i++) { free.user(`f${i}`); free.call(`f${i}`, `free-${i}`, 0); }
  const zero = text(render(metrics(free.events)));
  assert.match(zero, /Typical credits \/ prompt 0cr/, 'a zero charge is shown as zero');
  assert.match(zero, /Held by the heaviest tenth Unavailable 1 of 10 eligible prompts/);
  assert.match(zero, /Prompts behind half the credits Unavailable Needs a recorded charge above zero/);
  assert.match(zero, /A typical prompt led to 1 model calls\. The largest led to 1\./);
  assert.doesNotMatch(zero, /% of their credits|NaN|undefined|Infinity/);
  const p = metrics(delegated().events);
  const partial = text(render({ ...p, prompts: 3, heaviest: [{ ...p.heaviest[0], tokens: null, sessionName: null }] }));
  assert.match(partial, /Unnamed conversation Project A 2026-11-14 3 Unavailable 6cr/);
  assert.match(partial, /Typical calls \/ prompt 3 \*/, 'excluded prompts mark the figures as partial');
  assert.doesNotMatch(render({ ...p, prompts: 3 }, { showCoverage: false }), /\d \*/);
  assert.doesNotMatch(text(render({ ...p, heaviest: [{ ...p.heaviest[0], sessionName: null }] })), /Choose a conversation/);
  // While older history loads the server withholds charges; nothing derived from them is shown.
  const pending = render({ ...metrics(ladder('a', 'A').events), pending: true, credits: null, averageCredits: null });
  assert.match(text(pending), /Charges per prompt are still being verified/);
  assert.match(text(pending), /Typical credits \/ prompt Unavailable/);
  assert.match(text(pending), /A typical prompt led to 1 model calls/);
  assert.doesNotMatch(pending, /data-prompt-session|of their credits|of credits ·|10cr/);
  // A report without the new fields keeps the averages and invents nothing.
  const legacy = text(render({ prompts: 3, eligiblePrompts: 2, credits: 0, averageCredits: 0, work: { averageRequests: 2, maxRequests: 3, tokenPrompts: 2, averageTokens: 100, requests: 4 } }));
  assert.match(legacy, /Model calls \/ prompt 2 \*/); assert.match(legacy, /AI credits \/ prompt 0cr \*/);
  assert.doesNotMatch(legacy, /Unavailable|Typical|Heaviest prompts/);
});

test('a model filter is stated wherever the selected contribution is shown', () => {
  const html = render(metrics(delegated().events, { models: ['Model B'] })), shown = text(html);
  assert.match(shown, /^ ?Selected-model contribution only/);
  assert.match(shown, /model filters show only selected-model contributions/);
  assert.match(html, /Each row counts only the selected models&#39; part of that prompt\./);
  assert.match(shown, /A typical prompt led to 1 model calls on the selected models\./);
  assert.match(shown, /Subagent calls 1 100% of linked calls · 100% of credits · in 1 of 1 eligible prompts/);
  const many = [...ladder('a', 'A').events];
  assert.match(text(render(metrics(many, { models: ['Model A'] }))), /times the credits of a typical prompt on the selected models\./);
  assert.doesNotMatch(text(render(metrics(many))), /selected models\.|Selected-model contribution only|Each row counts/);
});

test('conversation, project and session names are escaped in rows and attributes', () => {
  const hostile = '<img src=x onerror=alert(1)>', p = metrics(delegated().events);
  const html = render({ ...p, heaviest: [{ ...p.heaviest[0], session: `"${hostile}`, sessionName: hostile, project: hostile, day: hostile }] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-prompt-session="&quot;&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /data-prompt-project="&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.equal((html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 5);
  const named = fixture('s1', hostile); named.user('a'); named.call('a', 'a1', 1e9);
  const built = snapshot(named.events), records = built.records.map(r => ({ ...r, sessionName: hostile }));
  const real = buildReport(records, { range: 'all' }, now, built).promptCredits;
  assert.equal(real.heaviest[0].sessionName, hostile);
  assert.doesNotMatch(render(real), /<img/);
});

test('a heaviest prompt opens its conversation in Breakdown and keeps the model filter', async () => {
  const f = fixture('s1', '<Project>'); f.user('a'); f.call('a', 'a1', 2e9, { terminal: false }); f.call('a', 'a2', 1e9, { turn: '1', initiator: 'agent' });
  const built = snapshot(f.events), records = built.records.map(r => ({ ...r, sessionName: '<Session>' }));
  const { get, requests } = await mountPanel({ ...buildReport(records, { range: 'all' }, now, built), sources: [], coverage: {} });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: 'prompts' } }) } });
  const body = get('token-topic-body').innerHTML;
  assert.equal(get('token-detail-panel').hidden, false);
  assert.match(body, /data-prompt-session="s1" data-prompt-project="&lt;Project&gt;"/);
  assert.match(body, /&lt;Session&gt;<span class="sr-only">: open this conversation in Breakdown<\/span>/);
  assert.doesNotMatch(body, /<Session>|<Project>|NaN|undefined|PRIVATE/);
  const before = requests.length;
  // A click elsewhere in the panel does nothing.
  await get('token-detail-panel').onclick({ target: { closest: () => null } });
  assert.equal(requests.length, before);
  assert.equal(get('efficiency-view').hidden, false);
  get('model').value = 'Model A';
  await get('token-detail-panel').onclick({ target: { closest: selector => selector === '[data-prompt-session]' ? { dataset: { promptSession: 's1', promptProject: '<Project>' } } : null } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('efficiency-view').hidden, true);
  assert.equal(get('group').value, 'models');
  assert.equal(requests.at(-1).input.session, 's1');
  assert.equal(requests.at(-1).input.project, '<Project>');
  assert.deepEqual(requests.at(-1).input.models, ['Model A']);
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0, 'opening a conversation does not read prompts');
});
