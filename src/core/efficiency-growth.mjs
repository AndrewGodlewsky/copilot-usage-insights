// Why do later calls in a conversation process more input? Summary evidence across every main
// conversation in the selected history: typical input at later prompt positions, how many
// conversations grow a lot, and how much of all input came after a conversation had doubled its
// starting input. Subagent calls cannot be ordered within a conversation and stay out. It measures
// size only: the logs do not record why a conversation needed its history.
const GROWTH_POSITIONS = [1, 5, 10, 20];
// A position needs this many conversations before a typical value is reported.
const GROWTH_MINIMUM = 3;
const GROWTH_STRIDE = 5;
const growthCount = value => Number.isFinite(value) && value >= 0;
function growthMiddle(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const half = values.length >> 1;
  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
}

export function createGrowthSummary() {
  // Five numbers per call in one flat list per conversation: time, input (-1 unknown), credits in
  // nano units (-1 unless the charge is complete), cache read (-1 unless the split is complete),
  // and 1 when the user started a prompt with the call. Calls usually arrive in order.
  const sessions = new Map();
  let sessionId, session, mainCalls = 0;
  return {
    add(r) {
      if (r.initiator !== 'user' && r.initiator !== 'agent') return;
      mainCalls++;
      if (!Number.isFinite(r.ms) || typeof r.sessionId !== 'string' || !r.sessionId) return;
      if (r.sessionId !== sessionId) {
        sessionId = r.sessionId; session = sessions.get(sessionId);
        if (!session) sessions.set(sessionId, session = { calls: [], ordered: true, latest: -Infinity });
      }
      const split = r.cacheDetailsReported !== false && growthCount(r.inputTotal) && growthCount(r.cacheRead) && growthCount(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal;
      session.calls.push(r.ms, growthCount(r.inputTotal) ? r.inputTotal : -1,
        Number.isSafeInteger(r.nanoAiu) && r.nanoAiu >= 0 && r.creditStatus === 'complete' ? r.nanoAiu : -1,
        split ? r.cacheRead : -1, r.initiator === 'user' ? 1 : 0);
      if (r.ms < session.latest) session.ordered = false; else session.latest = r.ms;
    },
    finish() {
      const at = GROWTH_POSITIONS.map(() => ({ inputs: [], ratios: [] }));
      let conversations = 0, measuredConversations = 0, grew2 = 0, grew5 = 0;
      let measuredInput = 0, lateInput = 0, lateCalls = 0, measuredCalls = 0, lateConversations = 0;
      let chargeCalls = 0, lateChargeCalls = 0, nano = 0, lateNano = 0, wideAll = 0n, wideLate = 0n;
      let lateSplitCalls = 0, lateSplitInput = 0, lateSplitRead = 0;
      for (const { calls: list, ordered } of sessions.values()) {
        const count = list.length / GROWTH_STRIDE;
        // Equal times keep the order the calls were recorded in.
        const order = ordered ? null : Array.from({ length: count }, (_, i) => i).sort((a, b) => list[a * GROWTH_STRIDE] - list[b * GROWTH_STRIDE] || a - b);
        conversations++;
        let start = -1, peak = 0, prompt = 0, startAtPrompt1 = -1, doubled = false, measured = 0, lateHere = false;
        for (let index = 0; index < count; index++) {
          const base = (order ? order[index] : index) * GROWTH_STRIDE;
          const input = list[base + 1], charge = list[base + 2], read = list[base + 3];
          if (list[base + 4] === 1) {
            prompt++;
            const place = GROWTH_POSITIONS.indexOf(prompt);
            if (place >= 0 && input >= 0) {
              at[place].inputs.push(input);
              if (place === 0) startAtPrompt1 = input;
              else if (startAtPrompt1 > 0) at[place].ratios.push(input / startAtPrompt1);
            }
          }
          if (input >= 0) {
            measured++; measuredCalls++; measuredInput += input;
            if (start < 0) start = input;
            else if (start > 0) {
              if (input > peak) peak = input;
              if (!doubled && input >= start * 2) doubled = true;
            }
            if (doubled) {
              lateCalls++; lateInput += input; lateHere = true;
              if (read >= 0) { lateSplitCalls++; lateSplitInput += input; lateSplitRead += read; }
            }
          }
          if (charge >= 0) {
            chargeCalls++;
            if (nano > Number.MAX_SAFE_INTEGER - charge) { wideAll += BigInt(nano); nano = 0; }
            nano += charge;
            if (doubled) {
              lateChargeCalls++;
              if (lateNano > Number.MAX_SAFE_INTEGER - charge) { wideLate += BigInt(lateNano); lateNano = 0; }
              lateNano += charge;
            }
          }
        }
        if (lateHere) lateConversations++;
        if (measured >= 2 && start > 0) {
          measuredConversations++;
          if (peak >= start * 2) grew2++;
          if (peak >= start * 5) grew5++;
        }
      }
      const allCredits = (wideAll ? Number(wideAll + BigInt(nano)) : nano) / 1e9, lateCredits = (wideLate ? Number(wideLate + BigInt(lateNano)) : lateNano) / 1e9;
      return {
        mainCalls, conversations, measuredCalls, measuredConversations, grew2, grew5, minimumConversations: GROWTH_MINIMUM,
        positions: GROWTH_POSITIONS.map((prompt, i) => {
          const { inputs, ratios } = at[i];
          return { prompt, conversations: inputs.length, input: inputs.length >= GROWTH_MINIMUM ? growthMiddle(inputs) : null,
            multiple: prompt === 1 ? (inputs.length >= GROWTH_MINIMUM ? 1 : null) : ratios.length >= GROWTH_MINIMUM ? growthMiddle(ratios) : null,
            multipleConversations: prompt === 1 ? inputs.length : ratios.length };
        }),
        later: { calls: lateCalls, conversations: lateConversations, input: measuredCalls ? lateInput : null, totalInput: measuredCalls ? measuredInput : null,
          chargeCalls, lateChargeCalls, credits: chargeCalls ? lateCredits : null, totalCredits: chargeCalls ? allCredits : null,
          splitCalls: lateSplitCalls, splitShare: lateSplitInput > 0 ? lateSplitRead / lateSplitInput * 100 : null },
      };
    },
  };
}
