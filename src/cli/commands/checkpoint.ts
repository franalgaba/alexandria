/**
 * Checkpoint command - manually trigger memory curation checkpoint
 */

import type { Database } from 'bun:sqlite';
import type { ArgumentsCamelCase, Argv } from 'yargs';
import { Ingestor } from '../../ingestor/index.ts';
import { getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';

interface CheckpointArgs {
  session?: string;
  reason: string;
  showStats: boolean;
  curator?: 'tier0' | 'tier1' | 'tier2';
}

export const command = 'checkpoint';
export const describe = 'Manually trigger a checkpoint to curate buffered events into memories';

export function builder(yargs: Argv): Argv<CheckpointArgs> {
  return yargs
    .option('session', {
      type: 'string',
      description: 'Target specific session (default: current session)',
    })
    .option('reason', {
      type: 'string',
      description: 'Reason for checkpoint',
      default: 'Manual checkpoint',
    })
    .option('showStats', {
      alias: 'show-stats',
      type: 'boolean',
      description: 'Show checkpoint buffer statistics before executing',
      default: false,
    })
    .option('curator', {
      type: 'string',
      choices: ['tier0', 'tier1', 'tier2'] as const,
      description: 'Override curator mode (tier2 enables conflict detection)',
    }) as Argv<CheckpointArgs>;
}

export async function handler(args: ArgumentsCamelCase<CheckpointArgs>) {
  const db = getConnection();

  try {
    await executeCheckpoint(db, {
      sessionId: args.session,
      reason: args.reason,
      showStats: args.showStats,
      curator: args.curator,
    });
  } catch (error) {
    console.error('Checkpoint failed:', error);
    process.exit(1);
  }
}

interface CheckpointOptions {
  sessionId?: string;
  reason: string;
  showStats?: boolean;
  curator?: 'tier0' | 'tier1' | 'tier2';
}

async function executeCheckpoint(db: Database, options: CheckpointOptions) {
  const sessionStore = new SessionStore(db);
  // Use async factory to auto-detect Claude OAuth and enable tier1 (Haiku) if available
  const ingestor = await Ingestor.create(db, {
    useCheckpoints: true,
    checkpointConfig: options.curator ? { curatorMode: options.curator } : undefined,
  });

  // Get current or specified session
  let sessionId = options.sessionId;
  let session;
  if (!sessionId) {
    session = sessionStore.getCurrent();
    if (!session) {
      console.error('❌ No active session. Start a session first or specify --session <id>');
      process.exit(1);
    }
    sessionId = session.id;
  } else {
    session = sessionStore.get(sessionId);
  }

  // Get last checkpoint time to only process new events
  const lastCheckpointAt = session?.lastCheckpointAt;

  // Load events from the session into checkpoint buffer (only since last checkpoint)
  const eventCount = ingestor.loadSessionForCheckpoint(sessionId, lastCheckpointAt);

  // Show buffer stats if requested
  if (options.showStats) {
    const stats = ingestor.getCheckpointStats();
    console.log('\n📊 Session Events:');
    console.log(`   Events: ${stats.events}`);
    console.log(`   Tool Outputs: ${stats.toolOutputs}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log('');
  }

  if (eventCount === 0) {
    console.log('ℹ️  No events in session, nothing to checkpoint');
    return;
  }

  // Execute checkpoint
  console.log(`🔄 Checkpointing ${eventCount} events...`);
  const result = await ingestor.flushCheckpoint(options.reason);

  if (!result) {
    console.log('ℹ️  Checkpoint produced no results');
    return;
  }

  // Mark checkpoint completed in session
  sessionStore.markCheckpointCompleted(sessionId);

  // Display results
  console.log('\n✅ Checkpoint Complete');
  console.log(`   Trigger: ${result.trigger.type} (${result.trigger.reason})`);
  console.log(`   Episode Events: ${result.episodeEventCount}`);
  console.log(`   Candidates Extracted: ${result.candidatesExtracted}`);
  console.log(`   Memories Created: ${result.memoriesCreated}`);
  console.log(`   Memories Updated: ${result.memoriesUpdated}`);
  console.log(`   Rehydration Ready: ${result.rehydrationReady ? 'Yes' : 'No'}`);
  console.log('');

  // Show next steps
  if (result.rehydrationReady && result.memoriesCreated > 0) {
    console.log('💡 Next steps:');
    console.log('   • Review new memories: alex list --status pending');
    console.log('   • Approve valuable ones: alex review');
    console.log('   • Generate fresh context: alex pack');
    console.log('');
  }
}
