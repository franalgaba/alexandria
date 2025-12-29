/**
 * Output formatting utilities
 */

import type { ConfidenceTier, MemoryObject } from '../types/memory-objects.ts';
import type { ContextPack, SearchResult, ProgressiveContextPack, LegacyContextPack } from '../types/retriever.ts';
import { isProgressivePack, isLegacyPack } from '../types/retriever.ts';
import { getConfidenceEmoji } from './confidence.ts';
import { formatPrompts, formatPromptsYaml } from './revalidation.ts';

/**
 * Format a memory object for display
 */
export function formatMemoryObject(obj: MemoryObject, verbose = false): string {
  const typeEmoji = getTypeEmoji(obj.objectType);
  const statusBadge = getStatusBadge(obj.status);
  const confidenceBadge = getConfidenceBadge(obj.confidence);

  let output = `${typeEmoji} [${obj.objectType}] ${statusBadge}\n`;
  output += `   ${obj.content}\n`;

  if (verbose) {
    output += `   ID: ${obj.id}\n`;
    output += `   Confidence: ${confidenceBadge}\n`;
    output += `   Scope: ${obj.scope.type}${obj.scope.path ? ` (${obj.scope.path})` : ''}\n`;
    output += `   Review: ${obj.reviewStatus}\n`;
    if (obj.evidenceExcerpt) {
      output += `   Evidence: ${obj.evidenceExcerpt.substring(0, 100)}...\n`;
    }
    output += `   Created: ${obj.createdAt.toISOString()}\n`;
    output += `   Accessed: ${obj.accessCount} times\n`;
  }

  return output;
}

/**
 * Format search results
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results
    .map((r, i) => {
      const matchBadge = getMatchTypeBadge(r.matchType);
      return `${i + 1}. ${matchBadge} [score: ${r.score.toFixed(3)}]\n${formatMemoryObject(r.object)}`;
    })
    .join('\n');
}

/**
 * Format context pack for injection
 */
export function formatContextPack(
  pack: ContextPack,
  format: 'yaml' | 'json' | 'text' = 'yaml',
): string {
  // Handle progressive pack format
  if (isProgressivePack(pack)) {
    switch (format) {
      case 'json':
        return JSON.stringify(pack, null, 2);
      case 'text':
        return formatProgressivePackText(pack);
      default:
        return formatProgressivePackYaml(pack);
    }
  }
  
  // Legacy format
  switch (format) {
    case 'json':
      return JSON.stringify(pack, null, 2);
    case 'text':
      return formatContextPackText(pack);
    default:
      return formatContextPackYaml(pack);
  }
}

/**
 * Format progressive pack as YAML
 */
function formatProgressivePackYaml(pack: ProgressiveContextPack): string {
  let output = '# Alexandria Context Pack (Progressive)\n\n';
  
  if (pack.metadata) {
    output += `level: ${pack.metadata.level}\n`;
    output += `tokens: ${pack.metadata.tokensUsed}/${pack.metadata.tokenBudget}\n\n`;
  }
  
  // Group by confidence tier
  const grounded = pack.objects.filter(o => o.confidenceTier === 'grounded');
  const observed = pack.objects.filter(o => o.confidenceTier === 'observed');
  const inferred = pack.objects.filter(o => o.confidenceTier === 'inferred');
  const hypothesis = pack.objects.filter(o => o.confidenceTier === 'hypothesis');
  
  if (grounded.length > 0) {
    output += '# ✅ Verified (code-linked)\n';
    output += 'verified:\n';
    for (const obj of grounded) {
      output += `  - type: ${obj.objectType}\n`;
      output += `    content: "${escapeYaml(obj.content)}"\n`;
    }
    output += '\n';
  }
  
  if (observed.length > 0) {
    output += '# 👁️ Observed (approved)\n';
    output += 'observed:\n';
    for (const obj of observed) {
      output += `  - type: ${obj.objectType}\n`;
      output += `    content: "${escapeYaml(obj.content)}"\n`;
    }
    output += '\n';
  }
  
  if (inferred.length > 0) {
    output += '# 🔮 Inferred (pending review)\n';
    output += 'unverified:\n';
    for (const obj of inferred) {
      output += `  - type: ${obj.objectType}\n`;
      output += `    content: "${escapeYaml(obj.content)}"\n`;
    }
    output += '\n';
  }
  
  if (hypothesis.length > 0) {
    output += '# ❓ Hypothesis (low confidence)\n';
    output += 'hypothesis:\n';
    for (const obj of hypothesis) {
      output += `  - type: ${obj.objectType}\n`;
      output += `    content: "${escapeYaml(obj.content)}"\n`;
    }
  }
  
  return output;
}

/**
 * Format progressive pack as text
 */
function formatProgressivePackText(pack: ProgressiveContextPack): string {
  let output = '=== ALEXANDRIA CONTEXT ===\n\n';
  
  if (pack.metadata) {
    output += `Level: ${pack.metadata.level} (~${pack.metadata.tokensUsed} tokens)\n\n`;
  }
  
  // Group by type
  const constraints = pack.objects.filter(o => o.objectType === 'constraint');
  const others = pack.objects.filter(o => o.objectType !== 'constraint');
  
  if (constraints.length > 0) {
    output += '🚫 CONSTRAINTS:\n';
    for (const c of constraints) {
      output += `  • ${c.content}\n`;
    }
    output += '\n';
  }
  
  if (others.length > 0) {
    output += '📝 MEMORIES:\n';
    for (const obj of others) {
      const emoji = getTypeEmoji(obj.objectType);
      const tierEmoji = getConfidenceEmoji(obj.confidenceTier || 'inferred');
      output += `  ${emoji} ${tierEmoji} ${obj.content}\n`;
    }
  }
  
  return output;
}

