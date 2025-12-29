/**
 * Symbols command - list symbols in a file
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { existsSync } from 'node:fs';
import { SymbolExtractor, formatSymbol, type Symbol } from '../../code/symbols.ts';
import { colorize, error } from '../utils.ts';

interface SymbolsArgs {
  file: string;
  kind?: string;
  exported: boolean;
  json: boolean;
}

export const command = 'symbols <file>';
export const describe = 'List symbols in a source file';

export function builder(yargs: Argv): Argv<SymbolsArgs> {
  return yargs
    .positional('file', {
      type: 'string',
      describe: 'File path to analyze',
      demandOption: true,
    })
    .option('kind', {
      alias: 'k',
      type: 'string',
      choices: ['function', 'class', 'variable', 'interface', 'type', 'const'],
      describe: 'Filter by symbol kind',
    })
    .option('exported', {
      alias: 'e',
      type: 'boolean',
      default: false,
      describe: 'Show only exported symbols',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<SymbolsArgs>;
}

export async function handler(argv: ArgumentsCamelCase<SymbolsArgs>): Promise<void> {
  if (!existsSync(argv.file)) {
    error(`File not found: ${argv.file}`);
    return;
  }
  
  const extractor = new SymbolExtractor({ includePrivate: !argv.exported });
  let symbols = extractor.extract(argv.file);
  
  // Filter by kind
  if (argv.kind) {
    symbols = symbols.filter(s => s.kind === argv.kind);
  }
  
  // Filter exported only
  if (argv.exported) {
    symbols = symbols.filter(s => s.exported);
  }
  
  if (argv.json) {
    console.log(JSON.stringify(symbols, null, 2));
    return;
  }
  
  if (symbols.length === 0) {
    console.log(colorize('No symbols found', 'dim'));
    return;
  }
  
  console.log(colorize(`Found ${symbols.length} symbol(s) in ${argv.file}:\n`, 'dim'));
  
  // Group by kind
  const grouped = groupByKind(symbols);
  
  for (const [kind, kindSymbols] of Object.entries(grouped)) {
    console.log(colorize(`${kind.toUpperCase()} (${kindSymbols.length}):`, 'cyan'));
    for (const sym of kindSymbols) {
      const exportBadge = sym.exported ? '📤' : '🔒';
      console.log(`  ${exportBadge} ${sym.name} (line ${sym.line})`);
    }
    console.log();
  }
}

function groupByKind(symbols: Symbol[]): Record<string, Symbol[]> {
  const grouped: Record<string, Symbol[]> = {};
  
  for (const sym of symbols) {
    if (!grouped[sym.kind]) {
      grouped[sym.kind] = [];
    }
    grouped[sym.kind].push(sym);
  }
  
  return grouped;
}
