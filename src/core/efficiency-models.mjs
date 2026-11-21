// Who started each model's calls: the main conversation (the user's own prompt, or the main agent
// carrying on) or a subagent. A call with no recorded initiator is counted as not recorded, never
// as main. Three counters per model, and only the busiest models are kept, so the result stays
// small whatever the size of the history.
export const MODEL_MIX_LIMIT = 12;

export function createModelMix() {
  const byModel = new Map();
  let model, row, requests = 0;
  return {
    add(record) {
      requests++;
      if (record.model !== model || !row) {
        model = record.model; row = byModel.get(model);
        if (!row) byModel.set(model, row = { main: 0, subagent: 0, unrecorded: 0 });
      }
      if (record.initiator === 'user' || record.initiator === 'agent') row.main++;
      else if (record.initiator === 'sub-agent') row.subagent++;
      else row.unrecorded++;
    },
    finish() {
      const all = [...byModel].map(([name, r]) => ({ name, calls: r.main + r.subagent + r.unrecorded, ...r }))
        .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
      return { requests, models: all.length, rows: all.slice(0, MODEL_MIX_LIMIT) };
    },
  };
}
