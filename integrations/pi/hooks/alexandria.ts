/**
 * Alexandria Hook for Pi Coding Agent
 *
 * Captures the full conversation (prompts, responses, tool calls, results)
 * for automatic memory extraction.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

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

  // Ingest content to Alexandria
  async function ingest(content: string, type: string, meta?: Record<string, string>) {
    if (!currentSessionId || !content || content.length < 10) return;
    
    const args = ["ingest", "--type", type, "--skip-embedding"];
    if (meta?.tool) args.push("--tool", meta.tool);
    if (meta?.exitCode) args.push("--exit-code", meta.exitCode);
    
    await alex(args, content);
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
          if (packOutput.trim()) {
            ctx.ui.notify("📚 Alexandria context loaded", "info");
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    if (event.reason === "shutdown" || event.reason === "switch" || event.reason === "clear") {
      if (currentSessionId) {
        // End session (memories already extracted in real-time)
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
    // Note: event structure depends on pi's API - adjust as needed
    const prompt = (event as any).userMessage || (event as any).prompt;
    if (prompt) {
      await ingest(prompt, "user_prompt");
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
        await ingest(textContent, "assistant_response");
      }
    }
  });

  // Capture tool calls (the input/invocation)
  pi.on("tool_call", async (event, _ctx) => {
    const { toolName, input } = event;
    const content = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}`;
    await ingest(content, "tool_call", { tool: toolName });
    
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
    
    await ingest(resultText, "tool_output", { 
      tool: toolName,
      exitCode: isError ? "1" : exitCode,
    });
    
    // Don't modify - return undefined
    return undefined;
  });
}
