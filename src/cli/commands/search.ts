/**
 * Search command - hybrid search for memory objects
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { Retriever } from '../../retriever/index.ts';
import { classifyIntent, getIntentDescription, getIntentEmoji } from '../../retriever/intent.ts';
import { RetrievalRouter } from '../../retriever/router.ts';
import { extractScope } from '../../retriever/scope.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { formatSearchResults } from '../../utils/format.ts';
import { colorize, info } from '../utils.ts';

interface SearchArgs {
  query: string;
  limit: number;
  type?: string;
  status: string[];
  lexicalOnly: boolean;
  vectorOnly: boolean;
  smart: boolean;
  json: boolean;
}

export const command = 'search <query>';
export const describe = 'Search memory objects (hybrid: lexical + semantic)';

export function builder(yargs: Argv): Argv<SearchArgs> {
  return yargs
    .positional('query', {
      type: 'string',
      demandOption: true,
      describe: 'Search query',
    })
    .option('limit', {
      alias: 'n',
      type: 'number',
      default: 10,
      describe: 'Maximum results to return',
    })
    .option('type', {
      alias: 't',
      type: 'string',
      choices: [
        'decision',
        'preference',
        'convention',
        'known_fix',
        'constraint',
        'failed_attempt',
        'environment',
      ],
      describe: 'Filter by object type',
    })
    .option('status', {
      alias: 's',
      type: 'array',
      default: ['active'],
      describe: 'Filter by status',
    })
    .option('lexical-only', {
      type: 'boolean',
      default: false,
      describe: 'Use only lexical (FTS) search',
    })
    .option('vector-only', {
      type: 'boolean',
      default: false,
      describe: 'Use only vector (semantic) search',
    })
    .option('smart', {
      type: 'boolean',
      default: false,
      describe: 'Use smart retrieval (intent detection + routing)',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<SearchArgs>;
}

export async function handler(argv: ArgumentsCamelCase<SearchArgs>): Promise<void> {
  const db = getConnection();
  const retriever = new Retriever(db);

  try {
    let results: Awaited<ReturnType<typeof retriever.search>>;
    let searchInfo: { intent?: string; scope?: string } = {};

    if (argv.smart) {
      // Smart search with intent detection and routing
      const router = new RetrievalRouter();
      const plan = router.route(argv.query);
      const intent = classifyIntent(argv.query);
      const scope = extractScope(argv.query);
      
      searchInfo.intent = intent;
      if (scope) {
        searchInfo.scope = `${scope.scope.type}:${scope.scope.path}`;
      }
      
      results = await retriever.searchWithPlan(argv.query, plan);
    } else if (argv.lexicalOnly) {
      results = retriever.searchLexical(argv.query, {
        limit: argv.limit,
        status: argv.status as string[],
        objectType: argv.type,
      });
    } else if (argv.vectorOnly) {
      results = await retriever.searchVector(argv.query, {
        limit: argv.limit,
        status: argv.status as string[],
        objectType: argv.type,
      });
    } else {
      results = await retriever.search(argv.query, {
        limit: argv.limit,
        status: argv.status as string[],
        objectType: argv.type,
      });
    }

    if (argv.json) {
      console.log(JSON.stringify({ ...searchInfo, results }, null, 2));
    } else {
      // Show intent detection if smart search
      if (argv.smart && searchInfo.intent) {
        const emoji = getIntentEmoji(searchInfo.intent as any);
        const desc = getIntentDescription(searchInfo.intent as any);
        console.log(colorize(`${emoji} Intent: ${searchInfo.intent}`, 'cyan'));
        console.log(colorize(`   ${desc}`, 'dim'));
        if (searchInfo.scope) {
          console.log(colorize(`📁 Scope: ${searchInfo.scope}`, 'cyan'));
        }
        console.log();
      }
      
      if (results.length === 0) {
        info('No results found.');
      } else {
        console.log(colorize(`Found ${results.length} result(s):\n`, 'dim'));
        console.log(formatSearchResults(results));
      }
    }
  } finally {
    closeConnection();
  }
}
