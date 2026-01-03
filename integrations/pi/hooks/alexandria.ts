/**
 * Alexandria Hook for Pi Coding Agent
 *
 * Lifecycle-driven memory integration following Alexandria v2 architecture.
 * Matches Claude Code hook behavior for consistency.
 *
 * Session Start:
 *   - Start Alexandria session tracking
 *   - Generate context pack with hot memories (progressive disclosure)
 *   - Inject memories via pi.sendMessage()
 *   - Check for stale memories
 *
 * During Session:
 *   - Fire-and-forget event capture (prompts, tool calls, results, responses)
 *   - Events buffered for checkpoint-based curation
 *   - Auto-checkpoint after N events triggers tiered extraction
 *   - Progressive disclosure on topic shifts, error bursts, explicit queries
 *
 * Session End:
 *   - Trigger checkpoint (Tier 0 + Tier 1 if available)
 *   - End session tracking
 *   - Show session stats
 *
 * Memory Extraction:
 *   - Tier 0 runs automatically (deterministic patterns)
 *   - Tier 1 runs if Claude OAuth available (Haiku extraction)
 */

import type { HookAPI } from '@mariozechner/pi-coding-agent';

// Configuration from environment
const AUTO_CHECKPOINT_THRESHOLD = parseInt(
  process.env.ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD || '10',
  10,
);
const ERROR_BURST_THRESHOLD = parseInt(process.env.ALEXANDRIA_ERROR_BURST_THRESHOLD || '3', 10);
const DISCLOSURE_THRESHOLD = parseInt(process.env.ALEXANDRIA_DISCLOSURE_THRESHOLD || '15', 10);

