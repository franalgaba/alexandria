/**
 * Ingest command - ingest events from stdin or file
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { Ingestor, OllamaProvider, ClaudeProvider, OpenAIProvider } from '../../ingestor/index.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { SessionStore } from '../../stores/sessions.ts';
import type { EventType } from '../../types/events.ts';
import { error, info, success } from '../utils.ts';

/**
 * Get LLM provider from environment
 */
function getLLMProvider() {
  // Check for API keys in environment
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';

  if (anthropicKey) {
    return new ClaudeProvider(anthropicKey);
  }
  if (openaiKey) {
    return new OpenAIProvider(openaiKey);
  }
  // Default to Ollama (local)
  return new OllamaProvider(ollamaModel, ollamaUrl);
}

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
  
  // Check if intelligent extraction is enabled via environment
  const useIntelligent = process.env.ALEXANDRIA_INTELLIGENT_EXTRACTION === 'true';
  const llmProvider = useIntelligent ? getLLMProvider() : undefined;
  
  const ingestor = new Ingestor(db, { 
    llmProvider, 
    useIntelligent,
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

    if (argv.json) {
      console.log(JSON.stringify(event, null, 2));
    } else {
      success(`Ingested event: ${event.id}`);
      console.log(`Type: ${event.eventType}`);
      console.log(`Tokens: ${event.tokenCount}`);
      // Note: memories are extracted in real-time by the ingestor
    }
  } finally {
    closeConnection();
  }
}
