import { confirmedHuman } from './conversations.mjs';

// "Conversation habits": how the number, position, spacing and length of your prompts relate to
// the work after them. It reads the prompts the prompt-credits pass already attributed, so a prompt
// is eligible for work figures by exactly the rule used there (complete, finished, unshared
// accounting). Nothing here reads prompt text: the only prompt property used besides timing is the
// character count the parser already records.
const LENGTH_LABELS = ['1 prompt', '2 to 5 prompts', '6 to 15 prompts', '16 or more prompts'];
const POSITION_LABELS = ['First prompt', '2nd to 5th prompt', '6th to 15th prompt', '16th prompt or later'];
const PAUSE_LABELS = ['Under 5 minutes', '5 to 60 minutes', 'Over an hour'];
const CHARS_LABELS = ['Under 100 characters', '100 to 499 characters', '500 to 1,999 characters', '2,000 characters or more'];
const MINUTE = 60_000;
const NONE = 0, OPEN = 1, MEASURED = 2;
const countBin = n => n <= 1 ? 0 : n <= 5 ? 1 : n <= 15 ? 2 : 3;
const charsBin = n => n < 100 ? 0 : n < 500 ? 1 : n < 2000 ? 2 : 3;
const pauseBin = ms => ms < 5 * MINUTE ? 0 : ms <= 60 * MINUTE ? 1 : 2;

const bin = label => ({ label, prompts: 0, eligible: 0, calls: [], nano: [], nanoTotal: 0, tokenPrompts: 0, tokens: 0 });
const median = list => {
  if (!list.length) return null;
  const sorted = Float64Array.from(list).sort(), low = Math.floor((sorted.length - 1) / 2), high = Math.floor(sorted.length / 2);
  return (sorted[low] + sorted[high]) / 2;
};
const sum = list => { let total = 0; for (const v of list) total += v; return total; };
function finishBin(b) {
  const credits = b.eligible ? b.nanoTotal / 1e9 : null;
  return { label: b.label, prompts: b.prompts, eligible: b.eligible,
    medianCalls: median(b.calls), averageCalls: b.eligible ? sum(b.calls) / b.eligible : null,
    medianCredits: b.eligible ? median(b.nano) / 1e9 : null, averageCredits: b.eligible ? credits / b.eligible : null, credits,
    tokenPrompts: b.tokenPrompts, averageTokens: b.tokenPrompts ? b.tokens / b.tokenPrompts : null };
}

// `interactions` is the parser's list of prompt events with their recorded character counts.
// Without it the length measure is simply unavailable. A model filter hides conversations whole,
// so (like the conversations view) there is nothing to show then.
export function createHabitsAccumulator(query, start, end, now, interactions) {
  if (query.models) return { add() {}, finish: () => ({ reason: 'model-filter' }) };
  const nowMs = now.getTime(), sessions = new Map(), lengths = new Map();
  const matches = item => (!query.project || item.project === query.project) && (!query.session || item.sessionId === query.session);
  if (interactions) for (const event of interactions) if (event.kind === 'prompt' && Number.isSafeInteger(event.chars) && event.chars >= 0) lengths.set(event.key, event.chars);
  return {
    // `eligible` is the same flag the conversations view receives: complete, finished accounting.
    add(prompt, eligible) {
      if (!prompt.provider || !matches(prompt) || prompt.day > end) return;
      const ms = prompt.sample?.ms;
      let s = sessions.get(prompt.sessionId);
      if (!s) sessions.set(prompt.sessionId, s = { uncertain: 0, live: false, ms: [], state: [], calls: [], tokens: [], nano: [], chars: [] });
      if (!confirmedHuman(prompt) || !Number.isFinite(ms) || ms > nowMs) { s.uncertain++; if (prompt.day >= start) s.live = true; return; }
      let calls = 0, tokens = -1, nano = 0;
      if (eligible) {
        const charges = prompt.charges;
        calls = charges.length; tokens = 0;
        for (const r of charges) { nano += r.nano; tokens = tokens >= 0 && r.tokens >= 0 ? tokens + r.tokens : -1; }
      }
      const dated = prompt.day >= start;
      s.ms.push(ms); s.state.push(!dated ? NONE : eligible ? MEASURED : OPEN);
      s.calls.push(calls); s.tokens.push(tokens); s.nano.push(nano);
      s.chars.push(dated && lengths.size ? lengths.get(JSON.stringify(['interaction', 'prompt', prompt.sessionId, prompt.sample.promptId])) ?? -1 : -1);
    },
    finish() {
      const result = { conversations: 0, usable: 0, uncertain: 0, prompts: 0, eligible: 0, credits: null,
        length: LENGTH_LABELS.map(bin), position: POSITION_LABELS.map(bin), pause: PAUSE_LABELS.map(bin), chars: CHARS_LABELS.map(bin),
        lengthConversations: LENGTH_LABELS.map(() => 0), firstPrompts: 0, measuredChars: 0,
        paired: { conversations: 0, laterHigher: 0 } };
      const add = (b, s, i) => {
        b.prompts++;
        if (s.state[i] !== MEASURED) return;
        b.eligible++; b.calls.push(s.calls[i]); b.nano.push(s.nano[i]); b.nanoTotal += s.nano[i];
        if (s.tokens[i] >= 0) { b.tokenPrompts++; b.tokens += s.tokens[i]; }
      };
      let totalNano = 0;
      for (const s of sessions.values()) {
        const count = s.ms.length;
        let inRange = 0;
        for (let i = 0; i < count; i++) if (s.state[i] !== NONE) inRange++;
        if (!inRange && !s.live) continue;
        result.conversations++;
        // A submission that cannot be confirmed as yours could be a prompt, so positions and gaps are unreliable.
        if (s.uncertain) { result.uncertain++; continue; }
        result.usable++;
        const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => s.ms[a] - s.ms[b] || a - b);
        const bucket = result.length[countBin(inRange)];
        result.lengthConversations[countBin(inRange)]++;
        let firstNano = null, laterNano = 0, laterCount = 0;
        order.forEach((i, k) => {
          if (s.state[i] === NONE) return;
          add(result.position[k === 0 ? 0 : k < 5 ? 1 : k < 15 ? 2 : 3], s, i);
          bucket.prompts++;
          if (k > 0) add(result.pause[pauseBin(s.ms[i] - s.ms[order[k - 1]])], s, i); else result.firstPrompts++;
          if (s.chars[i] >= 0) { result.measuredChars++; add(result.chars[charsBin(s.chars[i])], s, i); }
          result.prompts++;
          if (s.state[i] === MEASURED) {
            result.eligible++; bucket.eligible++; bucket.nanoTotal += s.nano[i]; totalNano += s.nano[i];
            if (k === 0) firstNano = s.nano[i]; else { laterNano += s.nano[i]; laterCount++; }
          }
        });
        if (firstNano != null && laterCount) { result.paired.conversations++; if (laterNano / laterCount > firstNano) result.paired.laterHigher++; }
      }
      if (result.eligible) result.credits = totalNano / 1e9;
      const { lengthConversations, ...rest } = result;
      return { ...rest, length: result.length.map((b, i) => ({ label: b.label, conversations: lengthConversations[i], prompts: b.prompts, eligible: b.eligible,
        credits: b.eligible ? b.nanoTotal / 1e9 : null, share: totalNano > 0 && b.eligible ? b.nanoTotal / totalNano * 100 : null })),
        position: result.position.map(finishBin), pause: result.pause.map(finishBin), chars: result.chars.map(finishBin) };
    },
  };
}
