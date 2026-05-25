import type { TableauWorkbook, Worksheet } from '../parsers/model.js';
import { contentHash, readCache, writeCache } from './cache.js';
import { type AnthropicClient, callClaude } from './client.js';
import type { EnrichResult } from './executive-summary.js';

const PROMPT = `You are analyzing a single worksheet inside a Tableau workbook named "{{workbook}}".

Worksheet name: {{name}}
Mark type: {{mark_type}}
Row fields: {{rows}}
Column fields: {{columns}}

Write 1-2 sentences describing what this worksheet shows and what its key metric is. Be specific and practical — name the actual metric being tracked, not just "it shows data." Do not mention Tableau.

Respond with valid JSON only: {"result": "your description here"}`;

export async function enrichWorksheetDescriptions(
  workbook: TableauWorkbook,
  client: AnthropicClient,
  model: string,
  cacheDir: string,
  onProgress?: (done: number, total: number, fromCache: number) => void
): Promise<EnrichResult<Worksheet[]>> {
  const total = workbook.worksheets.length;
  let fromCache = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const enriched = await Promise.all(
    workbook.worksheets.map(async (ws, i) => {
      const encoding = workbook.visualEncodings.find((e) => e.worksheet === ws.name);
      const rows = encoding?.rows.map((r) => r.field).join(', ') || '(none)';
      const cols = encoding?.columns.map((r) => r.field).join(', ') || '(none)';

      const prompt = PROMPT.replace('{{workbook}}', workbook.metadata.name)
        .replace('{{name}}', ws.title ?? ws.name)
        .replace('{{mark_type}}', ws.markTypes.join(', ') || 'automatic')
        .replace('{{rows}}', rows)
        .replace('{{columns}}', cols);

      const hash = contentHash(prompt, model);
      const cached = readCache(cacheDir, hash);

      if (cached !== null) {
        fromCache++;
        onProgress?.(i + 1, total, fromCache);
        return { ...ws, description: cached };
      }

      const res = await callClaude(client, model, prompt);
      inputTokens += res.inputTokens;
      outputTokens += res.outputTokens;
      if (res.result) writeCache(cacheDir, hash, res.result, model);
      onProgress?.(i + 1, total, fromCache);
      return { ...ws, description: res.result ?? ws.description };
    })
  );

  return { value: enriched, inputTokens, outputTokens };
}
