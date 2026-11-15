import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createUsageRecorder, reconcileUsageJournal, usageHome } from '../src/node/review-usage.mjs';
const first = '12345678-1234-4234-8234-123456789abc';
const second = '87654321-4321-4321-8321-cba987654321';
const timestamp = '2026-11-14T12:00:00.000Z';
async function fixture(run) {
    const root = await mkdtemp(join(tmpdir(), 'enhance-usage-'));
    try {
        await run(root);
    } finally{
        await rm(root, {
            recursive: true,
            force: true
        });
    }
}
async function entries(root, id = first) {
    const base = join(root, 'session-state', id);
    const lines = (await readFile(join(base, 'events.jsonl'), 'utf8')).trim().split('\n').map((line)=>JSON.parse(line));
    const workspace = JSON.parse(await readFile(join(base, 'workspace.yaml'), 'utf8'));
    return {
        lines,
        workspace
    };
}
function event(id = 'event-1', data = {}) {
    return {
        type: 'assistant.usage',
        id,
        timestamp,
        data: {
            model: 'gpt-5.1',
            inputTokens: 0,
            outputTokens: 4,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheDetailsReported: false,
            copilotUsage: {
                totalNanoAiu: 0,
                secret: 'billing-secret'
            },
            accounting: {
                sourceSessionId: first,
                usageId: 'usage-1',
                sequence: 1,
                extra: 'secret'
            },
            provider: {
                kind: 'copilot',
                id: 'personal-user',
                label: 'secret'
            },
            apiEndpoint: 'https://secret.example',
            apiCallId: 'secret',
            prompt: 'secret',
            response: 'secret',
            ...data
        }
    };
}
test('writes an isolated project and allowlisted accounting receipt without payloads', async ()=>fixture(async (root)=>{
        const recorder = await createUsageRecorder(first, root);
        let { lines, workspace } = await entries(root);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].type, 'session.start');
        assert.equal(lines[0].data.sessionId, first);
        assert.equal(lines[0].data.context.repository, 'Usage Insights AI Review');
        assert.equal(workspace.id, first);
        assert.match(workspace.name, /^Usage Insights AI Review · /);
        recorder.record(event());
        recorder.record({
            type: 'assistant.message',
            data: {
                content: 'secret'
            }
        });
        await recorder.flush();
        ({ lines, workspace } = await entries(root));
        assert.equal(lines.length, 2);
        assert.deepEqual(lines[1], {
            type: 'session.usage_record',
            id: 'event-1',
            timestamp,
            data: {
                usage: {
                    model: 'gpt-5.1',
                    inputTokens: 0,
                    outputTokens: 4,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    cacheDetailsReported: false,
                    provider: {
                        kind: 'copilot'
                    },
                    copilotUsage: {
                        totalNanoAiu: 0
                    },
                    accounting: {
                        sourceSessionId: first,
                        usageId: 'usage-1',
                        sequence: 1
                    }
                }
            }
        });
        const serialized = JSON.stringify(lines);
        for (const secret of [
            'billing-secret',
            'personal-user',
            'secret.example',
            'prompt',
            'response',
            'apiCallId'
        ])assert.equal(serialized.includes(secret), false);
    }));
test('deduplicates accounting identity, preserves zero and status, and serializes rapid events', async ()=>fixture(async (root)=>{
        const recorder = await createUsageRecorder(first, root);
        recorder.record(event());
        recorder.record(event('replayed-event'));
        recorder.record(event('event-2', {
            accounting: {
                sourceSessionId: first,
                usageId: 'usage-2',
                sequence: 2
            },
            copilotUsage: undefined,
            aiCreditsStatus: 'unavailable',
            inputTokens: undefined,
            isByok: true,
            byokKind: 'remote_user'
        }));
        recorder.record(event('event-3', {
            accounting: {
                sourceSessionId: first,
                usageId: 'usage-3',
                sequence: 3
            },
            copilotUsage: {
                totalNanoAiu: 2
            },
            aiCreditsStatus: 'partial',
            isByok: false
        }));
        await recorder.flush();
        const { lines } = await entries(root);
        assert.equal(lines.length, 4);
        assert.equal(lines[1].data.usage.copilotUsage.totalNanoAiu, 0);
        assert.equal(lines[1].data.usage.aiCreditsStatus, undefined);
        assert.equal(lines[2].data.usage.inputTokens, undefined);
        assert.equal(lines[2].data.usage.copilotUsage, undefined);
        assert.equal(lines[2].data.usage.aiCreditsStatus, 'unavailable');
        assert.equal(lines[2].data.usage.isByok, true);
        assert.equal(lines[2].data.usage.byokKind, 'remote_user');
        assert.equal(lines[3].data.usage.aiCreditsStatus, 'partial');
    }));
test('drops malformed metrics and unsafe identifiers without inventing values', async ()=>fixture(async (root)=>{
        const recorder = await createUsageRecorder(first, root);
        recorder.record(event('event-unsafe', {
            model: 'https://secret.example/?token=abc',
            inputTokens: -1,
            outputTokens: 1.5,
            cacheReadTokens: NaN,
            cacheWriteTokens: '7',
            duration: Infinity,
            copilotUsage: {
                totalNanoAiu: -1
            },
            aiCreditsStatus: 'wrong',
            accounting: {
                sourceSessionId: second,
                usageId: 'bad\nsecret',
                sequence: -1
            },
            provider: {
                kind: 'unsafe\nsecret'
            },
            byokKind: 'private-provider-name'
        }));
        recorder.record(event('event-unsafe', {
            accounting: undefined
        }));
        await recorder.flush();
        const { lines } = await entries(root);
        assert.equal(lines.length, 2);
        assert.deepEqual(lines[1].data.usage, {
            cacheDetailsReported: false,
            byokKind: 'other',
            provider: {
                kind: 'external'
            }
        });
        recorder.record(event('bad\nsecret'));
        recorder.record(event('https://secret.example'));
        await assert.rejects(recorder.flush(), {
            message: 'Unable to save usage accounting.'
        });
        assert.equal((await entries(root)).lines.length, 2);
    }));
