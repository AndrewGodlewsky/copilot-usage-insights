// Adapted from Enhance Prompt. MIT notice: ../../licenses/enhance-prompt-LICENSE
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { reviewUsageHome } from './settings.mjs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = /^[a-z0-9][a-z0-9._:+\/-]*$/i;
const numericFields = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'toolTokenCount',
    'availableToolCount',
    'totalTokens',
    'duration'
];
function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function safeId(value, max = 256) {
    return typeof value === 'string' && value.length <= max && !value.includes('://') && identifier.test(value) ? value : undefined;
}
function count(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function metric(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function project(event, sessionId) {
    const e = object(event);
    if (e?.type !== 'assistant.usage' && e?.type !== 'session.usage_record') return;
    const data = e.type === 'session.usage_record' ? object(object(e.data)?.usage) : object(e.data);
    if (!data) throw new Error('Invalid usage accounting record.');
    const id = safeId(e.id);
    const timestamp = e.timestamp;
    const ms = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
    if (!id || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) throw new Error('Invalid usage accounting record.');
    const usage = {};
    const model = safeId(data.model, 128);
    if (model) usage.model = model;
    for (const field of numericFields){
        const value = field === 'duration' ? metric(data[field]) : count(data[field]);
        if (value !== undefined) usage[field] = value;
    }
    if (typeof data.cacheDetailsReported === 'boolean') usage.cacheDetailsReported = data.cacheDetailsReported;
    if (typeof data.isAuto === 'boolean') usage.isAuto = data.isAuto;
    if (typeof data.isByok === 'boolean') usage.isByok = data.isByok;
    if (typeof data.byokKind === 'string' && data.byokKind.length) {
        usage.byokKind = [
            'local_managed',
            'local_user',
            'remote_user'
        ].includes(data.byokKind) ? data.byokKind : 'other';
    }
    const provider = object(data.provider);
    if (provider && (provider.kind !== undefined || provider.id !== undefined)) {
        usage.provider = {
            kind: provider.kind === 'copilot' ? 'copilot' : 'external'
        };
    }
    const copilotUsage = object(data.copilotUsage);
    const totalNanoAiu = count(copilotUsage?.totalNanoAiu);
    if (totalNanoAiu !== undefined) usage.copilotUsage = {
        totalNanoAiu
    };
    if ([
        'complete',
        'partial',
        'unavailable'
    ].includes(data.aiCreditsStatus)) usage.aiCreditsStatus = data.aiCreditsStatus;
    const accounting = object(data.accounting);
    if (accounting?.sourceSessionId === sessionId) {
        const usageId = safeId(accounting.usageId);
        const sequence = count(accounting.sequence);
        if (usageId && sequence !== undefined) usage.accounting = {
            sourceSessionId: sessionId,
            usageId,
            sequence
        };
    }
    return {
        type: 'session.usage_record',
        id,
        timestamp: new Date(ms).toISOString(),
        data: {
            usage
        }
    };
}
export async function reconcileUsageJournal(path, recorder) {
    const maxBytes = 64 * 1024 * 1024;
    const decoder = new StringDecoder('utf8');
    let bytes = 0;
    let remainder = '';
    const consume = (line)=>{
        if (!line.trim()) return;
        let event;
        try {
            event = JSON.parse(line);
        } catch  {
            throw new Error('Unable to read usage accounting journal.');
        }
        if (object(event)?.type === 'session.usage_record') recorder.record(event);
    };
    try {
        for await (const chunk of createReadStream(path, {
            highWaterMark: 64 * 1024
        })){
            bytes += chunk.length;
            if (bytes > maxBytes) throw new Error('Unable to read usage accounting journal.');
            remainder += decoder.write(chunk);
            let newline;
            while((newline = remainder.indexOf('\n')) !== -1){
                consume(remainder.slice(0, newline));
                remainder = remainder.slice(newline + 1);
            }
        }
        consume(remainder + decoder.end());
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw new Error('Unable to read usage accounting journal.');
    }
    await recorder.flush();
}
async function replace(file, content) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, {
        encoding: 'utf8',
        mode: 0o600
    });
    await rename(temporary, file);
}
export const usageHome = reviewUsageHome;
export async function createUsageRecorder(sessionId, root = usageHome()) {
    if (!uuid.test(sessionId)) throw new Error('Invalid usage session ID.');
    const directory = join(root, 'session-state', sessionId);
    const file = join(directory, 'events.jsonl');
    const started = new Date().toISOString();
    await mkdir(join(root, 'session-state'), {
        recursive: true,
        mode: 0o700
    });
    await mkdir(directory, {
        mode: 0o700
    });
    await replace(join(directory, 'workspace.yaml'), JSON.stringify({
        id: sessionId,
        name: `Usage Insights AI Review · ${started}`
    }) + '\n');
    let lines = JSON.stringify({
        type: 'session.start',
        id: randomUUID(),
        timestamp: started,
        data: {
            sessionId,
            context: {
                repository: 'Usage Insights AI Review'
            }
        }
    }) + '\n';
    await replace(file, lines);
    const seen = new Set();
    let pending = Promise.resolve();
    let failure = false;
    return {
        record (event) {
            if (failure) return;
            let receipt;
            try {
                receipt = project(event, sessionId);
            } catch  {
                failure = true;
                return;
            }
            if (!receipt) return;
            const usage = object(object(receipt.data)?.usage);
            const accounting = object(usage?.accounting);
            const key = accounting ? `${sessionId}:${accounting.usageId}` : `event:${receipt.id}`;
            if (seen.has(key)) return;
            seen.add(key);
            pending = pending.then(async ()=>{
                const next = lines + JSON.stringify(receipt) + '\n';
                await replace(file, next);
                lines = next;
            }).catch(()=>{
                failure = true;
            });
        },
        async flush () {
            await pending;
            if (failure) throw new Error('Unable to save usage accounting.');
        }
    };
}
