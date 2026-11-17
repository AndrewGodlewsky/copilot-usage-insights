import { readUsageDatabase, readDesktopSessionNames } from './copilot-db.mjs';

const send = value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()));
try {
  let input = '', bytes = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk; bytes += Buffer.byteLength(chunk);
    if (bytes > 32 * 1024 * 1024) throw new Error('Input limit');
  }
  const { file, receiptSessions, source, waitForLock, operation } = JSON.parse(input);
  const result = operation === 'names'
    ? { sessionNames: [...readDesktopSessionNames(file, new Set(receiptSessions))] }
    : readUsageDatabase(file, new Set(receiptSessions), source, { waitForLock });
  await send({ summary: { unclassified: result.unclassified, invalid: result.invalid, warning: result.warning } });
  for (const field of ['records', 'coverageEntries', 'skillExcludedSessions', 'sessionNames']) {
    const items = result[field] || [];
    for (let index = 0; index < items.length; index += 1000) await send({ field, items: items.slice(index, index + 1000) });
  }
  await send({ done: true });
  // Embedded runtimes may own handles beyond this script's stdin/stdout.
  process.exit(0);
} catch (error) {
  try { await send({ error: { code: error?.code, errcode: error?.errcode } }); } catch {}
  process.exit(1);
}
