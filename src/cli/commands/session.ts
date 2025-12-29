/**
 * Session command - session management
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { ReviewPipeline } from '../../reviewer/index.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { colorize, error, formatDate, info, success, table } from '../utils.ts';

interface SessionArgs {
  action: 'start' | 'end' | 'list' | 'current' | 'process';
  task?: string;
  summary?: string;
  json: boolean;
}

export const command = 'session <action>';
export const describe = 'Session management';

export function builder(yargs: Argv): Argv<SessionArgs> {
  return yargs
    .positional('action', {
      type: 'string',
      choices: ['start', 'end', 'list', 'current', 'process'] as const,
      demandOption: true,
      describe: 'Action to perform',
    })
    .option('task', {
      alias: 't',
      type: 'string',
      describe: 'Working task description',
    })
    .option('summary', {
      alias: 's',
      type: 'string',
      describe: 'Session summary (for end)',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<SessionArgs>;
}

export async function handler(argv: ArgumentsCamelCase<SessionArgs>): Promise<void> {
  const db = getConnection();
  const sessions = new SessionStore(db);

  try {
    switch (argv.action) {
      case 'start': {
        const cwd = process.cwd();
        const session = sessions.start({
          workingDirectory: cwd,
          workingTask: argv.task,
        });

        if (argv.json) {
          console.log(JSON.stringify(session, null, 2));
        } else {
          success(`Started session: ${session.id}`);
          console.log(`Working directory: ${cwd}`);
          if (argv.task) {
            console.log(`Task: ${argv.task}`);
          }
        }
        break;
      }

      case 'end': {
        const current = sessions.getLatest();
        if (!current) {
          error('No active session found');
          process.exit(1);
        }

        if (current.endedAt) {
          error('Session already ended');
          process.exit(1);
        }

        sessions.end(current.id, argv.summary);

        if (argv.json) {
          const updated = sessions.get(current.id);
          console.log(JSON.stringify(updated, null, 2));
        } else {
          success(`Ended session: ${current.id}`);
          if (argv.summary) {
            console.log(`Summary: ${argv.summary}`);
          }
        }
        break;
      }

      case 'list': {
        const list = sessions.list(20);

        if (argv.json) {
          console.log(JSON.stringify(list, null, 2));
        } else if (list.length === 0) {
          info('No sessions found');
        } else {
          const headers = ['ID', 'Started', 'Ended', 'Events', 'Task'];
          const rows = list.map((s) => [
            s.id.slice(0, 12),
            formatDate(s.startedAt),
            s.endedAt ? formatDate(s.endedAt) : '-',
            String(s.eventsCount),
            s.workingTask?.slice(0, 30) || '-',
          ]);
          console.log(table(headers, rows));
        }
        break;
      }

      case 'current': {
        const current = sessions.getLatest();

        if (!current) {
          error('No session found');
          process.exit(1);
        }

        if (argv.json) {
          console.log(JSON.stringify(current, null, 2));
        } else {
          console.log(colorize('Current Session', 'bold'));
          console.log(`ID: ${current.id}`);
          console.log(`Started: ${formatDate(current.startedAt)}`);
          console.log(`Status: ${current.endedAt ? 'ended' : 'active'}`);
          console.log(`Directory: ${current.workingDirectory || '-'}`);
          console.log(`Task: ${current.workingTask || '-'}`);
          console.log(`Events: ${current.eventsCount}`);
          console.log(`Objects created: ${current.objectsCreated}`);
          console.log(`Objects accessed: ${current.objectsAccessed}`);
        }
        break;
      }

      case 'process': {
        const current = sessions.getLatest();
        if (!current) {
          error('No session found');
          process.exit(1);
        }

        const pipeline = new ReviewPipeline(db);
        const result = await pipeline.processSession(current.id);

        if (argv.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          success('Session processed');
          console.log(`Extracted: ${result.extracted} candidates`);
          console.log(`Created: ${result.created} objects`);
          console.log(`Merged: ${result.merged} objects`);
          console.log(`Superseded: ${result.superseded} objects`);
          console.log(`Queued: ${result.queued} for review`);
        }
        break;
      }
    }
  } finally {
    closeConnection();
  }
}