function formatContextPackYaml(pack: ContextPack): string {
  // Type guard for legacy pack
  if (!isLegacyPack(pack)) {
    return '# Error: Expected legacy context pack format\n';
  }
  
  let output = '# Alexandria Context Pack\n\n';

  // Show revalidation prompts first (most important)
  if (pack.revalidationPrompts && pack.revalidationPrompts.length > 0) {
    output += formatPromptsYaml(pack.revalidationPrompts);
    output += '\n';
  }

  if (pack.previousSession) {
    output += 'previous_session:\n';
    output += `  summary: "${escapeYaml(pack.previousSession.summary)}"\n`;
    if (pack.previousSession.workingFile) {
      output += `  working_file: "${pack.previousSession.workingFile}"\n`;
    }
    if (pack.previousSession.workingTask) {
      output += `  working_task: "${escapeYaml(pack.previousSession.workingTask)}"\n`;
    }
    output += '\n';
  }

  if (pack.constraints.length > 0) {
    output += 'constraints:\n';
    for (const c of pack.constraints) {
      output += `  - type: ${c.objectType}\n`;
      output += `    content: "${escapeYaml(c.content)}"\n`;
      output += `    confidence: ${c.confidence}\n`;
    }
    output += '\n';
  }

  if (pack.relevantObjects.length > 0) {
    output += 'relevant_memories:\n';
    for (const obj of pack.relevantObjects) {
      output += `  - type: ${obj.objectType}\n`;
      output += `    content: "${escapeYaml(obj.content)}"\n`;
      output += `    confidence: ${obj.confidence}\n`;
    }
    output += '\n';
  }

  output += `# Token usage: ${pack.tokenCount}/${pack.tokenBudget}`;
  if (pack.overflowCount > 0) {
    output += ` (${pack.overflowCount} more available)`;
  }

  return output;
}

function formatContextPackText(pack: ContextPack): string {
  // Type guard for legacy pack
  if (!isLegacyPack(pack)) {
    return '=== Error: Expected legacy context pack format ===\n';
  }
  
  let output = '=== Alexandria Context Pack ===\n\n';

  // Show revalidation prompts first (most important)
  if (pack.revalidationPrompts && pack.revalidationPrompts.length > 0) {
    output += formatPrompts(pack.revalidationPrompts);
    output += '\n';
  }

  if (pack.previousSession) {
    output += '📋 Previous Session:\n';
    output += `   ${pack.previousSession.summary}\n`;
    if (pack.previousSession.workingFile) {
      output += `   File: ${pack.previousSession.workingFile}\n`;
    }
    if (pack.previousSession.workingTask) {
      output += `   Task: ${pack.previousSession.workingTask}\n`;
    }
    output += '\n';
  }

  if (pack.constraints.length > 0) {
    output += '🚫 Constraints (always apply):\n';
    for (const c of pack.constraints) {
      output += `   • ${c.content}\n`;
    }
    output += '\n';
  }

  if (pack.relevantObjects.length > 0) {
    // Group by confidence tier
    const grounded = pack.relevantObjects.filter(o => o.confidenceTier === 'grounded');
    const observed = pack.relevantObjects.filter(o => o.confidenceTier === 'observed');
    const other = pack.relevantObjects.filter(o => 
      o.confidenceTier !== 'grounded' && o.confidenceTier !== 'observed'
    );
    
    if (grounded.length > 0) {
      output += '✅ Verified (code-linked):\n';
      for (const obj of grounded) {
        const emoji = getTypeEmoji(obj.objectType);
        const codeRef = obj.codeRefs.length > 0 ? ` - ${obj.codeRefs[0].path}` : '';
        output += `   ${emoji} [${obj.objectType}] ${obj.content}${codeRef}\n`;
      }
      output += '\n';
    }
    
    if (observed.length > 0) {
      output += '👁️ Observed:\n';
      for (const obj of observed) {
        const emoji = getTypeEmoji(obj.objectType);
        output += `   ${emoji} [${obj.objectType}] ${obj.content}\n`;
      }
      output += '\n';
    }
    
    if (other.length > 0) {
      output += '💭 Unverified:\n';
      for (const obj of other) {
        const emoji = getTypeEmoji(obj.objectType);
        const tierEmoji = getConfidenceEmoji(obj.confidenceTier);
        output += `   ${tierEmoji} [${obj.objectType}] ${obj.content}\n`;
      }
      output += '\n';
    }
  }

  output += `📊 Token usage: ${pack.tokenCount}/${pack.tokenBudget}`;
  if (pack.overflowCount > 0) {
    output += ` (${pack.overflowCount} more available)`;
  }

  return output;
}

function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function getTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    decision: '🎯',
    preference: '⭐',
    convention: '📏',
    known_fix: '✅',
    constraint: '🚫',
    failed_attempt: '❌',
    environment: '⚙️',
  };
  return emojis[type] || '📝';
}

function getStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    active: '🟢',
    stale: '🟡',
    superseded: '🔄',
    retired: '⚫',
  };
  return badges[status] || status;
}

function getConfidenceBadge(confidence: string): string {
  const badges: Record<string, string> = {
    certain: '████',
    high: '███░',
    medium: '██░░',
    low: '█░░░',
  };
  return badges[confidence] || confidence;
}

function getMatchTypeBadge(matchType: string): string {
  const badges: Record<string, string> = {
    lexical: '📝 LEX',
    vector: '🧠 VEC',
    hybrid: '🔀 HYB',
  };
  return badges[matchType] || matchType;
}

/**
 * Format a list of memory objects
 */
export function formatList(objects: MemoryObject[]): string {
  if (objects.length === 0) {
    return 'No memory objects found.';
  }

  return objects.map((obj) => formatMemoryObject(obj)).join('\n');
}
