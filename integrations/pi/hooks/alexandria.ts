/**
 * Alexandria Hook for Pi Coding Agent
 *
 * Lifecycle-driven memory integration following Alexandria v2 architecture:
 *
 * Session Start:
 *   - Start Alexandria session tracking
 *   - Generate context pack (progressive disclosure)
 *   - Inject memories via pi.send()
 *
 * During Session:
 *   - Fire-and-forget event capture (tool calls, results, responses)
 *   - Events buffered for checkpoint-based curation
 *   - Auto-checkpoint after N events triggers extraction prompt
 *
 * Session End:
 *   - Trigger checkpoint (Tier 0 deterministic curation)
 *   - End session tracking
 *
 * Memory Extraction:
 *   - Tier 0 runs automatically (deterministic patterns)
 *   - Agent extracts higher-quality memories via skill guidance
 */

import type { HookAPI } from '@mariozechner/pi-coding-agent/hooks';

// Auto-checkpoint threshold
const AUTO_CHECKPOINT_THRESHOLD = parseInt(
  process.env.ALEXANDRIA_AUTO_CHECKPOINT_THRESHOLD || '10',
  10,
);

export default function (pi: HookAPI) {
  let currentSessionId: string | null = null;
  let eventCount = 0;

  // Helper to run alex commands
  async function alex(args: string[], input?: string): Promise<{ stdout: string; code: number }> {
    const proc = Bun.spawn(['alex', ...args], {
      stdin: input ? 'pipe' : undefined,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (input && proc.stdin) {
      proc.stdin.write(input);
      proc.stdin.end();
    }

    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { stdout, code };
  }

  // Fire-and-forget event ingestion (non-blocking)
  function ingest(content: string, type: string, meta?: Record<string, string>) {
    if (!currentSessionId || !content || content.length < 10) return;

    const args = ['ingest', '--type', type, '--skip-embedding'];
    if (meta?.tool) args.push('--tool', meta.tool);
    if (meta?.exitCode) args.push('--exit-code', meta.exitCode);

    // Fire-and-forget
    alex(args, content)
      .then(() => {
        eventCount++;
      })
      .catch(() => {});
  }

  // Run checkpoint and optionally prompt for extraction
  async function runCheckpoint(reason: string, promptExtraction: boolean, ctx: any) {
    const { stdout } = await alex(['checkpoint', '--reason', reason]);

    // Parse checkpoint result
    const match = stdout.match(/(\d+) created/);
    const created = match ? parseInt(match[1], 10) : 0;

    if (created > 0) {
      ctx.ui.notify(`📚 Checkpoint: ${created} memory(ies) extracted`, 'info');
    }

    // Prompt for intelligent extraction if we have substantial events
    if (promptExtraction && eventCount > 10) {
      pi.send(`📚 **Alexandria Memory Checkpoint**

I've processed ${eventCount} events from this session. The automatic extraction found ${created} memories.

Please review this session for any additional learnings worth remembering:

1. **Decisions**: What technical choices were made and why?
2. **Fixes**: What problems were solved and how?  
3. **Constraints**: What should always/never be done?
4. **Conventions**: What patterns were followed?

To add a memory:
\`\`\`bash
alex add "<content>" --type <decision|known_fix|constraint|convention> --approve
\`\`\`

Skip trivial or one-time things. Only add what would be valuable in future sessions.`);
    }

    // Reset counter after checkpoint
    eventCount = 0;
  }

  // Session lifecycle
  pi.on('session', async (event, ctx) => {
    if (event.reason === 'start') {
      // Start Alexandria session
      const { stdout, code } = await alex(['session', 'start', '--json']);

      if (code === 0) {
        try {
          const session = JSON.parse(stdout);
          currentSessionId = session.id;
          eventCount = 0;

          // Generate and inject context pack
          const { stdout: packOutput } = await alex(['pack', '--level', 'task', '-f', 'text']);
          const contextPack = packOutput.trim();

          if (contextPack && contextPack.length > 50) {
            pi.send(`# Alexandria Memory Context

${contextPack}

These memories contain past decisions, constraints, known fixes, and conventions for this codebase.`);

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
    }

    if (event.reason === 'shutdown' || event.reason === 'switch' || event.reason === 'clear') {
      if (currentSessionId) {
        // Run final checkpoint (no extraction prompt - session is ending)
        await alex(['checkpoint', '--reason', 'Session end']);
        await alex(['session', 'end']);

        // Show pending count
        const { stdout } = await alex(['review', '--list', '--json']);
        try {
          const pending = JSON.parse(stdout);
          if (Array.isArray(pending) && pending.length > 0) {
            ctx.ui.notify(`📚 ${pending.length} memories pending review`, 'info');
          }
        } catch {
          // Ignore
        }

        currentSessionId = null;
        eventCount = 0;
      }
    }
  });

  // Capture responses
  pi.on('turn_end', async (event, ctx) => {
    const message = event.message;
    if (message) {
      const textContent =
        typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n')
            : '';

      if (textContent) {
        ingest(textContent, 'assistant_response');

        // Check for auto-checkpoint threshold
        if (eventCount >= AUTO_CHECKPOINT_THRESHOLD) {
          await runCheckpoint('Auto-checkpoint (event threshold)', true, ctx);
        }
      }
    }
  });

  // Capture tool calls
  pi.on('tool_call', async (event, _ctx) => {
    const { toolName, input } = event;
    const content = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}`;
    ingest(content, 'tool_call', { tool: toolName });
    return undefined;
  });

  // Capture tool results
  pi.on('tool_result', async (event, _ctx) => {
    const { toolName, content, isError } = event;
    const resultText = content
      .map((c: any) => (c.type === 'text' ? c.text : `[${c.type}]`))
      .join('\n');
    ingest(resultText, 'tool_output', {
      tool: toolName,
      exitCode: isError ? '1' : '0',
    });
    return undefined;
  });
}
