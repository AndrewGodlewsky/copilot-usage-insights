// Findings drawn from the measurements the other Efficiency views report. This reads finished
// report sections only; it never sees a record. Each check has a threshold and a minimum sample,
// and ends in one of three states:
//   found    the measure crossed its threshold on enough data
//   clear    there was enough data and the measure did not cross its threshold
//   missing  the section is absent or too small to judge, which is not the same as clear
// A finding carries numbers only. The wording lives in src/panel/findings.mjs. These thresholds
// pick places to look at, not targets. At most one finding of each kind.
export const FINDINGS_SHOWN = 5;
export const FINDING_RULES = {
  pause: { minimumCalls: 10, gap: 20 },          // cache-read share points lower after a pause over an hour than after under five minutes
  prompts: { minimumPrompts: 20, share: 50 },    // percent of credits held by the heaviest tenth of prompts
  failures: { minimumKnown: 10, run: 3 },        // tool calls with a known outcome; failed calls in a row for one operation
  compaction: { minimumConversations: 3, repeated: 2, share: 25 }, // compacted conversations; ones compacted more than once; percent of them
  late: { minimumCalls: 20, minimumConversations: 3, share: 50 },  // measured calls and conversations; percent of input after doubling
  switch: { minimumPairs: 5, gap: 20 },          // model changes with a complete cache split; points lower on the first call after
};
export const FINDING_KINDS = ['pause', 'prompts', 'failures', 'compaction', 'late', 'switch'];
const LABELS = { pause: 'Cache reuse after pauses', prompts: 'Credits held by the heaviest prompts', failures: 'Failed tool calls in a row',
  compaction: 'Conversations compacted more than once', late: 'Input after conversations doubled', switch: 'Cache reuse after a model change' };
const num = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const found = (kind, strength, view, data) => ({ kind, status: 'found', strength, view, ...data });
const clear = kind => ({ kind, status: 'clear' });
const missing = (kind, reason) => ({ kind, status: 'missing', reason });

function checkPause(e) {
  const rule = FINDING_RULES.pause, rows = e.cacheTiming?.situations;
  const quick = rows?.find?.(r => r.id === 'under5'), long = rows?.find?.(r => r.id === 'over60');
  if (!quick || !long || quick.calls < rule.minimumCalls || long.calls < rule.minimumCalls || !num(quick.share) || !num(long.share))
    return missing('pause', `needs ${rule.minimumCalls} calls with a complete cache split after a pause under 5 minutes and after one over an hour`);
  const gap = quick.share - long.share;
  if (gap < rule.gap) return clear('pause');
  return found('pause', gap / rule.gap, { section: 'tokens', topic: 'cache' },
    { quick: { calls: quick.calls, share: quick.share }, long: { calls: long.calls, share: long.share }, gap, modelFiltered: !!e.cacheTiming.modelFiltered });
}
function checkPrompts(p) {
  const rule = FINDING_RULES.prompts, s = p?.spread;
  if (!p || p.pending || !num(p.eligiblePrompts) || p.eligiblePrompts < rule.minimumPrompts || !s || !num(s.heavyShare) || !num(s.heavyCredits) || !num(s.heavyPrompts) || !s.heavyPrompts)
    return missing('prompts', `needs ${rule.minimumPrompts} prompts with complete charges`);
  if (s.heavyShare < rule.share) return clear('prompts');
  return found('prompts', s.heavyShare / rule.share, { section: 'tokens', topic: 'prompts' },
    { heavyPrompts: s.heavyPrompts, prompts: p.eligiblePrompts, share: s.heavyShare, credits: s.heavyCredits, modelFiltered: !!p.modelFiltered });
}
function checkFailures(e) {
  const rule = FINDING_RULES.failures, r = e.recovery;
  if (!r || !r.runs || !num(r.known) || r.known < rule.minimumKnown) return missing('failures', `needs ${rule.minimumKnown} tool calls with a known outcome`);
  const top = r.runs.top?.[0];
  if (!(r.runs.longest >= rule.run) || !top || top.length < rule.run) return clear('failures');
  return found('failures', top.length / rule.run, { section: 'patterns', topic: 'recovery' },
    { run: rule.run, longest: top.length, stretches: r.runs.repeated, operation: top.server ? `${top.server} / ${top.mcpTool || top.name}` : String(top.name ?? ''),
      session: top.session, day: top.day, then: top.then, known: r.known });
}
function checkCompaction(e) {
  const rule = FINDING_RULES.compaction, c = e.compaction;
  if (!c || !num(c.sessions) || c.sessions < rule.minimumConversations) return missing('compaction', `needs ${rule.minimumConversations} compacted conversations`);
  const share = c.repeatSessions / c.sessions * 100;
  if (c.repeatSessions < rule.repeated || share < rule.share) return clear('compaction');
  return found('compaction', share / rule.share, { section: 'patterns', topic: 'compaction' },
    { repeated: c.repeatSessions, conversations: c.sessions, compactions: c.repeatCompactions, share, modelFiltered: !!c.modelFiltered });
}
function checkLate(e) {
  const rule = FINDING_RULES.late, g = e.growthSummary, l = g?.later;
  if (!g || !l || !num(l.input) || !num(l.totalInput) || l.totalInput <= 0 || g.measuredCalls < rule.minimumCalls || g.measuredConversations < rule.minimumConversations)
    return missing('late', `needs ${rule.minimumCalls} calls with known input in ${rule.minimumConversations} conversations`);
  const share = l.input / l.totalInput * 100;
  if (share < rule.share) return clear('late');
  return found('late', share / rule.share, { section: 'patterns', topic: 'growth' },
    { share, input: l.input, totalInput: l.totalInput, calls: l.calls, measuredCalls: g.measuredCalls, conversations: l.conversations, measuredConversations: g.measuredConversations });
}
function checkSwitch(e) {
  const rule = FINDING_RULES.switch, d = e.changeDetail, n = d?.next;
  if (!d || d.modelFiltered || !n || !(n.cachePairs >= rule.minimumPairs) || !num(n.cacheBefore) || !num(n.cacheAfter))
    return missing('switch', d?.modelFiltered ? 'unavailable with a model filter' : `needs ${rule.minimumPairs} model changes with a complete cache split on both sides`);
  const gap = n.cacheBefore - n.cacheAfter;
  if (gap < rule.gap) return clear('switch');
  return found('switch', gap / rule.gap, { section: 'patterns', topic: 'transitions' },
    { before: n.cacheBefore, after: n.cacheAfter, gap, pairs: n.cachePairs, lower: n.lower });
}

// Builds the checks from the finished sections. `e` is report.efficiency, `p` is report.promptCredits.
export function buildFindings(e = {}, p = null) {
  const results = [checkPause(e), checkPrompts(p), checkFailures(e), checkCompaction(e), checkLate(e), checkSwitch(e)];
  // Strongest first: how many times past its own threshold the measure is. Ties keep the order above.
  const qualified = results.filter(r => r.status === 'found').sort((a, b) => b.strength - a.strength || FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind));
  return {
    shown: qualified.slice(0, FINDINGS_SHOWN), qualified: qualified.length, more: Math.max(0, qualified.length - FINDINGS_SHOWN),
    clear: results.filter(r => r.status === 'clear').map(r => ({ kind: r.kind, label: LABELS[r.kind] })),
    missing: results.filter(r => r.status === 'missing').map(r => ({ kind: r.kind, label: LABELS[r.kind], reason: r.reason })),
    checked: results.length,
  };
}
