/**
 * Alexandria Hook for Pi Coding Agent
 *
 * Captures the full conversation (prompts, responses, tool calls, results)
 * for automatic memory extraction. Also writes context to ALEXANDRIA.md
 * for system prompt inclusion.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";
import * as fs from "node:fs";
import * as path from "node:path";

export default function (pi: HookAPI) {
  let currentSessionId: string | null = null;

  // Helper to run alex commands
  async function alex(args: string[], input?: string): Promise<{ stdout: string; code: number }> {
    const proc = Bun.spawn(["alex", ...args], {
      stdin: input ? "pipe" : undefined,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (input && proc.stdin) {
      proc.stdin.write(input);
      proc.stdin.end();
    }

    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { stdout, code };
  }

  // Ingest content to Alexandria (fire-and-forget)
  function ingest(content: string, type: string, meta?: Record<string, string>) {
    if (!currentSessionId || !content || content.length < 10) return;

    const args = ["ingest", "--type", type, "--skip-embedding"];
    if (meta?.tool) args.push("--tool", meta.tool);
    if (meta?.exitCode) args.push("--exit-code", meta.exitCode);

    // Fire-and-forget - don't await
    alex(args, content).catch(() => {});
  }

  // Write context pack to ALEXANDRIA.md for system prompt inclusion
  async function writeContextFile(ctx: any, contextPack: string) {
    try {
      const contextDir = path.join(ctx.cwd, ".pi");
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }

      const contextFile = path.join(contextDir, "ALEXANDRIA.md");
      const content = `# Alexandria Memory Context

The following memories from past sessions are relevant to this project:

${contextPack}

Use these memories to inform your responses. They contain past decisions, constraints, known fixes, and conventions for this codebase.

Use the \`memory\` tool to search for additional memories or add new ones.
`;

      fs.writeFileSync(contextFile, content, "utf-8");
    } catch {
      // Ignore write errors
    }
  }

  pi.on("session", async (event, ctx) => {
    if (event.reason === "start") {
      // Start Alexandria session
      const { stdout, code } = await alex(["session", "start", "--json"]);

      if (code === 0) {
        try {
          const session = JSON.parse(stdout);
          currentSessionId = session.id;

          // Load context pack
          const { stdout: packOutput } = await alex(["pack", "-f", "text", "-b", "1500"]);
          const contextPack = packOutput.trim();

          if (contextPack) {
            // Write to context file for system prompt inclusion
            await writeContextFile(ctx, contextPack);
            ctx.ui.notify("📚 Alexandria memories loaded", "info");
          }

          // Check for stale memories
          const { stdout: staleOutput } = await alex(["check", "--json"]);
          try {
            const staleData = JSON.parse(staleOutput);
            const staleCount = staleData?.stale?.length || 0;
            if (staleCount > 0) {
              ctx.ui.notify(`⚠️ ${staleCount} memory(ies) may be stale`, "warning");
            }
          } catch {
            // Ignore parse errors
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    if (event.reason === "shutdown" || event.reason === "switch" || event.reason === "clear") {
      if (currentSessionId) {
        // Process session to extract memories from buffered context
        // This triggers the intelligent extractor to analyze accumulated events
        const { stdout: processOutput } = await alex(["session", "process", "--json"]);
        
        try {
          const result = JSON.parse(processOutput);
          if (result.created > 0 || result.extracted > 0) {
            ctx.ui.notify(`📚 Extracted ${result.created} memories from session`, "info");
          }
        } catch {
          // Ignore parse errors
        }

        // End session
        await alex(["session", "end"]);

        // Check pending count
        const { stdout } = await alex(["review", "--list", "--json"]);

        try {
          const pending = JSON.parse(stdout);
          if (Array.isArray(pending) && pending.length > 0) {
            ctx.ui.notify(`📚 ${pending.length} memories pending review`, "info");
          }
        } catch {
          // Ignore
        }

        currentSessionId = null;
      }
    }
  });

  // Capture user prompts
  pi.on("agent_start", async (event, _ctx) => {
    // The user's prompt that started this agent loop
    const prompt = (event as any).userMessage || (event as any).prompt;
    if (prompt) {
      ingest(prompt, "user_prompt");
    }
  });

  // Capture assistant responses
  pi.on("turn_end", async (event, _ctx) => {
    // Capture the assistant's response
    const message = event.message;
    if (message) {
      // Extract text content from the message
      const textContent = typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n")
          : "";

      if (textContent) {
        ingest(textContent, "assistant_response");
      }
    }
  });

  // Capture tool calls (the input/invocation)
  pi.on("tool_call", async (event, _ctx) => {
    const { toolName, input } = event;
    const content = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}`;
    ingest(content, "tool_call", { tool: toolName });

    // Don't block - let the tool execute
    return undefined;
  });

  // Capture tool results
  pi.on("tool_result", async (event, _ctx) => {
    const { toolName, content, isError, details } = event;

    // Format the result
    const resultText = content
      .map((c: any) => c.type === "text" ? c.text : `[${c.type}]`)
      .join("\n");

    const exitCode = details?.exitCode?.toString();

    ingest(resultText, "tool_output", {
      tool: toolName,
      exitCode: isError ? "1" : exitCode,
    });

    // Don't modify - return undefined
    return undefined;
  });
}
