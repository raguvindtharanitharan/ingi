import type { TableauWorkbook } from '../parsers/model.js';
import { contentHash, readCache, writeCache } from './cache.js';
import { type AnthropicClient, callClaudeRaw } from './client.js';
import type { EnrichResult } from './executive-summary.js';

const PROMPT = `You are improving a Visual Blueprint document generated from a Tableau workbook.

The blueprint describes dashboard layout, worksheet query specifications, interactive filter wiring, and field definitions.

**Your task — make these specific improvements:**

1. **Fix field display names throughout the document:**
   - Remove leading dots: \`.Days Past Due\` → \`Days Past Due\`, \`.Amount Paid (Invoiced Currency)\` → \`Amount Paid (Invoiced Currency)\`
   - Remove triple-underscore prefixes from any remaining \`___\` field names

2. **Resolve internal calc IDs in SQL queries:**
   - Replace \`"Calculation_XXXXXXXXXX"\` references with the human-readable name from the Field Dictionary
   - Example: \`"Calculation_2590325163103647"\` → \`"Net Amount Outstanding"\`

3. **Add a one-line business context comment above each SQL block:**
   - Format: \`-- Business question: <what a finance analyst would ask to produce this view>\`
   - Be specific: e.g. "What is each customer's total outstanding AR by aging bucket?"

4. **Do not change anything else.** Keep all section headings, table structures, layout diagrams, and filter wiring exactly as-is. Only fix the three items above.

Return the complete improved blueprint as markdown. No preamble, no explanation — just the markdown.

---

{{blueprint}}`;

export async function enrichVisualBlueprint(
  blueprint: string,
  workbook: TableauWorkbook,
  client: AnthropicClient,
  model: string,
  cacheDir: string,
): Promise<EnrichResult<string>> {
  const prompt = PROMPT.replace('{{blueprint}}', blueprint);
  const hash = contentHash(prompt, model);

  const cached = readCache(cacheDir, hash);
  if (cached !== null) {
    return { value: cached, inputTokens: 0, outputTokens: 0 };
  }

  const { text, inputTokens, outputTokens } = await callClaudeRaw(client, model, prompt, 6000);

  const result = text ?? blueprint; // fall back to original if Claude fails
  if (text) writeCache(cacheDir, hash, result, model);

  return { value: result, inputTokens, outputTokens };
}
