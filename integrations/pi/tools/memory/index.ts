/**
 * Alexandria Memory Tool for Pi Coding Agent
 *
 * Provides memory search and storage capabilities to the agent.
 */

// NOTE: This file should be copied to ~/.pi/agent/tools/memory/index.ts
// It requires Alexandria to be installed globally: bun add -g alexandria

import { Type } from '@sinclair/typebox';

// These imports would come from the Pi agent
// import type { CustomToolFactory } from '@mariozechner/pi-coding-agent';

// For now, define a minimal type
type CustomToolFactory = (pi: any) => {
  name: string;
  label: string;
  description: string;
  parameters: any;
  execute: (toolCallId: string, params: any, signal: AbortSignal) => Promise<any>;
};

const factory: CustomToolFactory = (_pi) => ({
  name: 'memory',
  label: 'Memory',
  description: `Search and manage persistent memory across sessions.

IMPORTANT: Use this tool BEFORE attempting anything that might have failed before.

Actions:
- search: Find relevant memories (hybrid lexical + semantic search)
- add: Store a new memory object
- pack: Get context pack for current task
- list: List recent memory objects`,

  parameters: Type.Object({
    action: Type.Union(
      [Type.Literal('search'), Type.Literal('add'), Type.Literal('pack'), Type.Literal('list')],
      { description: 'Action to perform' },
    ),
    query: Type.Optional(
      Type.String({
        description: 'Search query (for search action)',
      }),
    ),
    content: Type.Optional(
      Type.String({
        description: 'Memory content (for add action)',
      }),
    ),
    type: Type.Optional(
      Type.Union(
        [
          Type.Literal('decision'),
          Type.Literal('preference'),
          Type.Literal('convention'),
          Type.Literal('known_fix'),
          Type.Literal('constraint'),
          Type.Literal('failed_attempt'),
          Type.Literal('environment'),
        ],
        { description: 'Memory type (for add action)' },
      ),
    ),
    confidence: Type.Optional(
      Type.Union(
        [
          Type.Literal('certain'),
          Type.Literal('high'),
          Type.Literal('medium'),
          Type.Literal('low'),
        ],
        { description: 'Confidence level (for add action)' },
      ),
    ),
    task: Type.Optional(
      Type.String({
        description: 'Task description (for pack action)',
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal) {
    // Import Alexandria dynamically
    const { spawn } = await import('bun');

    const runAlex = async (args: string[]): Promise<string> => {
      const proc = spawn(['alex', ...args, '--json'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(stderr || stdout || 'Command failed');
      }

      return stdout;
    };

    try {
      switch (params.action) {
        case 'search': {
          if (!params.query) {
            return {
              content: [{ type: 'text', text: 'Error: query is required for search' }],
            };
          }

          const output = await runAlex(['search', params.query, '-n', '10']);
          const results = JSON.parse(output);

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: 'No memories found.' }],
            };
          }

          const formatted = results
            .map(
              (r: any, i: number) =>
                `${i + 1}. [${r.object.objectType}] ${r.object.content}\n   Score: ${r.score.toFixed(3)} | Confidence: ${r.object.confidence}`,
            )
            .join('\n\n');

          return {
            content: [{ type: 'text', text: formatted }],
            details: { results },
          };
        }

        case 'add': {
          if (!params.content || !params.type) {
            return {
              content: [{ type: 'text', text: 'Error: content and type are required for add' }],
            };
          }

          const args = ['add', params.content, '-t', params.type, '-a'];
          if (params.confidence) {
            args.push('-c', params.confidence);
          }

          const output = await runAlex(args);
          const obj = JSON.parse(output);

          return {
            content: [
              {
                type: 'text',
                text: `Stored memory: ${obj.id}\n[${obj.objectType}] ${obj.content}`,
              },
            ],
            details: { object: obj },
          };
        }

        case 'pack': {
          const args = ['pack', '-f', 'text'];
          if (params.task) {
            args.push('-t', params.task);
          }

          const proc = spawn(['alex', ...args], {
            stdout: 'pipe',
            stderr: 'pipe',
          });

          const output = await new Response(proc.stdout).text();
          await proc.exited;

          return {
            content: [{ type: 'text', text: output }],
          };
        }

        case 'list': {
          const output = await runAlex(['list', '-n', '20']);
          const objects = JSON.parse(output);

          if (objects.length === 0) {
            return {
              content: [{ type: 'text', text: 'No memory objects found.' }],
            };
          }

          const formatted = objects
            .map(
              (obj: any) =>
                `• [${obj.objectType}] ${obj.content.slice(0, 100)}${obj.content.length > 100 ? '...' : ''}`,
            )
            .join('\n');

          return {
            content: [{ type: 'text', text: formatted }],
            details: { objects },
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${params.action}` }],
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
});

export default factory;
