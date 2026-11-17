const growthKnown = n => Number.isFinite(n) && n >= 0;
const growthKinds = ['growing', 'steady', 'spike', 'falling', 'mixed'];
function growthQuantile(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p, low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}
const growthMedian = values => growthQuantile(values.slice().sort((a, b) => a - b), .5);
function growthShape(points, filtered) {
  const values = points.map(p => p.input), first = points[0];
  if (filtered || points.length < 6 || points.some((p, i) => !growthKnown(p.input) || !p.modelId || p.modelId !== first.modelId ||
      p.boundary || i > 0 && p.ms <= points[i - 1].ms)) return { kind: 'mixed', early: null, late: null, change: null, ratio: null };
  const early = growthMedian(values.slice(0, 3)), late = growthMedian(values.slice(-3));
  let peak = 0, floor = Infinity;
  for (const v of values) { peak = Math.max(peak, v); floor = Math.min(floor, v); }
  const change = late - early, threshold = Math.max(8000, early * .25);
  let kind = 'mixed';
  if (peak >= Math.max(early, late) * 1.6 && peak - Math.max(early, late) >= 20000 && late <= peak * .65) kind = 'spike';
  else if (change > threshold) kind = 'growing';
  else if (change < -threshold) kind = 'falling';
  else if (peak - floor <= Math.max(16000, growthMedian(values) * .4)) kind = 'steady';
  return { kind, early, late, change, ratio: early > 0 ? late / early : null };
}
const growthBucket = () => ({ sessions: 0, comparable: 0, prompts: 0, inputRequests: 0, cacheRequests: 0, cacheInput: 0, cacheRead: 0, changes: [], ratios: [], positions: [] });
function finishGrowthBucket(b) {
  const { changes, ratios, positions, ...counts } = b;
  return { ...counts, medianChange: growthMedian(changes), medianRatio: growthMedian(ratios),
    curve: positions.flatMap((p, i) => {
      if (!p || p.input.length < 3) return [];
      p.input.sort((a, b) => a - b); p.change.sort((a, b) => a - b);
      return [{ turn: i + 1, sessions: p.input.length, median: growthQuantile(p.input, .5), low: growthQuantile(p.input, .25), high: growthQuantile(p.input, .75),
        change: growthQuantile(p.change, .5), changeLow: growthQuantile(p.change, .25), changeHigh: growthQuantile(p.change, .75) }];
    }) };
}

// Receives already deduplicated, attributed prompts during the existing report pass.
export function createContextGrowthAccumulator(query, start, end, now) {
  const groups = new Map(), nowMs = now.getTime();
  const models = query.models && new Set(query.models);
  let unconfirmedPrompts = 0;
  return {
    add(p) {
      if (p.day < start || p.day > end || !Number.isFinite(p.sample?.ms) || p.sample.ms > nowMs ||
          query.project && query.project !== p.project || query.session && query.session !== p.sessionId || !p.provider) return;
      const key = p.sessionId;
      let group = groups.get(key);
      if (!group) groups.set(key, group = { key, sessionId: p.sessionId, project: p.project, points: [] });
      else if (group.project !== p.project) group.project = 'Multiple projects';
      if (!p.identity || !p.humanDelivery) {
        unconfirmedPrompts++; group.incomplete = true; group.points.push({ ms: p.sample.ms, unconfirmed: true }); return;
      }
      const r = p.linksKnown ? p.contextRecord : null;
      const visible = !models || models.has(r?.model);
      const input = r && r.ms >= p.sample.ms && r.ms <= nowMs && growthKnown(r.inputTotal) ? r.inputTotal : null;
      const cache = input != null && r.cacheDetailsReported !== false && growthKnown(r.cacheRead) && growthKnown(r.cacheWrite) && r.cacheRead + r.cacheWrite <= input ? r.cacheRead : null;
      group.points.push({ ms: p.sample.ms, input, cache, modelId: r?.modelId || null, model: r?.model || '', boundary: !!p.contextBoundary, visible });
    },
    finish(labels = new Map()) {
      const total = growthBucket(), buckets = Object.fromEntries(growthKinds.map(k => [k, growthBucket()])), candidates = [];
      for (const group of groups.values()) {
        let { points } = group;
        if (!points.some(p => p.visible)) continue;
        points.sort((a, b) => a.ms - b.ms);
        if (group.incomplete) {
          let gap = false;
          points = points.filter(p => { if (p.unconfirmed) { gap = true; return false; } if (gap) { p.boundary = true; gap = false; } return true; });
        }
        const filtered = points.some(p => !p.visible), shape = growthShape(points, filtered || group.incomplete), bucket = buckets[shape.kind];
        let measured = 0, peak = null;
        for (const b of [total, bucket]) {
          b.sessions++;
          if (shape.change != null) { b.comparable++; b.changes.push(shape.change); if (shape.ratio != null) b.ratios.push(shape.ratio); }
        }
        points.forEach((p, index) => {
          if (!p.visible) return;
          if (p.input != null) { measured++; peak = Math.max(peak ?? 0, p.input); }
          for (const b of [total, bucket]) {
            b.prompts++;
            if (p.input != null) b.inputRequests++;
            if (p.cache != null) { b.cacheRequests++; b.cacheInput += p.input; b.cacheRead += p.cache; }
            // Mixed/unknown histories remain inspectable but cannot establish a population trend.
            if (shape.kind !== 'mixed' && index < 40) {
              const pos = b.positions[index] || (b.positions[index] = { input: [], change: [] });
              pos.input.push(p.input); pos.change.push(p.input - points[0].input);
            }
          }
        });
        candidates.push({ ...group, points, ...shape, filtered, measured, peak, latest: points.at(-1).ms });
      }
      candidates.sort((a, b) => b.latest - a.latest || a.key.localeCompare(b.key));
      // Round-robin across shapes, newest first within each; examples never determine the totals.
      const perKind = growthKinds.map(k => candidates.filter(c => c.kind === k)), selected = [];
      for (let n = 0; selected.length < 25 && n < candidates.length; n++) {
        let found = false;
        for (const list of perKind) if (list[n] && selected.length < 25) { selected.push(list[n]); found = true; }
        if (!found) break;
      }
      const examples = selected.map(s => ({ key: s.key, project: s.project, name: labels.get(s.sessionId) || 'Unnamed session', kind: s.kind,
        early: s.early, late: s.late, change: s.change, peak: s.peak, prompts: s.points.filter(p => p.visible).length, measured: s.measured,
        filtered: s.filtered, pointsOmitted: Math.max(0, s.points.length - 80), points: s.points.slice(0, 80).map((p, i) => ({
          turn: i + 1, input: p.visible ? p.input : null, cache: p.visible ? p.cache : null, model: p.model, visible: p.visible,
          breakBefore: !p.modelId || p.boundary || i > 0 && (s.points[i - 1].boundary || s.points[i - 1].modelId !== p.modelId || s.points[i - 1].ms >= p.ms),
        })) }));
      return { ...finishGrowthBucket(total), unconfirmedPrompts, patterns: Object.fromEntries(growthKinds.map(k => [k, finishGrowthBucket(buckets[k])])),
        examples, examplesOmitted: candidates.length - examples.length, curveLimit: 40, examplePointLimit: 80, minimumContributors: 3 };
    },
  };
}
