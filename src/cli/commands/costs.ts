/**
 * Costs command - view LLM usage and costs
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { CostTracker } from '../../utils/cost-tracker.ts';
import { colorize, table } from '../utils.ts';

interface CostsArgs {
  json: boolean;
  session?: string;
  daily: boolean;
  budget: boolean;
}

export const command = 'costs';
export const describe = 'View LLM usage and costs';

export function builder(yargs: Argv): Argv<CostsArgs> {
  return yargs
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .option('session', {
      alias: 's',
      type: 'string',
      describe: 'Filter by session ID',
    })
    .option('daily', {
      alias: 'd',
      type: 'boolean',
      default: false,
      describe: "Show today's usage only",
    })
    .option('budget', {
      alias: 'b',
      type: 'boolean',
      default: false,
      describe: 'Show budget status',
    }) as Argv<CostsArgs>;
}

export async function handler(argv: ArgumentsCamelCase<CostsArgs>): Promise<void> {
  const db = getConnection();
  const tracker = new CostTracker(db);

  try {
    // Get summary based on filters
    let summary;
    if (argv.daily) {
      summary = tracker.getDailyUsage();
    } else if (argv.session) {
      summary = tracker.getSummary({ sessionId: argv.session });
    } else {
      summary = tracker.getSummary();
    }

    const budgetStatus = tracker.getBudgetStatus();

    if (argv.json) {
      console.log(JSON.stringify({ summary, budget: budgetStatus }, null, 2));
      return;
    }

    // Text output
    console.log(colorize('LLM Usage & Costs', 'bold'));
    console.log();

    if (summary.recordCount === 0) {
      console.log(colorize('No LLM usage recorded yet.', 'dim'));
      console.log();
      console.log('Tier 0 (deterministic) extraction has zero LLM cost.');
      console.log('LLM costs are only incurred in tier1/tier2 curator modes.');
      return;
    }

    // Summary
    console.log(colorize('Summary', 'cyan'));
    console.log(
      `  Total tokens: ${(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}`,
    );
    console.log(`    Input: ${summary.totalInputTokens.toLocaleString()}`);
    console.log(`    Output: ${summary.totalOutputTokens.toLocaleString()}`);
    console.log(`  Estimated cost: ${CostTracker.formatCost(summary.totalCost)}`);
    console.log(`  Operations: ${summary.recordCount}`);
    console.log();

    // By operation
    if (Object.keys(summary.byOperation).length > 0) {
      console.log(colorize('By Operation', 'cyan'));
      const opRows = Object.entries(summary.byOperation)
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([op, data]) => [op, data.tokens.toLocaleString(), CostTracker.formatCost(data.cost)]);
      console.log(table(['Operation', 'Tokens', 'Cost'], opRows));
      console.log();
    }

    // By model
    if (Object.keys(summary.byModel).length > 0) {
      console.log(colorize('By Model', 'cyan'));
      const modelRows = Object.entries(summary.byModel)
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([model, data]) => [
          model,
          data.tokens.toLocaleString(),
          CostTracker.formatCost(data.cost),
        ]);
      console.log(table(['Model', 'Tokens', 'Cost'], modelRows));
      console.log();
    }

    // Budget status
    if (argv.budget) {
      console.log(colorize('Budget Status', 'cyan'));

      const sessionBar = getProgressBar(budgetStatus.session.percent);
      const dailyBar = getProgressBar(budgetStatus.daily.percent);
      const tokenBar = getProgressBar(budgetStatus.tokens.percent);

      console.log(`  Session cost: ${sessionBar} ${budgetStatus.session.percent.toFixed(0)}%`);
      console.log(
        `    ${CostTracker.formatCost(budgetStatus.session.used)} / ${CostTracker.formatCost(budgetStatus.session.limit)}`,
      );
      console.log();
      console.log(`  Daily cost: ${dailyBar} ${budgetStatus.daily.percent.toFixed(0)}%`);
      console.log(
        `    ${CostTracker.formatCost(budgetStatus.daily.used)} / ${CostTracker.formatCost(budgetStatus.daily.limit)}`,
      );
      console.log();
      console.log(`  Session tokens: ${tokenBar} ${budgetStatus.tokens.percent.toFixed(0)}%`);
      console.log(
        `    ${budgetStatus.tokens.used.toLocaleString()} / ${budgetStatus.tokens.limit.toLocaleString()}`,
      );
    }
  } finally {
    closeConnection();
  }
}

function getProgressBar(percent: number): string {
  const width = 20;
  const filled = Math.min(Math.round((percent / 100) * width), width);
  const empty = width - filled;

  const color = percent >= 100 ? 'red' : percent >= 80 ? 'yellow' : 'green';
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return colorize(`[${bar}]`, color);
}
