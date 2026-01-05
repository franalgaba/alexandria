/**
 * Disclose command - check and perform progressive memory disclosure
 *
 * Used by hooks to determine if re-injection is needed and get incremental context.
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import {
  createEscalationDetector,
  type ContextLevel,
  type EscalationSignal,
} from '../../retriever/escalation.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { colorize } from '../utils.ts';

interface DiscloseArgs {
  query?: string;
  file?: string;
  force: boolean;
  level?: ContextLevel;
  check: boolean;
  format: 'yaml' | 'json' | 'text';
  errorCount?: number;
}

export const command = 'disclose';
export const describe = 'Check/perform progressive memory disclosure';

export function builder(yargs: Argv): Argv<DiscloseArgs> {
  return yargs
    .option('query', {
      alias: 'q',
      type: 'string',
      describe: 'Current user query (for explicit trigger detection)',
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      describe: 'Current working file (for topic shift detection)',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Force disclosure even if not triggered',
    })
    .option('level', {
      alias: 'l',
      type: 'string',
      choices: ['minimal', 'task', 'deep'] as const,
      describe: 'Override disclosure level',
    })
    .option('check', {
      alias: 'c',
      type: 'boolean',
      default: false,
      describe: 'Only check if disclosure needed (no output)',
    })
    .option('format', {
      type: 'string',
      choices: ['yaml', 'json', 'text'] as const,
      default: 'text' as const,
      describe: 'Output format',
    })
    .option('errorCount', {
      alias: 'e',
      type: 'number',
      describe: 'Increment error count by this amount',
    }) as Argv<DiscloseArgs>;
}

export async function handler(argv: ArgumentsCamelCase<DiscloseArgs>): Promise<void> {
  const db = getConnection();
  const sessions = new SessionStore(db);
  const objects = new MemoryObjectStore(db);
  const detector = createEscalationDetector(db);

  try {
    // Get current session
    const session = sessions.getCurrent();
    if (!session) {
      if (argv.check) {
        console.log(JSON.stringify({ needed: false, reason: 'no_session' }));
      }
      return;
    }

    // Increment error count if specified
    if (argv.errorCount) {
      for (let i = 0; i < argv.errorCount; i++) {
        sessions.incrementErrorCount(session.id);
      }
      // Re-fetch session error count
      session.errorCount = sessions.getErrorCount(session.id);
    }

    // Update topic if file provided
    if (argv.file) {
      const { shifted } = sessions.updateTopic(session.id, argv.file);
      if (shifted) {
        session.lastTopic = argv.file;
      }
    }

    // Analyze for escalation
    const signal = detector.analyze(session, argv.query, argv.file);

    // Check-only mode
    if (argv.check) {
      console.log(
        JSON.stringify({
          needed: signal !== null || argv.force,
          trigger: signal?.trigger ?? (argv.force ? 'forced' : null),
          suggestedLevel: signal?.suggestedLevel ?? argv.level ?? 'task',
          reason: signal?.reason ?? (argv.force ? 'Forced disclosure' : 'No trigger'),
          errorCount: session.errorCount,
          eventsSinceCheckpoint: session.eventsSinceCheckpoint,
        }),
      );
      return;
    }

    // No disclosure needed
    if (!signal && !argv.force) {
      return;
    }

    // Determine level and focus type
    const level = argv.level ?? signal?.suggestedLevel ?? 'task';
    let focusTypes: string[] | undefined;

    if (signal?.trigger === 'error_burst') {
      focusTypes = ['constraint', 'known_fix', 'failed_attempt'];
    }

    // Get already-injected IDs
    const injectedIds = sessions.getInjectedMemoryIds(session.id);
    const injectedSet = new Set(injectedIds);

    // Get memories to inject (excluding already-injected)
    const allMemories = objects.list({
      status: ['active'],
      limit: 50,
    });

    // Filter out already injected and apply focus types
    let newMemories = allMemories.filter((m) => !injectedSet.has(m.id));

    if (focusTypes) {
      // Prioritize focus types but include others too
      const focusedMemories = newMemories.filter((m) => focusTypes!.includes(m.objectType));
      const otherMemories = newMemories.filter((m) => !focusTypes!.includes(m.objectType));
      newMemories = [...focusedMemories, ...otherMemories];
    }

    // Limit based on level
    const limits = { minimal: 3, task: 8, deep: 15 };
    newMemories = newMemories.slice(0, limits[level]);

    // If no new memories, skip injection
    if (newMemories.length === 0) {
      if (argv.format === 'json') {
        console.log(JSON.stringify({ injected: false, reason: 'no_new_memories' }));
      }
      return;
    }

    // Record injected IDs
    const newIds = newMemories.map((m) => m.id);
    sessions.addInjectedMemoryIds(session.id, newIds);
    sessions.updateDisclosureLevel(session.id, level);

    // Reset error count after successful disclosure
    if (signal?.trigger === 'error_burst') {
      sessions.resetErrorCount(session.id);
    }

    // Output formatted context
    if (argv.format === 'json') {
      console.log(
        JSON.stringify({
          injected: true,
          trigger: signal?.trigger ?? 'forced',
          level,
          newMemories: newIds.length,
          memories: newMemories.map((m) => ({
            id: m.id,
            type: m.objectType,
            content: m.content,
            codeRefs: m.codeRefs,
          })),
        }),
      );
    } else {
      // Format for injection
      const header = getDisclosureHeader(signal);
      console.log(header);
      console.log();
      for (const m of newMemories) {
        const typeEmoji = getTypeEmoji(m.objectType);
        const codeRef =
          m.codeRefs && m.codeRefs.length > 0
            ? ` [${m.codeRefs.map((r) => r.path).join(', ')}]`
            : '';
        console.log(`  ${typeEmoji} ${m.content}${codeRef}`);
      }
    }
  } finally {
    closeConnection();
  }
}

function getDisclosureHeader(signal: EscalationSignal | null): string {
  if (!signal) return '=== MEMORY REFRESH ===';

  switch (signal.trigger) {
    case 'error_burst':
      return '=== MEMORY REFRESH (Errors Detected) ===\nShowing constraints and known fixes:';
    case 'topic_shift':
      return '=== MEMORY REFRESH (Topic Change) ===\nRelevant memories for this area:';
    case 'explicit_query':
      return '=== MEMORY REFRESH (Requested) ===';
    case 'event_threshold':
      return '=== MEMORY REFRESH ===\nAdditional context for current work:';
    default:
      return '=== MEMORY CONTEXT ===';
  }
}

function getTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    decision: '🎯',
    preference: '⭐',
    convention: '📏',
    known_fix: '✅',
    constraint: '🚫',
    failed_attempt: '❌',
    environment: '⚙️',
  };
  return emojis[type] || '📝';
}
