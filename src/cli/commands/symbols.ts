/**
 * Symbols command - list symbols in a file using regex or LSP
 */

import { existsSync } from 'node:fs';
import type { ArgumentsCamelCase, Argv } from 'yargs';
import { getLSPClient, shutdownLSP } from '../../code/lsp.ts';
import { formatSymbol, type Symbol, SymbolExtractor } from '../../code/symbols.ts';
import { colorize, error } from '../utils.ts';

interface SymbolsArgs {
  file: string;
  kind?: string;
  exported: boolean;
  json: boolean;
  lsp: boolean;
  definition?: string;
  references?: string;
}

export const command = 'symbols <file>';
export const describe = 'List symbols in a source file (regex or LSP)';

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
    })
    .option('lsp', {
      type: 'boolean',
      default: false,
      describe: 'Use LSP instead of regex (requires language server)',
    })
    .option('definition', {
      alias: 'd',
      type: 'string',
      describe: 'Get definition location for symbol at line:col',
    })
    .option('references', {
      alias: 'r',
      type: 'string',
      describe: 'Find references to symbol at line:col',
    }) as Argv<SymbolsArgs>;
}

export async function handler(argv: ArgumentsCamelCase<SymbolsArgs>): Promise<void> {
  if (!existsSync(argv.file)) {
    error(`File not found: ${argv.file}`);
    return;
  }

  try {
    // Handle definition lookup
    if (argv.definition) {
      const [line, col] = argv.definition.split(':').map(Number);
      if (!line || isNaN(line)) {
        error('Invalid position format. Use: line:col (e.g., 10:5)');
        return;
      }

      const client = getLSPClient();
      const def = await client.getDefinition(argv.file, line, col || 0);

      if (def) {
        if (argv.json) {
          console.log(JSON.stringify(def, null, 2));
        } else {
          console.log(colorize('Definition found:', 'green'));
          console.log(`  ${def.path}:${def.line}:${def.character}`);
        }
      } else {
        console.log(colorize('No definition found', 'dim'));
      }

      await shutdownLSP();
      return;
    }

    // Handle references lookup
    if (argv.references) {
      const [line, col] = argv.references.split(':').map(Number);
      if (!line || isNaN(line)) {
        error('Invalid position format. Use: line:col (e.g., 10:5)');
        return;
      }

      const client = getLSPClient();
      const refs = await client.getReferences(argv.file, line, col || 0);

      if (argv.json) {
        console.log(JSON.stringify(refs, null, 2));
      } else if (refs.length === 0) {
        console.log(colorize('No references found', 'dim'));
      } else {
        console.log(colorize(`Found ${refs.length} reference(s):`, 'green'));
        for (const ref of refs) {
          console.log(`  ${ref.path}:${ref.line}:${ref.character}`);
        }
      }

      await shutdownLSP();
      return;
    }

    // List symbols
    let symbols: Symbol[];
    if (argv.lsp) {
      const client = getLSPClient();
      symbols = await client.getSymbols(argv.file);
      await shutdownLSP();
    } else {
      const extractor = new SymbolExtractor({ includePrivate: !argv.exported });
      symbols = extractor.extract(argv.file);
    }

    // Filter by kind
    if (argv.kind) {
      symbols = symbols.filter((s) => s.kind === argv.kind);
    }

    // Filter exported only
    if (argv.exported) {
      symbols = symbols.filter((s) => s.exported);
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

    if (argv.lsp) {
      console.log(colorize('(via LSP)', 'dim'));
    }
  } catch (err) {
    error(`Error: ${err}`);
    await shutdownLSP();
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