test('separates sessions and refuses invalid or existing IDs', async ()=>fixture(async (root)=>{
        await assert.rejects(createUsageRecorder('../escape', root));
        const a = await createUsageRecorder(first, root);
        const b = await createUsageRecorder(second, root);
        a.record(event());
        b.record(event('event-b', {
            accounting: {
                sourceSessionId: second,
                usageId: 'usage-b',
                sequence: 1
            }
        }));
        await Promise.all([
            a.flush(),
            b.flush()
        ]);
        assert.equal((await entries(root, first)).lines.length, 2);
        assert.equal((await entries(root, second)).lines.length, 2);
        await assert.rejects(createUsageRecorder(first, root), {
            code: 'EEXIST'
        });
    }));
test('surfaces directory and asynchronous write failures without payloads', async ()=>fixture(async (root)=>{
        const blocked = join(root, 'blocked');
        await writeFile(blocked, '');
        await assert.rejects(createUsageRecorder(first, blocked));
        const recorder = await createUsageRecorder(first, root);
        await rm(join(root, 'session-state', first), {
            recursive: true
        });
        recorder.record(event());
        await assert.rejects(recorder.flush(), (error)=>{
            assert.equal(error.message, 'Unable to save usage accounting.');
            return true;
        });
    }));
test('usage home follows the configured data directory', ()=>{
    const before = process.env.USAGE_INSIGHTS_DATA_DIR;
    process.env.USAGE_INSIGHTS_DATA_DIR = 'custom-data';
    try {
        assert.equal(usageHome(), resolve('custom-data', 'usage'));
    } finally{
        if (before === undefined) delete process.env.USAGE_INSIGHTS_DATA_DIR;
        else process.env.USAGE_INSIGHTS_DATA_DIR = before;
    }
});
test('reconciles durable-only receipts and deduplicates live delivery without retaining journal text', async ()=>fixture(async (root)=>{
        const recorder = await createUsageRecorder(first, root);
        recorder.record(event());
        const durableOnly = event('durable-2', {
            accounting: {
                sourceSessionId: first,
                usageId: 'usage-2',
                sequence: 2
            },
            copilotUsage: {
                totalNanoAiu: 42
            },
            prompt: 'private prompt',
            response: 'private response'
        });
        const journal = join(root, 'runtime.jsonl');
        await writeFile(journal, [
            JSON.stringify({
                type: 'session.start',
                data: {
                    context: {
                        cwd: 'private project'
                    }
                }
            }),
            JSON.stringify({
                ...event('journal-1'),
                type: 'session.usage_record',
                data: {
                    usage: event().data
                }
            }),
            JSON.stringify({
                ...durableOnly,
                type: 'session.usage_record',
                data: {
                    usage: durableOnly.data
                }
            }),
            JSON.stringify({
                type: 'session.usage_checkpoint',
                data: {
                    prompt: 'private aggregate'
                }
            })
        ].join('\n'));
        await reconcileUsageJournal(journal, recorder);
        const { lines } = await entries(root);
        assert.equal(lines.length, 3);
        assert.equal(lines[2].id, 'durable-2');
        assert.equal(lines[2].data.usage.copilotUsage.totalNanoAiu, 42);
        assert.equal(JSON.stringify(lines).includes('private'), false);
    }));
test('missing journal is acceptable; unreadable or malformed usage journals fail generically', async ()=>fixture(async (root)=>{
        const recorder = await createUsageRecorder(first, root);
        await reconcileUsageJournal(join(root, 'missing.jsonl'), recorder);
        const directory = join(root, 'directory.jsonl');
        await mkdir(directory);
        await assert.rejects(reconcileUsageJournal(directory, recorder), {
            message: 'Unable to read usage accounting journal.'
        });
        const journal = join(root, 'invalid.jsonl');
        await writeFile(journal, JSON.stringify({
            type: 'session.usage_record',
            id: 'receipt',
            timestamp,
            data: {
                usage: null,
                prompt: 'private'
            }
        }));
        await assert.rejects(reconcileUsageJournal(journal, recorder), (error)=>{
            assert.equal(error.message, 'Unable to save usage accounting.');
            assert.equal(error.message.includes('private'), false);
            return true;
        });
    }));
test('invalid live usage envelope fails flush and accepted timestamps are normalized', async ()=>fixture(async (root)=>{
        const recorder = await createUsageRecorder(first, root);
        recorder.record({
            ...event('valid-time'),
            timestamp: '2026-11-14T07:00:00-05:00'
        });
        await recorder.flush();
        assert.equal((await entries(root)).lines[1].timestamp, timestamp);
        recorder.record({
            type: 'assistant.usage',
            id: 'bad-time',
            timestamp: 'private',
            data: event().data
        });
        await assert.rejects(recorder.flush(), {
            message: 'Unable to save usage accounting.'
        });
    }));
