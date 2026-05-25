import type { Calculation, TableauWorkbook } from '../parsers/model.js';
import { contentHash, readCache, writeCache } from './cache.js';
import { type AnthropicClient, callClaude } from './client.js';
import type { EnrichResult } from './executive-summary.js';

const PROMPT = `Simplify this Tableau calculated field formula into plain English (20 words or fewer).

Field name: {{name}}
Formula: {{formula}}

State the actual operation being performed (e.g. "Days between Order Date and Ship Date" or "Sum of revenue divided by quota"). Do not mention Tableau or function names.

Respond with valid JSON only: {"result": "your plain-English description"}`;

export async function enrichCalcSimplifications(
  workbook: TableauWorkbook,
  client: AnthropicClient,
  model: string,
  cacheDir: string,
  onProgress?: (done: number, total: number, fromCache: number) => void
): Promise<EnrichResult<Calculation[]>> {
  const total = workbook.calculations.length;
  let fromCache = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const enriched: Calculation[] = [];

  for (let i = 0; i < workbook.calculations.length; i++) {
    const calc = workbook.calculations[i];

    const prompt = PROMPT.replace('{{name}}', calc.name).replace('{{formula}}', calc.formula);

    const hash = contentHash(prompt, model);
    const cached = readCache(cacheDir, hash);

    if (cached !== null) {
      fromCache++;
      onProgress?.(i + 1, total, fromCache);
      enriched.push({ ...calc, simplifiedFormula: cached });
      continue;
    }

    const res = await callClaude(client, model, prompt);
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    if (res.result) writeCache(cacheDir, hash, res.result, model);
    onProgress?.(i + 1, total, fromCache);
    enriched.push({ ...calc, simplifiedFormula: res.result ?? calc.simplifiedFormula });
  }

  return { value: enriched, inputTokens, outputTokens };
}
