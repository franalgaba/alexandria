#!/usr/bin/env bun
/**
 * Alexandria CLI - Local-first memory system for coding agents
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as addCmd from './cli/commands/add.ts';
import * as addContractCmd from './cli/commands/add-contract.ts';
import * as addDecisionCmd from './cli/commands/add-decision.ts';
import * as checkCmd from './cli/commands/check.ts';
import * as conflictsCmd from './cli/commands/conflicts.ts';
import * as editCmd from './cli/commands/edit.ts';
import * as exportCmd from './cli/commands/export.ts';
import * as hooksCmd from './cli/commands/hooks.ts';
import * as ingestCmd from './cli/commands/ingest.ts';
import * as installCmd from './cli/commands/install.ts';
import * as linkCmd from './cli/commands/link.ts';
import * as listCmd from './cli/commands/list.ts';
import * as packCmd from './cli/commands/pack.ts';
import * as retireCmd from './cli/commands/retire.ts';
import * as revalidateCmd from './cli/commands/revalidate.ts';
import * as reviewCmd from './cli/commands/review.ts';
import * as searchCmd from './cli/commands/search.ts';
import * as sessionCmd from './cli/commands/session.ts';
import * as showCmd from './cli/commands/show.ts';
import * as statsCmd from './cli/commands/stats.ts';
import * as supersedeCmd from './cli/commands/supersede.ts';
import * as symbolsCmd from './cli/commands/symbols.ts';
import * as verifyCmd from './cli/commands/verify.ts';
import * as whereCmd from './cli/commands/where.ts';

yargs(hideBin(process.argv))
  .scriptName('alex')
  .usage('$0 <command> [options]')
  .command(searchCmd)
  .command(addCmd)
  .command(addDecisionCmd)
  .command(addContractCmd)
  
  .command(listCmd)
  .command(packCmd)
  .command(reviewCmd)
  .command(sessionCmd)
  .command(showCmd)
  .command(statsCmd)
  .command(supersedeCmd)
  .command(retireCmd)
  .command(revalidateCmd)
  .command(editCmd)
  .command(ingestCmd)
  .command(exportCmd)
  .command(whereCmd)
  .command(checkCmd)
  .command(verifyCmd)
  .command(linkCmd)
  .command(hooksCmd)
  .command(installCmd)
  .command(conflictsCmd)
  .command(symbolsCmd)
  .demandCommand(1, 'You need at least one command')
  .strict()
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .epilog('Alexandria - Local-first memory system for coding agents')
  .parse();
