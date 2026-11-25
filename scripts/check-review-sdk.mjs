// Exercise the production helper with the installed desktop SDK and a loopback model fixture.
// The dependency seam supplies synthetic account/catalog data; it never uses paid inference.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { access, writeFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createReviewService } from '../src/node/ai-review.mjs'
import { createUsageRecorder } from '../src/node/review-usage.mjs'
import { normalizeUsage } from '../src/core/copilot.mjs'

assert.ok(process.env.COPILOT_SDK_DIR && process.env.COPILOT_CLI_PATH, 'Set installed desktop SDK/runtime paths.')
const sdk = await import(pathToFileURL(join(process.env.COPILOT_SDK_DIR, 'index.js')).href)
const requests = []
const opaqueCallId = Buffer.from('synthetic opaque provider call identity;'.repeat(17)).toString('base64')
let heldClosed = false
const fixture = createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  requests.push(JSON.parse(text))
  if (text.includes('CANCEL_SENTINEL')) { response.once('close', () => { heldClosed = true }); return }
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ id: opaqueCallId, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture rewritten request' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
// Desktop 1.0.115 moved process options onto the connection and replaced the single session provider
// with named ones, whose models are selected as provider/id while the wire name stays the bare id.
const modern = typeof sdk.RuntimeConnection.forSpawnedStdio === 'function'
const model = modern ? 'fixture/gpt-4.1' : 'gpt-4.1'
const auth = { isAuthenticated: true, login: 'fixture', host: 'https://github.com' }
const catalog = { list: [{ id: model, name: 'Fixture model', provider: { kind: 'copilot' }, policy: { state: 'enabled' }, capabilities: { supports: { vision: true } } }] }
const parent = { rpc: { model: { list: async () => catalog }, gitHubAuth: { getStatus: async () => auth } } }
const homes = []
const clients = []
let suppressedUsage = 0
const withoutTokens = env => Object.fromEntries(Object.entries(env).filter(([key]) => !/^(GH|GITHUB)_TOKEN$/i.test(key)))
const loopback = () => ({ type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' })
const bridge = {
  RuntimeConnection: sdk.RuntimeConnection,
  CopilotClient: class {
    constructor(options) {
      homes.push(modern ? options.runtime.baseDirectory : options.baseDirectory)
      this.client = new sdk.CopilotClient(modern
        ? { ...options, runtime: { ...options.runtime, env: withoutTokens(options.runtime.env) }, github: { ...options.github, useLoggedInUser: false } }
        : { ...options, env: withoutTokens(options.env), useLoggedInUser: false })
      clients.push(this.client)
    }
    start() { return this.client.start() }
    forceStop() { return this.client.forceStop() }
    async createSession(config) {
      // Deliberately plant unselected files in the empty helper workspace before session creation.
      await writeFile(join(config.workingDirectory, 'AGENTS.md'), 'PRIVATE_INSTRUCTIONS_SENTINEL')
      await writeFile(join(config.workingDirectory, 'PRIVATE_FILENAME_SENTINEL.txt'), 'PRIVATE_CONTENT_SENTINEL')
      const dropLiveUsage = homes.length === 1
      const session = await this.client.createSession({ ...config,
        onEvent(event) {
          if (dropLiveUsage && event.type === 'assistant.usage') suppressedUsage++
          else config.onEvent(event)
        },
        ...(modern
          ? { inference: { providers: [{ name: 'fixture', ...loopback() }], models: [{ id: 'gpt-4.1', provider: 'fixture' }] }, github: { capi: { enabled: false } } }
          : { provider: loopback() }) })
      session.rpc.model.list = async () => catalog
      session.rpc.gitHubAuth.getStatus = async () => auth
      return session
    }
  }
}
const retained = await mkdtemp(join(tmpdir(), 'review-usage-fixture-'))
const service = createReviewService(parent, { runtime: async () => ({ sdk: bridge, path: process.env.COPILOT_CLI_PATH }), recorder: id => createUsageRecorder(id, retained) })
const watchdog = setTimeout(() => { service.close(); for (const client of clients) void client.forceStop(); process.exitCode = 1 }, 55_000)
try {
  const result = await service.review({ model, prompt: 'Review these synthetic counts: 100 input tokens, 10 output.' })
  assert.equal(result.text, 'Fixture rewritten request')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'gpt-4.1')
  assert.equal(requests[0].tools?.length ?? 0, 0)
  assert.ok(!JSON.stringify(requests[0]).includes('PRIVATE_'))
  await service.review({ model, prompt: 'Review these synthetic counts again with live usage enabled.' })
  assert.equal(requests.length, 2)
  const pending = service.review({ model, prompt: 'CANCEL_SENTINEL' })
  const rejection = assert.rejects(pending)
  for (let i = 0; i < 150 && requests.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(requests.length, 3)
  service.cancel()
  await rejection
  for (let i = 0; i < 30 && !heldClosed; i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(heldClosed, 'cancel closes the fixture request')
  for (const directory of homes) await assert.rejects(access(directory))
  const sessions = await readdir(join(retained, 'session-state'))
  assert.equal(sessions.length, 3)
  const journals = await Promise.all(sessions.map(id => readFile(join(retained, 'session-state', id, 'events.jsonl'), 'utf8')))
  const events = journals.flatMap(text => text.trim().split('\n').map(line => JSON.parse(line)))
  const receipts = events.filter(event => event.type === 'session.usage_record')
  assert.equal(receipts.length, 2, 'live and durable deliveries count once per call and survive helper cleanup')
  assert.ok(suppressedUsage > 0, 'a missing live event is recovered from the real runtime journal')
  assert.ok(receipts.every(event => event.data.usage.inputTokens === 1 && event.data.usage.outputTokens === 1))
  // Runtime 1.0.115 leaves the BYOK flags out of its journal, so only the live receipt keeps them there;
  // the recovered one is unclassified instead of excluded.
  assert.equal(receipts.filter(event => event.data.usage.isByok === true).length, modern ? 1 : 2, 'receipts keep the BYOK flag wherever the runtime reports it')
  assert.ok(receipts.every(event => !normalizeUsage(event.data.usage, { key: event.id, timestamp: event.timestamp, sessionId: event.data.usage.accounting.sourceSessionId }).record), 'local fixture is never counted as Copilot usage')
  assert.ok(receipts.every(event => sessions.includes(event.data.usage.accounting.sourceSessionId)))
  assert.ok(receipts.every(event => /^sha256:[a-f0-9]{64}$/.test(event.data.usage.accounting.usageId)))
  assert.ok(!journals.join('\n').includes(opaqueCallId))
  assert.doesNotMatch(journals.join('\n'), /PRIVATE_|synthetic counts|100 input tokens|Fixture rewritten|CANCEL_SENTINEL|127\.0\.0\.1|apiKey|data:image/)
  console.log('Usage Insights Copilot helper: output, model selection, isolation, cancellation, retained usage and cleanup passed. No paid inference.')
} finally {
  clearTimeout(watchdog)
  await service.close()
  for (const client of clients) await client.forceStop()
  fixture.closeAllConnections()
  await new Promise(resolve => fixture.close(resolve))
  assert.equal(dirname(resolve(retained)), resolve(tmpdir()))
  await rm(retained, { recursive: true, force: true })
}
