/**
 * Alexandria Revalidation Hook for pi-coding-agent
 *
 * On session start, checks for stale memories and prompts
 * the user to verify, retire, or skip each one using the TUI.
 *
 * Installation:
 *   # Global
 *   cp integrations/pi/hooks/revalidation.ts ~/.pi/agent/hooks/
 *
 *   # Or project-local
 *   cp integrations/pi/hooks/revalidation.ts .pi/hooks/
 *
 *   # Or via command line
 *   pi --hook ./integrations/pi/hooks/revalidation.ts
 */

import type { HookAPI } from '@mariozechner/pi-coding-agent';

interface StaleMemory {
  id: string;
  content: string;
  type: string;
  level: string;
  reasons: string[];
}

interface CheckResult {
  total: number;
  stale: StaleMemory[];
}

export default function (pi: HookAPI) {
  pi.on('session_start', async (_event, ctx) => {
    // Check if alex is available
    const { code: whichCode } = await pi.exec('which', ['alex']);
    if (whichCode !== 0) {
      // Alexandria not installed or not in PATH
      return;
    }

    // Get stale memories
    const { stdout, code: checkCode } = await pi.exec('alex', ['check', '--json']);
    if (checkCode !== 0 || !stdout.trim()) {
      return;
    }

    let result: CheckResult;
    try {
      result = JSON.parse(stdout);
    } catch {
      return;
    }

    const staleMemories = result.stale || [];
    if (staleMemories.length === 0) {
      return;
    }

    // Notify user about stale memories
    ctx.ui.notify(`📚 Alexandria: ${staleMemories.length} memory(ies) need revalidation`, 'info');

    // Check if interactive UI is available
    if (!ctx.hasUI) {
      // In non-interactive mode, just log
      return;
    }

    // Ask user if they want to review now
    const reviewNow = await ctx.ui.confirm(
      '📚 Alexandria Memory Check',
      `Found ${staleMemories.length} stale memory(ies). Review them now?`,
    );

    if (!reviewNow) {
      ctx.ui.notify("Skipped memory review. Run 'alex revalidate' later.", 'info');
      return;
    }

    // Process each stale memory
    for (const memory of staleMemories) {
      const shortId = memory.id.substring(0, 8);
      const content =
        memory.content.length > 60 ? memory.content.substring(0, 57) + '...' : memory.content;

      const reasons = memory.reasons.join(', ');

      const choice = await ctx.ui.select(
        `⚠️ [${memory.type}] "${content}"\n` + `   Reason: ${reasons}`,
        [
          '✅ Verify - still valid',
          '🗑️ Retire - no longer needed',
          '⏭️ Skip - review later',
          '🚪 Stop reviewing',
        ],
      );

      if (!choice || choice.includes('Stop')) {
        ctx.ui.notify('Stopped memory review', 'info');
        break;
      }

      if (choice.includes('Verify')) {
        const { code } = await pi.exec('alex', ['verify', shortId]);
        if (code === 0) {
          ctx.ui.notify(`✓ Verified: ${shortId}`, 'info');
        } else {
          ctx.ui.notify(`Failed to verify: ${shortId}`, 'error');
        }
      } else if (choice.includes('Retire')) {
        const { code } = await pi.exec('alex', ['retire', shortId]);
        if (code === 0) {
          ctx.ui.notify(`✓ Retired: ${shortId}`, 'info');
        } else {
          ctx.ui.notify(`Failed to retire: ${shortId}`, 'error');
        }
      }
      // Skip does nothing
    }

    ctx.ui.notify('Memory review complete', 'info');
  });
}
