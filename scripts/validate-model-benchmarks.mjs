import { readFileSync } from 'node:fs';
import { validateBenchmarkDataset } from '../src/core/benchmark-schema.mjs';
const data = validateBenchmarkDataset(JSON.parse(readFileSync(new URL('../data/model-benchmarks.json', import.meta.url), 'utf8')));
console.log(`Validated benchmark dataset ${data.revision}: ${data.models.length} identities, ${data.results.length} sourced results; reviewed ${data.reviewedAt}. No network used.`);
