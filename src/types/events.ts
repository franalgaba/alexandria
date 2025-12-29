/**
 * Event types for the append-only event log
 */

export type EventType = 
  | 'user_prompt'      // User message to the agent
  | 'assistant_response' // Agent's text response
  | 'tool_call'        // Tool invocation (input)
  | 'tool_output'      // Tool result (output)
  | 'turn'             // Full turn (legacy, for backward compat)
  | 'diff'             // Code diff
  | 'test_summary'     // Test results
  | 'error';           // Error message

export interface Event {
  id: string;
  sessionId: string;
  timestamp: Date;
  eventType: EventType;
  content?: string;
  blobId?: string;
  toolName?: string;
  filePath?: string;
  exitCode?: number;
  contentHash?: string;
  tokenCount?: number;
}

export interface EventRow {
  id: string;
  session_id: string;
  timestamp: string;
  event_type: string;
  content: string | null;
  blob_id: string | null;
  tool_name: string | null;
  file_path: string | null;
  exit_code: number | null;
  content_hash: string | null;
  token_count: number | null;
}

export interface Blob {
  id: string;
  content: Uint8Array;
  size: number;
  createdAt: Date;
}

export interface BlobRow {
  id: string;
  content: Uint8Array;
  size: number;
  created_at: string;
}
