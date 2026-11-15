import test from 'node:test'
import assert from 'node:assert/strict'
import { dayTicks, areaTrend, segmentBar, smoothPath, stackedBars, calendarHeatmap, punchCard, donut, hBars, sparkline, esc, levels, usageValue } from '../src/panel/charts.mjs'
import { pixelBanner, paintScene, skyFor, nextBuildingPatterns } from '../src/panel/art.mjs'
import { formatNumber, formatCredits } from '../src/core/format.mjs'

const day = (d, v) => ({ day: d, input: v, output: v / 2, cacheRead: v * 4, cacheWrite: v / 4, total: v * 5.75, credits: 0 })
const wellFormed = (s) => {
  assert.match(s, /^<svg [^>]*>/)
  assert.ok(s.endsWith('</svg>'))
  assert.ok(!/NaN|undefined|Infinity/.test(s), 'no NaN/undefined in markup')
}

test('esc escapes markup', () => {
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
})

test('stackedBars renders one mark per day with tooltips and handles empty', () => {
  const s = stackedBars([day('2026-10-28', 100), day('2026-10-29', 0), day('2026-10-30', 300)])
  wellFormed(s)
  assert.equal((s.match(/class="mark"/g) || []).length, 3)
  assert.match(s, /Oct 28/)
  assert.match(stackedBars([]), /No usage yet/)
  assert.match(stackedBars([day('2026-10-28', 0)]), /No usage yet/)
})
test('daily charts fit the available width without totals or a maximum label', () => {
  for (const count of [1, 7, 90, 500]) for (const textScale of [1, 1.3]) for (const simplify of [true, false]) {
    const days = Array.from({ length: count }, (_, i) => day(new Date(2026, 0, i + 1).toLocaleDateString('en-CA'), 10000000));
    const chart = stackedBars(days, { width: 280, textScale, selectable: true, fmt: n => formatNumber(n, { simplify }) });
    assert.match(chart, /viewBox="0 0 280 /);
    assert.doesNotMatch(chart, /min-width|daily-total|<text x="0"[^>]*class="t-muted"/);
    assert.equal((chart.match(/data-day=/g) || []).length, count);
    assert.ok(chart.includes(formatNumber(57500000, { simplify })), 'totals remain available in the tooltip');
  }
});

test('daily hover targets follow the columns rather than the whole day slot', () => {
  const chart = stackedBars([day('2026-11-12', 100), day('2026-11-13', 0), day('2026-11-14', 10)], { width: 600, selectable: true });
  const hits = [...chart.matchAll(/<rect class="column-hit" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
  assert.equal(hits.length, 3);
  assert.equal((chart.match(/class="daily-column"/g) || []).length, 3);
  assert.equal((chart.match(/class="column-outline"/g) || []).length, 3);
  for (const hit of hits) assert.ok(Number(hit[3]) < 200, 'target does not cover the whole slot');
  assert.ok(Number(hits[1][4]) <= 4, 'empty day has a small baseline target');
  assert.ok(Number(hits[2][4]) < Number(hits[0][4]) / 5, 'short bar has a short hit target');
  assert.ok(Number(hits[2][2]) > Number(hits[0][2]), 'target starts at the actual bar top');
  assert.doesNotMatch(chart, /class="hit"/);
  assert.match(chart, /data-day="2026-11-13"[^>]*tabindex="0"/);
});

test('small positive days remain visible beside large days without inventing usage on empty days', () => {
  const today = { input: 1000, output: 900, cacheRead: 6000, cacheWrite: 1000, total: 8900, credits: .001 };
  for (const count of [7, 15, 30, 90]) for (const keys of [['input', 'output', 'cacheRead', 'cacheWrite'], ['credits']]) {
    const days = Array.from({ length: count }, (_, i) => ({ ...day(new Date(2026, 0, i + 1).toLocaleDateString('en-CA'), 0) }));
    Object.assign(days[0], { input: 100_000_000, credits: 100 });
    Object.assign(days.at(-1), today);
    const before = structuredClone(days);
    const chart = stackedBars(days, { keys, height: 230, width: 600, selectable: true, selectedDay: days.at(-1).day });
    wellFormed(chart);
    const hits = [...chart.matchAll(/class="column-hit"[^>]*height="([^"]+)"/g)].map(match => Number(match[1]));
    assert.ok(hits.at(-1) >= 4, 'today must have a visible, usable target, even when its scaled height is below one pixel');
    assert.equal(hits[0], count <= 14 ? 182 : 194, 'the largest day retains its linear scale');
    assert.doesNotMatch(chart, /<clipPath id="sb-c1">/, 'zero days must not gain a colored stack');
    const stack = chart.split(`<g clip-path="url(#sb-c${count - 1})">`)[1].split('</g>')[0];
    const segments = [...stack.matchAll(/height="([^"]+)" fill=/g)].map(match => Number(match[1]));
    const total = keys.reduce((sum, key) => sum + today[key], 0);
    assert.equal(segments.length, keys.length);
    for (const [i, key] of keys.entries()) assert.ok(Math.abs(segments[i] / hits.at(-1) - today[key] / total) < 1e-10, 'minimum-height stacks retain their token mix');
    assert.match(chart, /Minimum height for visibility/);
    assert.ok(chart.includes(keys.length > 1 ? 'Total: 8900' : 'credits: 0.001'), 'accessible tooltip values retain the real amount');
    assert.ok(chart.includes(`data-day="${days.at(-1).day}" role="button" tabindex="0" aria-pressed="true"`));
    assert.deepEqual(days, before, 'rendering never changes recorded counts');
  }
  const single = stackedBars([{ ...today, day: '2026-11-15' }], { height: 230, selectable: true });
  assert.doesNotMatch(single, /Minimum height for visibility/, 'Today-only charts retain their normal scale');
});

test('column tooltips preserve full numbers and partial, unavailable, and zero charges', () => {
  const tokens = [{ ...day('2026-11-12', 1000), requests: 1, knownTokenRequests: 1 },
    { ...day('2026-11-13', 10), requests: 2, knownTokenRequests: 1, missingTokens: 1 },
    { ...day('2026-11-14', 0), requests: 1, knownTokenRequests: 0, missingTokens: 1 }];
  const chart = stackedBars(tokens, { fmt: n => formatNumber(n, { simplify: false }) });
  assert.ok(chart.includes(formatNumber(5750, { simplify: false })));
  assert.match(chart, /57\.5 \*/);
  assert.match(chart, /Unavailable/);
  const credits = [{ day: '2026-11-12', credits: 0, requests: 1 }, { day: '2026-11-13', credits: 1.234, requests: 1 },
    { day: '2026-11-14', credits: 2, requests: 1, partialCredits: 1 }, { day: '2026-11-15', credits: null, requests: 1, missingCredits: 1 }];
  const creditChart = stackedBars(credits, { keys: ['credits'], fmt: formatCredits });
  assert.match(creditChart, /1\.2/);
  assert.match(creditChart, /2 \*/);
  assert.match(creditChart, /Unavailable/);
  assert.match(stackedBars([credits[0]], { keys: ['credits'], selectable: true }), /&quot;credits&quot;,&quot;0&quot;/);
});

test('usage displays preserve unavailable and partial credits and token categories', () => {
  const days = [{ day: '2026-11-12', credits: null, missingCredits: 1, requests: 1 }, { day: '2026-11-13', credits: 2, partialCredits: 1, requests: 1 }];
  const svg = stackedBars(days, { keys: ['credits'], labels: { credits: 'AI credits' }, colors: { credits: 'blue' } });
  assert.match(svg, /Unavailable/);
  assert.match(svg, /2 \*/);
  assert.equal(usageValue({ output: 0, requests: 1, missing: { output: 1 } }, 'output'), 'Unavailable');
  assert.equal(usageValue({ output: 20, requests: 2, missing: { output: 1 } }, 'output'), '20 *');
  assert.equal(usageValue({ total: 0, requests: 1, knownTokenRequests: 0, missingTokens: 1 }, 'total'), 'Unavailable');
});

test('selectable daily bars expose date buttons and selection, including zero days', () => {
  const s = stackedBars([day('2026-11-12', 100), day('2026-11-13', 0)], { selectable: true, selectedDay: '2026-11-13' });
  wellFormed(s);
  assert.match(s, /role="group"/);
  assert.equal((s.match(/role="button"/g) || []).length, 2);
  assert.equal((s.match(/tabindex="0"/g) || []).length, 2);
  assert.match(s, /data-day="2026-11-13"[^>]*aria-pressed="true"/);
  assert.match(s, /aria-describedby="sb-d0"/);
  assert.match(s, /<desc id="sb-d0">Input: 100; Output: 50; Cache read: 400; Cache write: 25; Total: 575<\/desc>/);
  const credits = stackedBars([{ day: '2026-11-13', credits: 1.2 }], { keys: ['credits'], labels: { credits: 'AI credits' }, selectable: true });
  assert.match(credits, /<desc id="sb-d0">AI credits: 1.2<\/desc>/);
  assert.match(stackedBars([day('2026-11-13', 0)], { selectable: true }), /data-day="2026-11-13"/);
});

test('dense daily bars stay inside their selectable day slots', () => {
  const days = Array.from({ length: 500 }, (_, i) => day(new Date(2025, 0, i + 1).toLocaleDateString('en-CA'), 10));
  const s = stackedBars(days, { width: 360, selectable: true });
  const barWidth = Number(s.match(/<clipPath[^>]*><rect[^>]*width="([^"]+)"/)[1]);
  const chartWidth = Number(s.match(/viewBox="0 0 ([^ ]+)/)[1]);
  assert.ok(barWidth <= chartWidth / days.length, 'a neighboring day must not cover the clicked bar');
});

test('calendarHeatmap places every day and uses quantile levels', () => {
  const cal = Array.from({ length: 182 }, (_, i) => ({ day: new Date(2026, 4, 5 + i).toLocaleDateString('en-CA'), total: i % 3 ? i : 0 }))
  const s = calendarHeatmap(cal)
  wellFormed(s)
  assert.equal((s.match(/class="mark cell/g) || []).length, 182)
  assert.deepEqual(levels([0, 1, 2, 3, 4]), [0, 1, 2, 3, 4])
  assert.deepEqual(levels([0, 0]), [0, 0])
})

test('punchCard draws 168 cells', () => {
  const grid = Array.from({ length: 168 }, (_, i) => i % 5)
  const s = punchCard(grid)
  wellFormed(s)
  assert.equal((s.match(/<circle/g) || []).length, 168)
  assert.match(punchCard([]), /No usage yet/)
})

test('donut skips zero segments and escapes labels', () => {
  const s = donut([{ label: '<b>', value: 3, color: 'red' }, { label: 'b', value: 0, color: 'blue' }, { label: 'c', value: 1, color: 'green' }])
  wellFormed(s)
  assert.equal((s.match(/class="mark"/g) || []).length, 2)
  assert.ok(!s.includes('<b>'))
  wellFormed(donut([]))
})

test('hBars truncates long labels and escapes', () => {
  const s = hBars([{ label: 'a-very-long-model-name-that-overflows', value: 10 }, { label: '<x>', value: 0 }])
  wellFormed(s)
  assert.match(s, /…/)
  assert.ok(!s.includes('<x>'))
})

test('selectable model bars expose keyboard controls and retain gray alternatives', () => {
  const items = [{ label: '<Alpha>', value: 20 }, { label: 'Beta', value: 10 }];
  const s = hBars(items, { selectable: true, selectedLabel: '<Alpha>' });
  wellFormed(s);
  assert.match(s, /role="group"/);
  assert.match(s, /data-usage-model="&lt;Alpha&gt;" role="button" tabindex="0" aria-pressed="true"/);
  assert.match(s, /class="mark choice-muted"[^>]*data-usage-model="Beta"[^>]*aria-pressed="false"/);
  assert.match(s, /clear model filter/);
  assert.doesNotMatch(hBars(items), /data-usage-model|aria-pressed|choice-muted/);
});

test('ranking bars reserve room for full trillion-scale values at every text size', () => {
  const note = (42_244_916_000_000).toLocaleString();
  for (const textScale of [1, 1.15, 1.3]) {
    const s = hBars([{ label: 'Long model name', value: 42_244_916_000_000, note }], { width: 280, textScale });
    wellFormed(s);
    const width = Number(s.match(/viewBox="0 0 ([\d.]+)/)[1]);
    const bar = s.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]+class="bar"/);
    const valueSpace = width - Number(bar[1]) - Number(bar[2]);
    assert.ok(valueSpace >= note.length * 6 * textScale, 'full number does not overlap the bar');
    assert.ok(Number(bar[2]) > 0);
    assert.ok(s.includes(note));
  }
});

test('sparkline handles short series', () => {
  wellFormed(sparkline([1]))
  wellFormed(sparkline([1, 4, 2]))
})

test('pixel banner is deterministic for a report', () => {
  const report = { generatedAt: new Date(2026, 10, 3, 22).toISOString(), query: { range: '7d' }, daily: [1, 5, 2, 9, 3, 7, 4].map((v) => ({ total: v })), totals: { total: 100, output: 2, turns: 10 }, streak: { current: 3 }, today: { total: 4 }, peakDay: { total: 9 } }
  const a = pixelBanner(report)
  wellFormed(a)
  assert.equal(a, pixelBanner(report))
  const grid = paintScene(report)
  assert.equal(grid.length, 34)
  assert.equal(grid[0].length, 120)
  assert.ok(grid.every((row) => row.every((c) => /^#[0-9a-f]{6}$/.test(c))))
  wellFormed(pixelBanner({}))
  assert.equal(skyFor(12), 'day')
  assert.equal(skyFor(23), 'night')
})

test('banner presets use the requested fixed positions; all shows four and custom shows none', () => {
  const report = { generatedAt: new Date(2026, 10, 14, 22, 0).toISOString(), daily: [{ total: 100 }], totals: { total: 100, output: 2 }, streak: { current: 3 } };
  const buildings = grid => {
    const spans = [];
    for (const [x, color] of grid.at(-1).entries()) {
      if (color !== '#12152c') continue;
      if (spans.at(-1)?.end === x - 1) spans.at(-1).end = x;
      else spans.push({ start: x, end: x });
    }
    return spans;
  };
  for (const [w, h] of [[120, 34], [120, 62], [200, 40]]) {
    const expected = [['1d', .26], ['7d', .43], ['30d', .60], ['90d', .93]];
    const all = paintScene({ ...report, query: { range: 'all' } }, { w, h });
    const allBuildings = buildings(all);
    assert.equal(allBuildings.length, 4, 'all history shows all four even with only one day of data');
    for (const [index, [range, center]] of expected.entries()) {
      const grid = paintScene({ ...report, query: { range } }, { w, h });
      const spans = buildings(grid);
      assert.equal(spans.length, 1, range + ' shows exactly one building');
      assert.ok(Math.abs((spans[0].start + spans[0].end) / (2 * w) - center) < .02, range + ' matches its marked position');
      assert.deepEqual(spans[0], allBuildings[index], 'all history keeps each building in the same place');
      for (let y = 0; y < h; y++) assert.deepEqual(grid[y].slice(spans[0].start, spans[0].end + 1), all[y].slice(spans[0].start, spans[0].end + 1), 'window patterns are consistent between individual and all-history views');
      assert.deepEqual(paintScene({ ...report, query: { range }, daily: [], totals: { total: 0, output: 0 } }, { w, h }), grid, 'data volume does not control these decorative buildings');
    }
    assert.equal(buildings(paintScene({ ...report, query: { range: 'custom' } }, { w, h })).length, 0);
  }
});

test('Rolling 30 shares the 30-day building and light cycle', () => {
  const report = { generatedAt: new Date(2026, 10, 15, 22).toISOString() };
  let patterns = nextBuildingPatterns({}, null, 'mtd');
  for (let visit = 0; visit < 4; visit++) {
    assert.equal(patterns['30d'], visit % 3);
    assert.deepEqual(paintScene({ ...report, query: { range: 'mtd' } }, { patterns }), paintScene({ ...report, query: { range: '30d' } }, { patterns }));
    assert.deepEqual(nextBuildingPatterns(patterns, 'mtd', '30d'), patterns, 'same visible building keeps its pattern');
    assert.deepEqual(nextBuildingPatterns(patterns, '30d', 'mtd'), patterns);
    patterns = nextBuildingPatterns(nextBuildingPatterns(patterns, 'mtd', '7d'), '7d', 'mtd');
  }
});

test('each building has three distinct light patterns that stay still over time', () => {
  for (const range of ['1d', '7d', '30d', '90d']) {
    const report = { generatedAt: new Date(2026, 10, 14, 22, 0).toISOString(), query: { range }, streak: { current: 3 } };
    const patterns = [0, 1, 2].map(pattern => paintScene(report, { patterns: { [range]: pattern } }));
    assert.equal(new Set(patterns.map(grid => JSON.stringify(grid))).size, 3, range + ' has three different patterns');
    for (const [pattern, grid] of patterns.entries()) {
      assert.deepEqual(paintScene({ ...report, generatedAt: new Date(2026, 10, 14, 22, 15).toISOString() }, { patterns: { [range]: pattern } }), grid, 'refresh timestamps do not change the lights');
      grid.forEach((row, y) => row.forEach((color, x) => {
        if (color === patterns[0][y][x]) return;
        assert.deepEqual(new Set([color, patterns[0][y][x]]), new Set(['#12152c', '#ffd27a']), 'only window lights change between patterns');
      }));
    }
  }
});

test('areaTrend draws one smoothed line per provider with hover columns', () => {
  const mk = (p, vals) => ({ provider: p, daily: vals.map((v, i) => ({ day: `2026-10-2${i}`, total: v, credits: v / 10 })) })
  const s = areaTrend([mk('copilot', [5, 9, 0, 3]), mk('model-b', [1, 2, 8, 4])])
  wellFormed(s)
  assert.equal((s.match(/stroke-width="2"/g) || []).length, 2)
  assert.equal((s.match(/class="mark xhair"/g) || []).length, 4)
  wellFormed(areaTrend([mk('copilot', [1])]))
  assert.match(areaTrend([mk('copilot', [0, 0])]), /No usage yet/)
  assert.match(areaTrend([mk('copilot', [5, 9])], { metric: 'credits', fmt: (v) => '$' + v }), /\$/)
})

test('smoothPath never dips below the lowest point (monotone)', () => {
  const pts = [[0, 100], [10, 100], [20, 0], [30, 100]]
  const ys = [...smoothPath(pts).matchAll(/-?\d+\.\d/g)].map((m) => Number(m[0]))
  assert.ok(Math.max(...ys) <= 100.05)
})

test('segmentBar gives tiny segments a visible minimum width and skips zeros', () => {
  const s = segmentBar([{ label: 'a', value: 1, color: 'red' }, { label: 'b', value: 0, color: 'x' }, { label: 'c', value: 1e6, color: 'blue' }])
  wellFormed(s)
  assert.equal((s.match(/class="mark"/g) || []).length, 2)
  assert.match(s, /width="4\.0"/)
  wellFormed(segmentBar([]))
})

test('segment shares use token counts, preserve tiny shares, and expose categories accessibly', () => {
  const s = segmentBar([{ label: '<Input>', value: 25, color: 'blue' }, { label: 'Cache read', value: 75, color: 'green' }, { label: 'Zero', value: 0, color: 'red' }])
  assert.match(s, /aria-label="Tokens by type, shares of recorded tokens: &lt;Input&gt; 25%; Cache read 75%"/)
  assert.match(s, />25%<\/text>/)
  assert.match(s, />75%<\/text>/)
  assert.doesNotMatch(s, /<Input>|Zero|0%<\/text>/)
  const tiny = segmentBar([{ label: 'Tiny', value: 1, color: 'blue' }, { label: 'Large', value: 1e9, color: 'green' }])
  assert.match(tiny, /width="4\.0"/)
  assert.match(tiny, />&lt;0\.1%<\/text>/)
  assert.match(tiny, />&gt;99\.9%<\/text>/)
  assert.match(segmentBar([{ label: 'Only', value: 1, color: 'blue' }]), />100%<\/text>/)
  for (const empty of [[], [{ label: 'Zero', value: 0 }]]) {
    const chart = segmentBar(empty)
    wellFormed(chart)
    assert.doesNotMatch(chart, /segment-share|NaN|Infinity/)
  }
})

test('alternating segment share labels stay apart and inside narrow charts at every text size', () => {
  for (const values of [[1, 1, 1, 1e9], [1e9, 1, 1, 1], [1, 1, 1, 1, 1e9], [1e9, 1, 1, 1, 1], [1, 2, 3, 4, 5]]) {
    for (const width of [280, 360, 1100]) for (const textScale of [1, 1.15, 1.3]) {
      const chart = segmentBar(values.map((value, i) => ({ label: `Type ${i}`, value, color: 'blue' })), { width, textScale })
      wellFormed(chart)
      const labels = [...chart.matchAll(/<text class="segment-share" x="([\d.]+)" y="([\d.]+)" text-anchor="middle">(.*?)<\/text>/g)]
      assert.equal(labels.length, values.length)
      const height = Number(chart.match(/viewBox="0 0 \S+ (\S+)"/)[1])
      const rows = [[], []]
      labels.forEach(([, x, y, text], i) => {
        const plain = text.replace(/&lt;|&gt;/g, '<'), half = plain.length * 7 * textScale / 2
        const left = Number(x) - half, right = Number(x) + half
        assert.ok(left >= 0 && right <= width, 'label remains inside chart')
        assert.ok(Number(y) >= 11 * textScale && Number(y) + 3 * textScale <= height, 'vertical text has room')
        assert.equal(Number(y) < height / 2, i % 2 === 0, 'labels alternate above and below')
        const row = rows[i % 2]
        if (row.length) assert.ok(left - row.at(-1) >= 4 * textScale, 'same-side labels do not collide')
        row.push(right)
      })
      assert.equal((chart.match(/class="segment-bracket"/g) || []).length, values.length)
    }
  }
})

test('dayTicks labels every day when there is room and always keeps the latest', () => {
  assert.deepEqual(dayTicks(7, 120), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(dayTicks(30, 10), [4, 9, 14, 19, 24, 29])
  assert.deepEqual(dayTicks(1, 300), [0])
})

test('stackedBars labels each of 7 days with its weekday', () => {
  const days = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']
  const s = stackedBars(days.map((d, i) => day(d, i + 1)), { width: 900 })
  for (const d of ['Oct 28', 'Oct 29', 'Oct 30', 'Oct 31', 'Nov 1', 'Nov 2', 'Nov 3']) assert.ok(s.includes(`>${d}<`), d)
  assert.match(s, />Tue</)
})

test('larger chart text gets more label room while daily bars stay selectable', () => {
  const days = Array.from({ length: 7 }, (_, i) => day(`2026-11-0${i + 1}`, 100));
  const small = stackedBars(days, { width: 360, selectable: true });
  const large = stackedBars(days, { width: 360, selectable: true, textScale: 1.3 });
  assert.equal((large.match(/role="button"/g) || []).length, 7);
  assert.ok((large.match(/>Nov \d</g) || []).length < (small.match(/>Nov \d</g) || []).length);
  assert.match(large, />Nov 7</);
  const ranking = [{ label: 'Long model name that needs room', value: 1 }, { label: 'Second', value: 2 }];
  const height = html => Number(html.match(/viewBox="0 0 \S+ (\S+)"/)[1]);
  assert.ok(height(hBars(ranking, { textScale: 1.3 })) > height(hBars(ranking)));
});

test('daily date labels stay within dense charts without overlapping at every text size', () => {
  const days = Array.from({ length: 90 }, (_, i) => day(new Date(2026, 7, 16 + i).toLocaleDateString('en-CA'), 100));
  for (const width of [280, 500]) for (const textScale of [1, 1.15, 1.3]) {
    const chart = stackedBars(days, { width, textScale, selectable: true });
    const chartWidth = Number(chart.match(/viewBox="0 0 ([^ ]+)/)[1]);
    const labels = [...chart.matchAll(/<text x="([^"]+)"[^>]*text-anchor="middle">([A-Z][a-z]{2} \d+)<\/text>/g)];
    const halfLabel = 23 * textScale;
    assert.ok(labels.length > 1);
    assert.equal(labels.at(-1)[2], 'Nov 13', 'latest date stays visible');
    for (let i = 0; i < labels.length; i++) {
      const x = Number(labels[i][1]);
      assert.ok(x - halfLabel >= -0.1 && x + halfLabel <= chartWidth + 0.1, 'date labels fit within the chart');
      if (i) assert.ok(x - Number(labels[i - 1][1]) >= halfLabel * 2 - 0.1, 'neighboring dates have room');
    }
    assert.equal((chart.match(/role="button"/g) || []).length, 90);
  }
});
