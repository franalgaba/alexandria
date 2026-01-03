/**
 * Event Normalizer - Pre-processes events before storage
 *
 * Responsibilities:
 * - Generate synopses for large tool outputs
 * - Extract structured signals (exit codes, file changes, error signatures)
 * - Deduplicate by content hash
 * - Collapse tool episodes (call + result)
 */

import type { Event, EventType } from '../types/events.ts';

// Maximum inline content length before generating synopsis
const MAX_INLINE_LENGTH = 500;

// Synopsis templates by event type
const SYNOPSIS_TEMPLATES = {
  tool_output: '{tool}: {status} ({size})',
  error: 'Error: {signature}',
  test_summary: 'Tests: {passed} passed, {failed} failed',
  diff: 'Changed {files} file(s)',
};

export interface NormalizedEvent {
  /** Original event type */
  eventType: EventType;

  /** Full content (may be moved to blob) */
  content: string;

  /** Short synopsis (always inline) */
  synopsis?: string;

  /** Structured signals extracted from content */
  structuredSignals?: StructuredSignals;

  /** Hash for deduplication */
  contentHash: string;

  /** Episode ID for grouping related events */
  episodeId?: string;

  /** Whether content should be moved to blob storage */
  shouldBlob: boolean;
}

export interface StructuredSignals {
  exitCode?: number;
  filesChanged?: string[];
  errorSignature?: string;
  testsPassed?: number;
  testsFailed?: number;
  lineCount?: number;
  byteCount?: number;
}

/**
 * Generate a short synopsis for an event
 */
export function generateSynopsis(
  content: string,
  eventType: EventType,
  metadata?: { toolName?: string; exitCode?: number; filePath?: string },
): string {
  const lineCount = content.split('\n').length;
  const byteCount = content.length;

  switch (eventType) {
    case 'tool_output':
      return generateToolOutputSynopsis(content, metadata);
    case 'error':
      return generateErrorSynopsis(content);
    case 'test_summary':
      return generateTestSynopsis(content);
    case 'diff':
      return generateDiffSynopsis(content, metadata);
    default:
      return `${eventType}: ${lineCount} lines, ${formatBytes(byteCount)}`;
  }
}

/**
 * Generate synopsis for tool output
 */
