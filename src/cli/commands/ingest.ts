/**
 * Ingest command - ingest events from stdin or file
 *
 * Auto-detects Claude OAuth for tier1 (Haiku) extraction when available.
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { Ingestor } from '../../ingestor/index.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';
import type { EventType } from '../../types/events.ts';
import { error, info, success } from '../utils.ts';

interface IngestArgs {
  content?: string;
  file?: string;
  type?: EventType;
  tool?: string;
  exitCode?: number;
  skipEmbedding: boolean;
  json: boolean;
}

export const command = 'ingest [content]';
export const describe = 'Ingest an event';

export function builder(yargs: Argv): Argv<IngestArgs> {
  return yargs
    .positional('content', {
      type: 'string',
      describe: 'Event content (or use --file)',
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      describe: 'Read content from file',
    })
    .option('type', {
      alias: 't',
      type: 'string',
      choices: ['user_prompt', 'assistant_response', 'tool_call', 'tool_output', 'turn', 'diff', 'test_summary', 'error'] as EventType[],
      describe: 'Event type (auto-detected if not specified)',
    })
    .option('tool', {
      type: 'string',
      describe: 'Tool name (for tool_output events)',
    })
    .option('exit-code', {
      type: 'number',
      describe: 'Exit code (for tool_output events)',
    })
    .option('skip-embedding', {
      type: 'boolean',
      default: false,
      describe: 'Skip embedding generation',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    }) as Argv<IngestArgs>;
}

export async function handler(argv: ArgumentsCamelCase<IngestArgs>): Promise<void> {
  const db = getConnection();
  const sessions = new SessionStore(db);
  
  // Use async factory to auto-detect Claude OAuth for Haiku extraction
  // This enables tier1 (Haiku) automatically when Claude OAuth is available
  const ingestor = await Ingestor.create(db, {
    useCheckpoints: true,
  });

  try {
    // Get or create session
    let session = sessions.getLatest();
    if (!session || session.endedAt) {
      session = sessions.start({ workingDirectory: process.cwd() });
      info(`Created new session: ${session.id}`);
    }

    // Get content
    let content = argv.content;

    if (argv.file) {
      const file = Bun.file(argv.file);
      content = await file.text();
    }

    if (!content) {
      // Read from stdin
      const reader = Bun.stdin.stream().getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const decoder = new TextDecoder();
      content = chunks.map((c) => decoder.decode(c)).join('');
    }

    if (!content.trim()) {
      error('No content to ingest');
      process.exit(1);
    }

    // Ingest
    const event = await ingestor.ingest(session.id, content, {
      eventType: argv.type,
      toolName: argv.tool,
      exitCode: argv.exitCode,
      skipEmbedding: argv.skipEmbedding,
    });

    // Track events for auto-checkpoint
    const eventsSinceCheckpoint = sessions.incrementEventsSinceCheckpoint(session.id);
    
    // Auto-checkpoint threshold (configurable via env, default 10 events)
    const autoCheckpointThreshold = parseInt(process.env.ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD || '10', 10);
    
    let checkpointResult = null;
    if (eventsSinceCheckpoint >= autoCheckpointThreshold) {
      // Load session events since last checkpoint and run checkpoint
      ingestor.loadSessionForCheckpoint(session.id, session.lastCheckpointAt);
      checkpointResult = await ingestor.flushCheckpoint('Auto-checkpoint (event threshold)');
      
      if (checkpointResult) {
        sessions.markCheckpointCompleted(session.id);
      }
    }

    if (argv.json) {
      console.log(JSON.stringify({ 
        event, 
        checkpoint: checkpointResult ? {
          memoriesCreated: checkpointResult.memoriesCreated,
          trigger: checkpointResult.trigger.type,
        } : null 
      }, null, 2));
    } else {
      success(`Ingested event: ${event.id}`);
      console.log(`Type: ${event.eventType}`);
      console.log(`Tokens: ${event.tokenCount}`);
      
      if (checkpointResult && checkpointResult.memoriesCreated > 0) {
        console.log(`\n📚 Auto-checkpoint: ${checkpointResult.memoriesCreated} memory(ies) created`);
      }
    }
  } finally {
    closeConnection();
  }
}
