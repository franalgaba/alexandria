/**
 * Revalidation Prompts - identify memories that need verification
 */

import type { MemoryObject } from '../types/memory-objects.ts';
import type { StalenessResult } from '../reviewer/staleness.ts';

export interface RevalidationPrompt {
  /** Memory that needs revalidation */
  memory: MemoryObject;
  /** Why it needs revalidation */
  reasons: string[];
  /** Suggested action */
  suggestedAction: 'verify' | 'update' | 'retire';
  /** Priority (higher = more urgent) */
  priority: number;
}

/**
 * Generate revalidation prompts from staleness results
 */
export function generatePrompts(
  memories: MemoryObject[],
  stalenessResults: Map<string, StalenessResult>
): RevalidationPrompt[] {
  const prompts: RevalidationPrompt[] = [];

  for (const memory of memories) {
    const staleness = stalenessResults.get(memory.id);
    
    if (!staleness?.isStale) {
      continue;
    }

    const prompt = createPrompt(memory, staleness);
    if (prompt) {
      prompts.push(prompt);
    }
  }

  // Sort by priority descending
  return prompts.sort((a, b) => b.priority - a.priority);
}

/**
 * Create a revalidation prompt for a stale memory
 */
function createPrompt(memory: MemoryObject, staleness: StalenessResult): RevalidationPrompt | null {
  if (!staleness.isStale) {
    return null;
  }

  let suggestedAction: RevalidationPrompt['suggestedAction'] = 'verify';
  let priority = 1;

  // Determine suggested action based on reasons
  const hasDeletedFile = staleness.reasons.some(r => r.includes('deleted'));
  const hasChangedFile = staleness.reasons.some(r => r.includes('changed'));
  const hasOldVerification = staleness.reasons.some(r => r.includes('Never verified'));

  if (hasDeletedFile) {
    suggestedAction = 'retire';
    priority = 3; // Highest priority - file is gone
  } else if (hasChangedFile) {
    suggestedAction = 'verify';
    priority = 2; // Medium priority - might still be valid
  } else if (hasOldVerification) {
    suggestedAction = 'verify';
    priority = 1; // Lower priority - just needs verification
  }

  // Boost priority for constraints and decisions
  if (memory.objectType === 'constraint') {
    priority += 1;
  } else if (memory.objectType === 'decision') {
    priority += 0.5;
  }

  return {
    memory,
    reasons: staleness.reasons,
    suggestedAction,
    priority,
  };
}

/**
 * Format revalidation prompts for display
 */
export function formatPrompts(prompts: RevalidationPrompt[]): string {
  if (prompts.length === 0) {
    return '';
  }

  const lines: string[] = [
    '⚠️  NEEDS REVALIDATION:',
    '',
  ];

  for (const prompt of prompts) {
    const actionIcon = {
      verify: '🔍',
      update: '✏️',
      retire: '🗑️',
    }[prompt.suggestedAction];

    const shortId = prompt.memory.id.substring(0, 8);
    const content = prompt.memory.content.length > 50 
      ? prompt.memory.content.substring(0, 47) + '...'
      : prompt.memory.content;

    lines.push(`  ${actionIcon} "${content}"`);
    
    for (const reason of prompt.reasons) {
      lines.push(`     Reason: ${reason}`);
    }
    
    lines.push(`     Action: alex ${prompt.suggestedAction} ${shortId}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format prompts as YAML for context pack
 */
export function formatPromptsYaml(prompts: RevalidationPrompt[]): string {
  if (prompts.length === 0) {
    return '';
  }

  const lines: string[] = [
    '# ⚠️ Memories needing revalidation',
    'needs_revalidation:',
  ];

  for (const prompt of prompts) {
    const shortId = prompt.memory.id.substring(0, 8);
    lines.push(`  - id: ${shortId}`);
    lines.push(`    content: "${escapeYaml(prompt.memory.content)}"`);
    lines.push(`    action: ${prompt.suggestedAction}`);
    lines.push(`    reasons:`);
    for (const reason of prompt.reasons) {
      lines.push(`      - "${escapeYaml(reason)}"`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
