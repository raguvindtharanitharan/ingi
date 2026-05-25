import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { parseWorkbook } from './parsers/index.js';
import { generateMarkdownModel } from './generators/index.js';
import { enrichWorkbook, type EnrichStep } from './enrichers/index.js';
import { logger as log } from './utils/logger.js';

declare const __DREXO_VERSION__: string;

const program = new Command();

program
  .name('drexo')
  .description(
    chalk.cyan(
      'Migrate Tableau workbooks (.twb / .twbx) into modern React dashboards.\n' +
        'v0.1 ships the metadata layer; React generation lands in v0.2.'
    )
  )
  .version(__DREXO_VERSION__, '-v, --version', 'output the current version')
  .helpOption('-h, --help', 'display help for command')
  .option('-d, --debug', 'enable debug logging');

program.on('option:debug', () => {
  process.env.DEBUG = '1';
});

program.addHelpText(
  'after',
  `
${chalk.bold('Examples:')}
  $ drexo analyze ./examples/giving-renewal-summary.twbx
  $ drexo analyze ./report.twbx --output ./report.model.md

${chalk.bold('Learn more:')}
  https://github.com/raguvindtharanitharan/drexo
`
);

// ---------------------------------------------------------------------------
// NOTE: command logic is currently inline. If commands grow beyond analyze +
// migrate, extract each into its own module (e.g. src/commands/analyze.ts)
// so cli.ts stays a thin dispatcher.
// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

program
  .command('analyze <file>')
  .description(
    'Parse a Tableau workbook (.twbx) and write a canonical metadata file (markdown + YAML).'
  )
  .option('-o, --output <path>', 'output file path (default: <input>.model.md)')
  .option('--enrich', 'enrich metadata with AI-generated summaries and descriptions (requires ANTHROPIC_API_KEY)')
  .option('--enrich-model <model>', 'Claude model to use for enrichment', 'claude-haiku-4-5-20251001')
  .action(async (file: string, options: { output?: string; enrich?: boolean; enrichModel?: string }) => {
    const start = performance.now();
    try {
      if (!existsSync(file)) {
        log.error(`File not found: ${file}`);
        process.exit(1);
      }

      if (options.enrich && !process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('\n✖ --enrich requires ANTHROPIC_API_KEY\n'));
        console.error(chalk.gray('  Set the environment variable and re-run:'));
        console.error(chalk.cyan('    export ANTHROPIC_API_KEY=sk-ant-...'));
        console.error(chalk.cyan(`    drexo analyze ${file} --enrich\n`));
        console.error(chalk.gray('  Get an API key at: https://console.anthropic.com\n'));
        process.exit(1);
      }

      log.info(`🔍 Analyzing ${chalk.bold(path.basename(file))}`);

      let workbook = await parseWorkbook(file);
      log.success(
        `Parsed ${workbook.dataSources.length} data sources, ` +
          `${workbook.worksheets.length} worksheets, ` +
          `${workbook.dashboards.length} dashboards`
      );

      if (options.enrich) {
        log.info(`✦ Enriching metadata (${workbook.worksheets.length} worksheets, ${workbook.calculations.length} calculations)...`);

        const { workbook: enriched, usage } = await enrichWorkbook(workbook, {
          apiKey: process.env.ANTHROPIC_API_KEY!,
          model: options.enrichModel,
          onProgress: (step: EnrichStep) => {
            const label: Record<EnrichStep['phase'], string> = {
              executive_summary: 'executive summary',
              worksheet_descriptions: 'worksheet descriptions',
              calc_simplifications: 'calc simplifications',
            };
            const name = label[step.phase];
            const cacheNote = step.fromCache > 0 ? chalk.gray(` (${step.fromCache} from cache)`) : '';
            if (step.done === step.total) {
              const counter = step.total > 1 ? ` [${step.done}/${step.total}]` : '';
              log.success(`  ${name}${counter}${cacheNote}`);
            }
          },
        });

        workbook = enriched;

        const costDisplay = usage.estimatedCostUsd < 0.001
          ? chalk.gray('< $0.001')
          : chalk.gray(`~$${usage.estimatedCostUsd.toFixed(4)}`);
        log.info(
          `  Tokens used: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out  ${costDisplay}`
        );
      }

      const markdown = generateMarkdownModel(workbook);
      const outputPath = options.output ?? defaultOutputPath(file);
      await writeFile(outputPath, markdown, 'utf-8');

      const elapsed = ((performance.now() - start) / 1000).toFixed(2);
      const sizeKb = (markdown.length / 1024).toFixed(1);
      log.success(`Wrote ${chalk.cyan(outputPath)} (${sizeKb} KB) in ${elapsed}s`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log.error(`Could not parse workbook: ${reason}`);
      if (process.env.DEBUG && e instanceof Error && e.stack) {
        console.error(chalk.gray(e.stack));
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// migrate (v0.2 stub)
// ---------------------------------------------------------------------------

program
  .command('migrate <file>')
  .description(
    "[v0.2] Generate a React app from a workbook. Not yet implemented — try `drexo analyze` for v0.1's metadata output."
  )
  .action((file: string) => {
    log.warn(
      '`drexo migrate` is a v0.2 feature. It will read the metadata file produced by `drexo analyze` and generate a Vite + React app.'
    );
    log.info(`For v0.1, try:    ${chalk.cyan(`drexo analyze ${file}`)}`);
  });

// ---------------------------------------------------------------------------
// No-command → help
// ---------------------------------------------------------------------------

if (process.argv.length === 2) {
  program.help();
}

program.parse(process.argv);

function defaultOutputPath(inputFile: string): string {
  const parsed = path.parse(inputFile);
  return path.join(parsed.dir, `${parsed.name}.model.md`);
}
