// How the tool-definition footprint relates to how many tools were available, and where it differs
// by project. A call joins a group only when the figures that group needs are recorded: an unknown
// count or unknown definition size is never zero. Memory is one entry per distinct tool count and
// one per project; the report keeps three groups and five projects.

import { medianFromCounts } from './stats.mjs';

// A project is listed only with this many calls that record their definition tokens, and at most
// this many projects are listed.
export const TOOL_PROJECT_MIN_CALLS = 20, TOOL_PROJECT_ROWS = 5;
// A group of tool counts needs this many measured calls before a comparison between groups is drawn.
export const TOOL_GROUP_MIN_CALLS = 20;
const GROUPS = 3;

const known = value => Number.isFinite(value) && value >= 0;
const ratio = (part, total) => total > 0 ? part / total * 100 : null;
const mean = (sum, count) => count ? sum / count : null;

export function createToolFootprint() {
  // By available tool count: calls that record it, and of those the calls whose definition size is
  // also recorded and fits inside the input (the same rule the summary uses).
  const counts = new Map(), projects = new Map();
  let requests = 0, countCalls = 0, pairedCalls = 0, countSum = 0;
  return {
    add(record) {
      requests++;
      const definitions = known(record.toolTokenCount) && known(record.inputTotal) && record.toolTokenCount <= record.inputTotal;
      const available = known(record.availableToolCount);
      if (available) {
        countCalls++; countSum += record.availableToolCount;
        let row = counts.get(record.availableToolCount);
        if (!row) counts.set(record.availableToolCount, row = { calls: 0, measured: 0, tokens: 0, input: 0 });
        row.calls++;
        if (definitions) { pairedCalls++; row.measured++; row.tokens += record.toolTokenCount; row.input += record.inputTotal; }
      }
      if (definitions && typeof record.project === 'string' && record.project) {
        let row = projects.get(record.project);
        if (!row) projects.set(record.project, row = { calls: 0, tokens: 0, input: 0, countCalls: 0, countSum: 0 });
        row.calls++; row.tokens += record.toolTokenCount; row.input += record.inputTotal;
        if (available) { row.countCalls++; row.countSum += record.availableToolCount; }
      }
    },
    finish() {
      const values = [...counts.keys()].sort((a, b) => a - b);
      // The middle call by available tool count: exact median across calls that record it.
      const medianAvailable = medianFromCounts(values.map(v => [v, counts.get(v).calls]), countCalls);
      // Up to three groups of neighbouring tool counts, each holding about a third of the calls that
      // record a count. A group never splits one count, so a history with one count has no groups.
      const groups = [];
      let seen = 0;
      for (const value of values) {
        const row = counts.get(value);
        let group = groups.at(-1);
        if (!group || seen >= countCalls * groups.length / GROUPS && groups.length < GROUPS) groups.push(group = { min: value, max: value, calls: 0, measured: 0, tokens: 0, input: 0 });
        group.max = value; group.calls += row.calls; group.measured += row.measured; group.tokens += row.tokens; group.input += row.input;
        seen += row.calls;
      }
      const buckets = groups.length < 2 ? [] : groups.map(group => ({ ...group, averageTokens: mean(group.tokens, group.measured), share: ratio(group.tokens, group.input) }));

      const eligible = [];
      for (const [name, row] of projects) if (row.calls >= TOOL_PROJECT_MIN_CALLS) eligible.push({ name, ...row });
      const top = [];
      for (const row of eligible) {
        const average = row.tokens / row.calls;
        let place = top.length;
        while (place > 0 && (top[place - 1].averageTokens < average || top[place - 1].averageTokens === average && top[place - 1].name > row.name)) place--;
        if (place < TOOL_PROJECT_ROWS) {
          top.splice(place, 0, { name: row.name, calls: row.calls, averageTokens: average, share: ratio(row.tokens, row.input), averageAvailable: mean(row.countSum, row.countCalls), countCalls: row.countCalls });
          if (top.length > TOOL_PROJECT_ROWS) top.pop();
        }
      }
      return { requests, countCalls, pairedCalls, medianAvailable, minimumGroupCalls: TOOL_GROUP_MIN_CALLS, buckets,
        minimumProjectCalls: TOOL_PROJECT_MIN_CALLS, measuredProjects: projects.size, listedProjects: eligible.length, projects: top };
    },
  };
}
