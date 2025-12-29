/**
 * Where command - show which database is being used
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import {
  getDbPath,
  getAlexandriaHome,
  getCurrentProjectInfo,
  isUsingGlobalDatabase,
  listProjectDatabases,
} from '../../stores/connection.ts';
import { colorize, table } from '../utils.ts';

interface WhereArgs {
  all: boolean;
}

export const command = 'where';
export const describe = 'Show Alexandria database location(s)';

export function builder(yargs: Argv): Argv<WhereArgs> {
  return yargs.option('all', {
    alias: 'a',
    type: 'boolean',
    default: false,
    describe: 'List all project databases',
  }) as Argv<WhereArgs>;
}

export async function handler(argv: ArgumentsCamelCase<WhereArgs>): Promise<void> {
  const dbPath = getDbPath();
  const home = getAlexandriaHome();
  const projectInfo = getCurrentProjectInfo();
  const isGlobal = isUsingGlobalDatabase();

  console.log(colorize('Alexandria Database', 'bold'));
  console.log();
  console.log(`Home: ${home}`);
  console.log(`Current DB: ${dbPath}`);
  console.log(
    `Type: ${isGlobal ? colorize('Global', 'yellow') : colorize('Project-specific', 'green')}`
  );

  if (projectInfo) {
    console.log(`Project: ${projectInfo.name}`);
    console.log(`Path: ${projectInfo.path}`);
  }

  if (argv.all) {
    console.log();
    console.log(colorize('All Project Databases', 'bold'));
    console.log();

    const projects = listProjectDatabases();

    if (projects.length === 0) {
      console.log('No project databases found.');
    } else {
      const headers = ['Project', 'Path', 'Database'];
      const rows = projects.map((p) => [
        p.name,
        p.projectPath.length > 40 ? `...${p.projectPath.slice(-37)}` : p.projectPath,
        p.dbPath.replace(home, '~/.alexandria'),
      ]);
      console.log(table(headers, rows));
    }
  }
}