function generateToolOutputSynopsis(
  content: string,
  metadata?: { toolName?: string; exitCode?: number },
): string {
  const tool = metadata?.toolName || 'unknown';
  const exitCode = metadata?.exitCode;
  const status = exitCode === 0 ? 'success' : exitCode ? `failed (${exitCode})` : 'completed';
  const size = formatBytes(content.length);

  // Extract key info based on tool
  let detail = '';

  if (tool === 'bash' || tool === 'shell') {
    // Try to extract command
    const cmdMatch = content.match(/^\$\s*(.+?)(?:\n|$)/m);
    if (cmdMatch) {
      detail = `: ${cmdMatch[1].slice(0, 50)}`;
    }
  } else if (tool === 'read') {
    const lineCount = content.split('\n').length;
    detail = `: ${lineCount} lines`;
  } else if (tool === 'edit' || tool === 'write') {
    const pathMatch = content.match(/(?:path|file):\s*["']?([^"'\n]+)/i);
    if (pathMatch) {
      detail = `: ${pathMatch[1]}`;
    }
  }

  return `${tool}: ${status}${detail} (${size})`;
}

/**
 * Generate synopsis for error
 */
function generateErrorSynopsis(content: string): string {
  // Try to extract error signature
  const patterns = [
    /error[:\s]+(.+?)(?:\n|$)/i,
    /exception[:\s]+(.+?)(?:\n|$)/i,
    /failed[:\s]+(.+?)(?:\n|$)/i,
    /^(.+?error.+?)$/im,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return `Error: ${match[1].slice(0, 100)}`;
    }
  }

  return `Error: ${content.slice(0, 100)}`;
}

/**
 * Generate synopsis for test summary
 */
function generateTestSynopsis(content: string): string {
  // Try to extract test counts - more flexible patterns
  const passMatch = content.match(/(\d+)\s*(?:tests?\s+)?(?:pass|passed|✓)/i);
  const failMatch = content.match(/(\d+)\s*(?:tests?\s+)?(?:fail|failed|✗)/i);

  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

  if (passed > 0 || failed > 0) {
    return `Tests: ${passed} passed, ${failed} failed`;
  }

  // Check for all pass/fail patterns
  if (/all (?:tests? )?pass/i.test(content)) {
    return 'Tests: all passed';
  }
  if (/(?:test|tests) failed/i.test(content)) {
    return 'Tests: failed';
  }

  return `Tests: ${content.slice(0, 80)}`;
}

/**
 * Generate synopsis for diff
 */
function generateDiffSynopsis(content: string, metadata?: { filePath?: string }): string {
  // Count files changed
  const fileMatches = content.match(/^(?:diff|---|\+\+\+)\s+[ab]?\/?(.+?)(?:\s|$)/gm);
  const files = new Set(
    fileMatches?.map((m) => m.replace(/^(?:diff|---|\+\+\+)\s+[ab]?\/?/, '').trim()),
  );

  // Count additions/deletions
  const additions = (content.match(/^\+[^+]/gm) || []).length;
  const deletions = (content.match(/^-[^-]/gm) || []).length;

  const fileCount = files.size || 1;
  const filePath = metadata?.filePath || Array.from(files)[0] || 'unknown';

  return `Diff: ${filePath} (+${additions}/-${deletions})`;
}

/**
 * Extract structured signals from content
 */
export function extractSignals(
  content: string,
  eventType: EventType,
  metadata?: { toolName?: string; exitCode?: number; filePath?: string },
): StructuredSignals {
  const signals: StructuredSignals = {
    lineCount: content.split('\n').length,
    byteCount: content.length,
  };

  // Exit code
  if (metadata?.exitCode !== undefined) {
    signals.exitCode = metadata.exitCode;
  }

  // Files changed (from diffs or tool outputs)
  const filePatterns = [
    /(?:modified|changed|created|deleted):\s*([^\s]+)/gi,
    /^(?:M|A|D|R)\s+(.+)$/gm,
    /(?:---|\+\+\+)\s+[ab]?\/?(.+?)(?:\s|$)/gm,
  ];

  const files = new Set<string>();
  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const file = match[1].trim();
      if (file && !file.startsWith('/dev/null')) {
        files.add(file);
      }
    }
  }

  if (files.size > 0) {
    signals.filesChanged = Array.from(files);
  }

  // Error signature
  if (eventType === 'error' || (metadata?.exitCode !== undefined && metadata.exitCode !== 0)) {
    const errorPatterns = [
      /error[:\s]+(.+?)$/im, // Error: message (to end of line)
      /error[:\s]+(.+?)(?:\n|at\s)/i, // Error: message (before newline or 'at')
      /exception[:\s]+(.+?)$/im,
      /^(.+?error.+?)$/im,
    ];

    for (const pattern of errorPatterns) {
      const match = content.match(pattern);
      if (match) {
        signals.errorSignature = match[1].trim().slice(0, 200);
        break;
      }
    }
  }

  // Test results
  if (eventType === 'test_summary' || /test|spec/i.test(metadata?.toolName || '')) {
    const passMatch = content.match(/(\d+)\s*(?:tests?\s+)?(?:pass|passed|✓)/i);
    const failMatch = content.match(/(\d+)\s*(?:tests?\s+)?(?:fail|failed|✗)/i);

    if (passMatch) signals.testsPassed = parseInt(passMatch[1], 10);
    if (failMatch) signals.testsFailed = parseInt(failMatch[1], 10);
  }

  return signals;
}

/**
 * Generate content hash for deduplication
 */
export function hashContent(content: string): string {
  // Simple hash: first 100 chars + length + checksum
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  const prefix = normalized.slice(0, 100);
  const length = normalized.length;

  // Simple checksum
  let checksum = 0;
  for (let i = 0; i < normalized.length; i++) {
    checksum = ((checksum << 5) - checksum + normalized.charCodeAt(i)) | 0;
  }

  return `${prefix.slice(0, 32)}_${length}_${Math.abs(checksum).toString(36)}`;
}

/**
 * Normalize an event before storage
 */
export function normalizeEvent(
  content: string,
  eventType: EventType,
  metadata?: { toolName?: string; exitCode?: number; filePath?: string },
): NormalizedEvent {
  const shouldBlob = content.length > MAX_INLINE_LENGTH;

  return {
    eventType,
    content,
    synopsis: shouldBlob ? generateSynopsis(content, eventType, metadata) : undefined,
    structuredSignals: extractSignals(content, eventType, metadata),
    contentHash: hashContent(content),
    shouldBlob,
  };
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Check if two events are duplicates based on content hash
 */
export function isDuplicate(hash1: string, hash2: string): boolean {
  return hash1 === hash2;
}

/**
 * Group events into episodes based on time and tool sequences
 */
export function groupIntoEpisodes(
  events: Array<{ timestamp: Date; toolName?: string; eventType: EventType }>,
  maxGapMs: number = 60000, // 1 minute
): Map<string, number[]> {
  const episodes = new Map<string, number[]>();
  let currentEpisodeId = 0;
  let lastTimestamp: Date | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Start new episode if gap is too large
    if (lastTimestamp && event.timestamp.getTime() - lastTimestamp.getTime() > maxGapMs) {
      currentEpisodeId++;
    }

    const episodeKey = `ep_${currentEpisodeId}`;
    const indices = episodes.get(episodeKey) || [];
    indices.push(i);
    episodes.set(episodeKey, indices);

    lastTimestamp = event.timestamp;
  }

  return episodes;
}
