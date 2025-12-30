/**
 * Checkpoint command - manually trigger memory curation checkpoint
 */

import type { Database } from 'bun:sqlite';
import type { ArgumentsCamelCase, Argv } from 'yargs';
import { getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { Ingestor } from '../../ingestor/index.ts';

interface CheckpointArgs {
  session?: string;
  reason: string;
  showStats: boolean;
}

export const command = 'checkpoint';
export const describe = 'Manually trigger a checkpoint to curate buffered events into memories';

export function builder(yargs: Argv) {
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
    .option('show-stats', {
      type: 'boolean',
      description: 'Show checkpoint buffer statistics before executing',
      default: false,
    });
}

export async function handler(args: ArgumentsCamelCase<CheckpointArgs>) {
  const db = getConnection();
  
  try {
    await executeCheckpoint(db, {
      sessionId: args.session,
      reason: args.reason,
      showStats: args.showStats,
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
}

async function executeCheckpoint(db: Database, options: CheckpointOptions) {
  const sessionStore = new SessionStore(db);
  const ingestor = new Ingestor(db, {
    useCheckpoints: true,
    checkpointConfig: {
      curatorMode: 'tier0', // Start with deterministic only
    },
  });

  // Get current or specified session
  let sessionId = options.sessionId;
  if (!sessionId) {
    const current = sessionStore.getCurrent();
    if (!current) {
      console.error('❌ No active session. Start a session first or specify --session <id>');
      process.exit(1);
    }
    sessionId = current.id;
  }

  // Show buffer stats if requested
  if (options.showStats) {
    const stats = ingestor.getCheckpointStats();
    console.log('\n📊 Checkpoint Buffer Statistics:');
    console.log(`   Events: ${stats.events}`);
    console.log(`   Tool Outputs: ${stats.toolOutputs}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Age: ${Math.round(stats.age / 1000)}s`);
    console.log(`   Last Checkpoint: ${stats.lastCheckpoint.toISOString()}`);
    console.log('');
  }

  // Execute checkpoint
  console.log('🔄 Executing checkpoint...');
  const result = await ingestor.flushCheckpoint(options.reason);

  if (!result) {
    console.log('ℹ️  No events in buffer, nothing to checkpoint');
    return;
  }

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
