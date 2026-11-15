// Adapted from Enhance Prompt. MIT notice: ../../licenses/enhance-prompt-LICENSE
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { reviewUsageHome } from './settings.mjs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { normalizeUsage } from '../core/copilot.mjs';
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
function accountingId(value) {
    if (typeof value !== 'string' || !value.length || value.length > 8192) return;
    // Copilot also uses long, opaque call IDs. Keep their identity without storing their contents.
    return safeId(value) ?? `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
        const usageId = accountingId(accounting.usageId);
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
        if (['session.usage_record', 'assistant.message'].includes(object(event)?.type)) recorder.record(event);
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
            usageInsightsReview: 1,
            context: {
                repository: 'Usage Insights'
            }
        }
    }) + '\n';
    await replace(file, lines);
    const seen = new Set();
    const receipts = [];
    const expectedCalls = new Set(), recordedCalls = new Set(), completedCalls = new Set();
    const callKey = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 ? createHash('sha256').update(value).digest('hex') : undefined;
    let submittedPasses = 0, identifiedPasses = 0;
    let pending = Promise.resolve();
    let failure = false;
    return {
        beginPass() { submittedPasses++; },
        endPass(apiCallId) { const key = callKey(apiCallId); if (key && !completedCalls.has(key)) { identifiedPasses++; completedCalls.add(key); expectedCalls.add(key); } },
        summary() {
            const covered = submittedPasses === identifiedPasses && [...expectedCalls].every(key => recordedCalls.has(key));
            let nano = 0n, creditsKnown = 0, completeCredits = 0, tokens = 0, tokensKnown = 0, completeTokens = 0;
            for (const receipt of receipts) {
                const r = normalizeUsage(receipt.data.usage, { key: receipt.id, timestamp: receipt.timestamp, sessionId }).record;
                if (!r) continue;
                if (r.nanoAiu !== null) { nano += BigInt(r.nanoAiu); creditsKnown++; if (r.creditStatus === 'complete') completeCredits++; }
                if (r.inputTotal !== null || r.output !== null) { tokens += (r.inputTotal ?? 0) + (r.output ?? 0); tokensKnown++; }
                if (r.inputTotal !== null && r.output !== null) completeTokens++;
            }
            return { requests: receipts.length, credits: creditsKnown ? Number(nano) / 1e9 : null,
                creditStatus: !creditsKnown ? 'unavailable' : covered && completeCredits === receipts.length ? 'complete' : 'partial',
                tokens: tokensKnown ? tokens : null, tokenStatus: !tokensKnown ? 'unavailable' : covered && completeTokens === receipts.length ? 'complete' : 'partial' };
        },
        record (event) {
            if (failure) return;
            if (event?.type === 'assistant.message') {
                const key = callKey(event.data?.apiCallId); if (key) expectedCalls.add(key);
            }
            let receipt;
            try {
                receipt = project(event, sessionId);
            } catch  {
                failure = true;
                return;
            }
            if (!receipt) return;
            // Identity is only needed in memory to detect absent receipts, never in the saved journal.
            const call = callKey(event.type === 'session.usage_record' ? event.data?.usage?.apiCallId : event.data?.apiCallId);
            if (call) recordedCalls.add(call);
            const usage = object(object(receipt.data)?.usage);
            const accounting = object(usage?.accounting);
            const key = accounting ? `${sessionId}:${accounting.usageId}` : `event:${receipt.id}`;
            if (seen.has(key)) return;
            seen.add(key);
            receipts.push(receipt);
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
