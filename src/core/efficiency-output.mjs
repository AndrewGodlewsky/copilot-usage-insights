// How generated output is spread across model calls, grouped by the output of one call.
// A call joins a group only when its output count is known: an unknown count is never zero.
// Four counters, whatever the size of the history.

// The largest output, in tokens, of each size group. The last group has no upper limit.
export const OUTPUT_SIZE_LIMITS = [200, 1000, 4000];

const shareOf = (part, total) => total > 0 ? part / total * 100 : null;

export function createOutputMix() {
  const calls = OUTPUT_SIZE_LIMITS.map(() => 0).concat(0), tokens = calls.slice();
  let requests = 0;
  return {
    add(record) {
      requests++;
      const output = record.output;
      if (!Number.isFinite(output) || output < 0) return;
      let at = 0;
      while (at < OUTPUT_SIZE_LIMITS.length && output > OUTPUT_SIZE_LIMITS[at]) at++;
      calls[at]++; tokens[at] += output;
    },
    finish() {
      const outputRequests = calls.reduce((sum, count) => sum + count, 0), outputTokens = tokens.reduce((sum, count) => sum + count, 0);
      const buckets = calls.map((count, at) => ({ min: at ? OUTPUT_SIZE_LIMITS[at - 1] + 1 : 0, max: OUTPUT_SIZE_LIMITS[at] ?? null, calls: count, tokens: tokens[at],
        callShare: shareOf(count, outputRequests), tokenShare: shareOf(tokens[at], outputTokens) }));
      // The fewest of the largest groups that together hold at least half of the output. It stays
      // null when that would take every group, because then no size separates the calls.
      let concentration = null;
      for (let at = calls.length - 1, count = 0, total = 0; at > 0 && outputTokens > 0 && !concentration; at--) {
        count += calls[at]; total += tokens[at];
        if (total * 2 >= outputTokens) concentration = { over: OUTPUT_SIZE_LIMITS[at - 1], calls: count, tokens: total,
          callShare: shareOf(count, outputRequests), tokenShare: shareOf(total, outputTokens) };
      }
      return { requests, outputRequests, outputTokens, buckets, concentration };
    },
  };
}