export default function (pi: HookAPI) {
  let currentSessionId: string | null = null;
  let eventCount = 0;
  let errorCount = 0;
  let eventsSinceDisclosure = 0;
  let lastWorkingFile: string | null = null;

  // Helper to run alex commands using pi.exec()
  async function alex(args: string[]): Promise<{ stdout: string; code: number }> {
    const result = await pi.exec('alex', args);
    return { stdout: result.stdout, code: result.code };
  }

  // Fire-and-forget event ingestion (non-blocking)
  function ingest(content: string, type: string, meta?: Record<string, string>) {
    if (!currentSessionId || !content || content.length < 10) return;

    // Truncate very long content to avoid command line limits
    const truncatedContent = content.length > 10000 ? content.slice(0, 10000) + '...[truncated]' : content;

    const args = ['ingest', truncatedContent, '--type', type, '--skip-embedding'];
    if (meta?.tool) args.push('--tool', meta.tool);
    if (meta?.exitCode) args.push('--exit-code', meta.exitCode);

    // Fire-and-forget
    alex(args)
      .then(() => {
        eventCount++;
        eventsSinceDisclosure++;
      })
      .catch(() => {});
  }

  // Run checkpoint
  async function runCheckpoint(reason: string, ctx: any) {
    const { stdout } = await alex(['checkpoint', '--reason', reason]);

    // Parse checkpoint result
    const match = stdout.match(/(\d+) created/);
    const created = match ? parseInt(match[1], 10) : 0;

    if (created > 0) {
      ctx.ui.notify(`📚 Checkpoint: ${created} memory(ies) extracted`, 'info');
    }

    // Reset counter after checkpoint
    eventCount = 0;
  }

  // Check for progressive disclosure triggers and re-inject if needed
  async function checkDisclosure(query: string, ctx: any): Promise<boolean> {
    // Check if disclosure is needed
    const { stdout, code } = await alex(['disclose', '--check', '--query', query]);

    if (code !== 0) return false;

    try {
      const result = JSON.parse(stdout);
      if (result.needed) {
        // Get incremental context
        const { stdout: contextOutput } = await alex(['disclose', '--query', query, '-f', 'text']);

        if (contextOutput && contextOutput.trim().length > 50) {
          pi.sendMessage({
            customType: 'alexandria-disclosure',
            content: `# Alexandria: Additional Context (${result.trigger})

${contextOutput.trim()}`,
            display: true,
          });
          eventsSinceDisclosure = 0;
          return true;
        }
      }
    } catch {
      // Ignore parse errors
    }

    return false;
  }

  // Session start - inject context
  pi.on('session_start', async (_event, ctx) => {
    // Start Alexandria session
    const { stdout, code } = await alex(['session', 'start', '--json']);

    if (code === 0) {
      try {
        const session = JSON.parse(stdout);
        currentSessionId = session.id;
        eventCount = 0;
        errorCount = 0;
        eventsSinceDisclosure = 0;
        lastWorkingFile = null;

        // Generate and inject context pack with hot memories
        const { stdout: packOutput } = await alex([
          'pack',
          '--level',
          'task',
          '--hot',
          '-f',
          'text',
        ]);
        const contextPack = packOutput.trim();

        if (contextPack && contextPack.length > 50) {
          // Use pi.sendMessage() to inject context into the session
          pi.sendMessage({
            customType: 'alexandria-context',
            content: `# Alexandria Memory Context

${contextPack}

These memories contain past decisions, constraints, known fixes, and conventions for this codebase.`,
            display: true,
          });

          ctx.ui.notify('📚 Alexandria memories loaded', 'info');
        }

        // Check for stale memories
        const { stdout: staleOutput } = await alex(['check', '--json']);
        try {
          const staleData = JSON.parse(staleOutput);
          const staleCount = staleData?.stale?.length || 0;
          if (staleCount > 0) {
            ctx.ui.notify(`⚠️ ${staleCount} memory(ies) may be stale`, 'warning');
          }
        } catch {
          // Ignore
        }
      } catch {
        // Graceful degradation
      }
    }
  });

  // Session switch - run checkpoint before switching
  pi.on('session_before_switch', async (_event, ctx) => {
    if (currentSessionId) {
      // Run final checkpoint
      await alex(['checkpoint', '--reason', 'Session end']);
      await alex(['session', 'end']);

      // Show summary
      const { stdout: statsOutput } = await alex(['stats', '--json']);
      try {
        const stats = JSON.parse(statsOutput);
        const totalObjects = stats?.totalObjects || 0;
        ctx.ui.notify(`📚 Session ended. ${totalObjects} total memories.`, 'info');
      } catch {
        // Ignore
      }

      currentSessionId = null;
      eventCount = 0;
      errorCount = 0;
      eventsSinceDisclosure = 0;
    }

    return {}; // Don't cancel the switch
  });

  // Handle session shutdown
  pi.on('session_shutdown', async (_event, ctx) => {
    if (currentSessionId) {
      // Run final checkpoint
      await alex(['checkpoint', '--reason', 'Session shutdown']);
      await alex(['session', 'end']);

      // Show summary
      const { stdout: statsOutput } = await alex(['stats', '--json']);
      try {
        const stats = JSON.parse(statsOutput);
        const totalObjects = stats?.totalObjects || 0;
        ctx.ui.notify(`📚 Session ended. ${totalObjects} total memories.`, 'info');
      } catch {
        // Ignore
      }

      currentSessionId = null;
    }
  });

  // Capture user prompts and check for disclosure triggers
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt;
    if (!prompt || prompt.length < 10) return;

    // Buffer prompt for checkpoint curation
    ingest(prompt, 'user_prompt');

    // Check for explicit memory queries
    const memoryPatterns = [
      /remind me/i,
      /what did we decide/i,
      /what do you remember/i,
      /previous session/i,
      /we discussed/i,
    ];

    // Check if we should inject additional context
    let shouldDisclose = false;
    if (memoryPatterns.some((p) => p.test(prompt))) {
      shouldDisclose = true;
    } else if (eventsSinceDisclosure >= DISCLOSURE_THRESHOLD) {
      shouldDisclose = true;
    }

    if (shouldDisclose) {
      // Check if disclosure is needed and get context
      const { stdout, code } = await alex(['disclose', '--check', '--query', prompt]);

      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          if (result.needed) {
            const { stdout: contextOutput } = await alex(['disclose', '--query', prompt, '-f', 'text']);

            if (contextOutput && contextOutput.trim().length > 50) {
              eventsSinceDisclosure = 0;
              // Return message to inject into context
              return {
                message: {
                  customType: 'alexandria-disclosure',
                  content: `# Alexandria: Additional Context (${result.trigger})

${contextOutput.trim()}`,
                  display: true,
                },
              };
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return undefined;
  });

  // Capture responses at turn end
  pi.on('turn_end', async (event, ctx) => {
    const message = event.message;
    if (message && message.role === 'assistant') {
      // Extract text content from the assistant message
      let textContent = '';
      if (typeof message.content === 'string') {
        textContent = message.content;
      } else if (Array.isArray(message.content)) {
        textContent = message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }

      if (textContent && textContent.length > 10) {
        ingest(textContent, 'assistant_response');

        // Check for auto-checkpoint threshold
        if (eventCount >= AUTO_CHECKPOINT_THRESHOLD) {
          await runCheckpoint('Auto-checkpoint (event threshold)', ctx);
        }
      }
    }
  });

  // Capture tool calls
  pi.on('tool_call', async (event, _ctx) => {
    const { toolName, input } = event;
    const content = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}`;
    ingest(content, 'tool_call', { tool: toolName });

    // Track file changes for topic shift detection
    if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
      const filePath =
        (input as any)?.path || (input as any)?.file_path || (input as any)?.filePath;
      if (filePath && typeof filePath === 'string' && filePath !== lastWorkingFile) {
        const previousFile = lastWorkingFile;
        lastWorkingFile = filePath;

        // Check for topic shift (different directory)
        if (previousFile) {
          const prevDir = previousFile.split('/').slice(0, -1).join('/');
          const newDir = filePath.split('/').slice(0, -1).join('/');
          if (prevDir !== newDir && eventsSinceDisclosure > 5) {
            // Topic shift detected - inject context via sendMessage
            const { stdout } = await alex(['disclose', '--file', filePath, '-f', 'text']);
            if (stdout && stdout.trim().length > 50) {
              pi.sendMessage({
                customType: 'alexandria-topic-shift',
                content: `# Alexandria: Context for ${filePath.split('/').pop()}

${stdout.trim()}`,
                display: true,
              });
              eventsSinceDisclosure = 0;
            }
          }
        }
      }
    }

    return undefined; // Don't block the tool call
  });

  // Capture tool results
  pi.on('tool_result', async (event, _ctx) => {
    const { toolName, content, isError } = event;

    // Extract text from content array
    const resultText = content
      .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
      .join('\n');

    // Detect exit code from result for bash commands
    let exitCode = isError ? '1' : '0';
    if (toolName === 'bash') {
      // Check details for exit code if available
      const details = (event as any).details;
      if (details?.exitCode !== undefined) {
        exitCode = String(details.exitCode);
      } else {
        // Fall back to pattern matching
        const exitMatch = resultText.match(/exit code:?\s*(\d+)/i);
        if (exitMatch) {
          exitCode = exitMatch[1];
        } else if (
          /error|failed|command not found|permission denied|no such file/i.test(resultText)
        ) {
          exitCode = '1';
        }
      }
    }

    ingest(resultText, 'tool_output', {
      tool: toolName,
      exitCode,
    });

    // Track consecutive errors for error burst detection
    if (isError || exitCode !== '0') {
      errorCount++;
      if (errorCount >= ERROR_BURST_THRESHOLD) {
        // Error burst detected - inject constraints and known fixes
        const { stdout } = await alex(['pack', '--level', 'task', '-f', 'text']);
        if (stdout && stdout.trim().length > 50) {
          pi.sendMessage({
            customType: 'alexandria-error-burst',
            content: `# Alexandria: Relevant Context (error burst detected)

${stdout.trim()}

Check for known fixes or constraints that might help.`,
            display: true,
          });
          errorCount = 0;
          eventsSinceDisclosure = 0;
        }
      }
    } else {
      // Reset error count on success
      errorCount = 0;
    }

    return undefined; // Don't modify the tool result
  });
}
