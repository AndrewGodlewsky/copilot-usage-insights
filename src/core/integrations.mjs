const emptyServer = name => ({ name, calls: 0, successes: 0, failures: 0, unknown: 0, successRate: null, lastUsed: null, status: 'unavailable' });

export function mcpHistory(tools) {
  const groups = new Map();
  for (const tool of tools.rows) {
    if (!tool.server) continue;
    if (!groups.has(tool.server)) groups.set(tool.server, emptyServer(tool.server));
    const row = groups.get(tool.server);
    for (const key of ['calls', 'successes', 'failures', 'unknown']) row[key] += tool[key];
    if (!row.lastUsed || tool.lastUsed > row.lastUsed) row.lastUsed = tool.lastUsed;
  }
  const rows = [...groups.values()];
  for (const row of rows) row.successRate = row.successes + row.failures ? row.successes / (row.successes + row.failures) * 100 : null;
  return { rows, calls: rows.reduce((n, row) => n + row.calls, 0), omitted: tools.mcpOmitted || 0, available: false };
}

export function toolOutcomeSummary(tools) {
  return [false, true].map(mcp => {
    const rows = (tools?.rows || []).filter(row => Boolean(row.server) === mcp);
    const sum = key => rows.reduce((total, row) => total + (Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : 0), 0);
    const successes = sum('successes'), failures = sum('failures');
    return { name: mcp ? 'MCP tools' : 'Other tools', calls: sum('calls'), successes, failures, unknown: sum('unknown'),
      successRate: successes + failures ? successes / (successes + failures) * 100 : null };
  });
}

export function mergeMcpInventory(history, inventory) {
  const rows = new Map(history.rows.map(row => [row.name, { ...row, status: inventory.available ? 'not-in-session' : 'unavailable' }]));
  for (const server of inventory.rows || []) rows.set(server.name, { ...(rows.get(server.name) || emptyServer(server.name)), ...server });
  return { ...history, available: inventory.available, sessionId: inventory.sessionId, checkedAt: inventory.checkedAt,
    rows: [...rows.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)) };
}
