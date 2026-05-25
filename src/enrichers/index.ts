import type { TableauWorkbook } from '../parsers/model.js';
import { createAnthropicClient } from './client.js';
import { enrichExecutiveSummary } from './executive-summary.js';
import { enrichWorksheetDescriptions } from './worksheet-descriptions.js';
import { enrichCalcSimplifications } from './calc-captions.js';

export interface EnrichOptions {
  apiKey: string;
  model?: string;
  cacheDir?: string;
  onProgress?: (step: EnrichStep) => void;
}

export interface EnrichStep {
  phase: 'executive_summary' | 'worksheet_descriptions' | 'calc_simplifications';
  done: number;
  total: number;
  fromCache: number;
}

export interface EnrichUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_CACHE_DIR = '.drexo-cache/enrichment';

// Haiku 4.5 pricing: $0.80/M input, $4.00/M output
const PRICE_PER_M_INPUT = 0.80;
const PRICE_PER_M_OUTPUT = 4.00;

export interface EnrichWorkbookResult {
  workbook: TableauWorkbook;
  usage: EnrichUsage;
}

export async function enrichWorkbook(
  workbook: TableauWorkbook,
  opts: EnrichOptions
): Promise<EnrichWorkbookResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;

  const client = await createAnthropicClient(opts.apiKey);
  let totalInput = 0;
  let totalOutput = 0;

  // 1 — Executive summary
  opts.onProgress?.({ phase: 'executive_summary', done: 0, total: 1, fromCache: 0 });
  const execResult = await enrichExecutiveSummary(workbook, client, model, cacheDir);
  totalInput += execResult.inputTokens;
  totalOutput += execResult.outputTokens;
  opts.onProgress?.({ phase: 'executive_summary', done: 1, total: 1, fromCache: 0 });

  // 2 — Worksheet descriptions
  const wsResult = await enrichWorksheetDescriptions(
    workbook,
    client,
    model,
    cacheDir,
    (done, total, fromCache) => {
      opts.onProgress?.({ phase: 'worksheet_descriptions', done, total, fromCache });
    }
  );
  totalInput += wsResult.inputTokens;
  totalOutput += wsResult.outputTokens;

  // 3 — Calc simplifications (sequential — avoids rate-limit spikes on large workbooks)
  const calcResult = await enrichCalcSimplifications(
    workbook,
    client,
    model,
    cacheDir,
    (done, total, fromCache) => {
      opts.onProgress?.({ phase: 'calc_simplifications', done, total, fromCache });
    }
  );
  totalInput += calcResult.inputTokens;
  totalOutput += calcResult.outputTokens;

  const estimatedCostUsd =
    (totalInput / 1_000_000) * PRICE_PER_M_INPUT +
    (totalOutput / 1_000_000) * PRICE_PER_M_OUTPUT;

  return {
    workbook: {
      ...workbook,
      executiveSummary: execResult.value ?? workbook.executiveSummary,
      worksheets: wsResult.value,
      calculations: calcResult.value,
    },
    usage: { inputTokens: totalInput, outputTokens: totalOutput, estimatedCostUsd },
  };
}
