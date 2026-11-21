// What the selected calls' tokens were made of, for the Efficiency overview.
// A call joins the mix only when it records an output count and a complete cache split, the same
// rules the shared measurement uses, so the four parts always add up to the calls they came from.
// Reasoning is part of output: it is split out only on mix calls that also record a valid count.
const mixKnown = value => Number.isFinite(value) && value >= 0;

export function createTokenMix() {
  let requests = 0, mixRequests = 0, uncachedInput = 0, cacheRead = 0, cacheWrite = 0, output = 0;
  let reasoningRequests = 0, reasoning = 0, otherOutput = 0;
  return {
    add(r) {
      requests++;
      if (r.cacheDetailsReported === false || !mixKnown(r.inputTotal) || !mixKnown(r.cacheRead) || !mixKnown(r.cacheWrite)
        || r.cacheRead + r.cacheWrite > r.inputTotal || !mixKnown(r.output)) return;
      mixRequests++;
      uncachedInput += r.inputTotal - r.cacheRead - r.cacheWrite; cacheRead += r.cacheRead; cacheWrite += r.cacheWrite; output += r.output;
      if (!mixKnown(r.reasoning) || r.reasoning > r.output) return;
      reasoningRequests++; reasoning += r.reasoning; otherOutput += r.output - r.reasoning;
    },
    // Unmeasured parts stay null: no call in the mix is different from a measured zero.
    finish() {
      const mix = value => mixRequests ? value : null, split = value => reasoningRequests ? value : null;
      return { requests, mixRequests, uncachedInput: mix(uncachedInput), cacheRead: mix(cacheRead), cacheWrite: mix(cacheWrite), output: mix(output),
        reasoningRequests, reasoning: split(reasoning), otherOutput: split(otherOutput) };
    },
  };
}
