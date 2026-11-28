// Shared, aggregate-only comparison rules. A change in observed coverage is not a behavioral trend.
export function conversationComparison(conversations, topic, loading = false) {
  if (loading) return { reason: 'History is still loading.' };
  const c = conversations, previous = c?.comparison?.previous;
  if (!previous) return { reason: 'Choose a bounded date range to compare with the preceding period.' };
  const metric = row => {
    if (topic === 'work') return { value: row.promptWork?.medianCalls, samples: row.promptWork?.prompts || 0,
      total: (row.promptWork?.totalPrompts || 0) + (row.delivery?.unconfirmedPrompts || 0), minimum: 10, unit: 'calls / prompt' };
    if (topic === 'guidance') return { value: row.delivery?.known ? row.delivery.steering / row.delivery.known * 100 : null,
      samples: row.delivery?.known || 0, total: (row.delivery?.prompts || 0) + (row.delivery?.unconfirmedPrompts || 0), minimum: 10, unit: '% steering' };
    return { value: topic === 'returning' ? row.countedSessions ? row.multiDaySessions / row.countedSessions * 100 : null : row.medianPrompts,
      samples: row.countedSessions || 0, total: row.sessions || 0, minimum: 5, unit: topic === 'returning' ? '% multi-day' : 'prompts / conversation' };
  };
  const current = metric(c), before = metric(previous);
  if (![current, before].every(m => Number.isFinite(m.value) && m.samples >= m.minimum && m.total > 0))
    return { reason: 'Not enough comparable observations in both periods yet.' };
  if (Math.abs(current.samples / current.total - before.samples / before.total) > .1 + Number.EPSILON)
    return { reason: 'Recorded coverage differs between periods; a comparison could mislead.' };
  return { current: current.value, previous: before.value, unit: current.unit, samples: current.samples, total: current.total,
    previousSamples: before.samples, previousTotal: before.total,
    startDate: c.comparison.startDate, endDate: c.comparison.endDate };
}
