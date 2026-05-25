import type { TableauWorkbook } from '../parsers/model.js';
import { contentHash, readCache, writeCache } from './cache.js';
import { type AnthropicClient, type ClaudeResult, callClaude } from './client.js';

export interface EnrichResult<T> {
  value: T;
  inputTokens: number;
  outputTokens: number;
}

const PROMPT = `You are analyzing a Tableau workbook.

Workbook name: {{name}}
Data sources: {{datasources}}
Worksheets: {{worksheets}}
Sample calculated fields:
{{calculations}}

Write a 2-3 sentence plain-language description of what this workbook shows and who would use it. Be specific about the business domain, key metrics, and intended audience. Do not mention Tableau or any technical implementation details.

Respond with valid JSON only: {"result": "your description here"}`;

export async function enrichExecutiveSummary(
  workbook: TableauWorkbook,
  client: AnthropicClient,
  model: string,
  cacheDir: string
): Promise<EnrichResult<string | null>> {
  const calcSample = workbook.calculations
    .slice(0, 5)
    .map((c) => `- ${c.name}: ${c.formula}`)
    .join('\n');

  const prompt = PROMPT.replace('{{name}}', workbook.metadata.name)
    .replace('{{datasources}}', workbook.dataSources.map((d) => d.caption ?? d.name).join(', '))
    .replace('{{worksheets}}', workbook.worksheets.map((w) => w.title ?? w.name).join(', '))
    .replace('{{calculations}}', calcSample || '(none)');

  const hash = contentHash(prompt, model);
  const cached = readCache(cacheDir, hash);
  if (cached !== null) return { value: cached, inputTokens: 0, outputTokens: 0 };

  const { result, inputTokens, outputTokens } = await callClaude(client, model, prompt);
  if (result) writeCache(cacheDir, hash, result, model);
  return { value: result, inputTokens, outputTokens };
}
