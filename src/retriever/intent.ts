/**
 * Query intent classification
 * 
 * Classifies user queries into intents to route retrieval strategies.
 */

export type QueryIntent =
  | 'debugging'      // errors, failures, bugs, fixes
  | 'conventions'    // how we do things, naming, style
  | 'implementation' // how to build, add, create
  | 'architecture'   // structure, design, patterns
  | 'history'        // what we decided, past choices
  | 'validation'     // is X still true, verify
  | 'general';       // fallback

interface IntentPattern {
  intent: QueryIntent;
  patterns: RegExp[];
  keywords: string[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'debugging',
    patterns: [
      /why\s+(is|does|did|are|do)\s+.*\s*(fail|error|crash|break|bug)/i,
      /how\s+to\s+fix/i,
      /not\s+working/i,
      /getting\s+(an?\s+)?error/i,
      /what('s|s)?\s+wrong/i,
      /debug(ging)?/i,
      /troubleshoot/i,
    ],
    keywords: [
      'error', 'fail', 'failed', 'failing', 'failure',
      'bug', 'crash', 'broken', 'break', 'issue',
      'problem', 'wrong', 'fix', 'debug', 'troubleshoot',
      'exception', 'stack trace', 'stacktrace',
    ],
  },
  {
    intent: 'conventions',
    patterns: [
      /how\s+(do|should)\s+we\s+(name|format|style|organize)/i,
      /what('s|s)?\s+(the|our)\s+(naming|style|convention)/i,
      /convention(s)?\s+for/i,
      /best\s+practice/i,
      /coding\s+style/i,
      /how\s+are\s+.*\s+named/i,
    ],
    keywords: [
      'convention', 'conventions', 'style', 'naming',
      'format', 'formatting', 'standard', 'standards',
      'best practice', 'practices', 'guideline', 'guidelines',
      'how do we', 'how should we',
    ],
  },
  {
    intent: 'implementation',
    patterns: [
      /how\s+(do\s+i|to|can\s+i)\s+(add|create|build|implement|make)/i,
      /implement(ing)?\s+/i,
      /add(ing)?\s+(a|an|the)\s+/i,
      /create\s+(a|an|the)\s+/i,
      /build(ing)?\s+/i,
      /write\s+(a|an|the)\s+/i,
    ],
    keywords: [
      'implement', 'implementation', 'add', 'adding',
      'create', 'creating', 'build', 'building',
      'write', 'writing', 'make', 'making',
      'how do i', 'how to', 'how can i',
    ],
  },
  {
    intent: 'architecture',
    patterns: [
      /what('s|s)?\s+(the\s+)?(structure|architecture|design)/i,
      /how\s+is\s+.*\s+(structured|organized|designed)/i,
      /architecture\s+of/i,
      /design\s+pattern/i,
      /system\s+design/i,
    ],
    keywords: [
      'architecture', 'structure', 'design', 'pattern',
      'organized', 'layout', 'diagram', 'overview',
      'high level', 'high-level', 'system',
    ],
  },
  {
    intent: 'history',
    patterns: [
      /what\s+did\s+we\s+decide/i,
      /why\s+did\s+we\s+(choose|decide|pick|use)/i,
      /when\s+did\s+we/i,
      /history\s+of/i,
      /previous(ly)?/i,
      /what\s+was\s+the\s+decision/i,
    ],
    keywords: [
      'decided', 'decision', 'chose', 'chosen', 'picked',
      'history', 'previous', 'previously', 'past',
      'why did we', 'what did we', 'when did we',
      'rationale', 'reasoning',
    ],
  },
  {
    intent: 'validation',
    patterns: [
      /is\s+(this|that|it)\s+still\s+(true|valid|correct)/i,
      /still\s+(true|valid|correct|accurate)/i,
      /verify\s+(that|if|whether)/i,
      /confirm\s+(that|if|whether)/i,
      /check\s+if/i,
      /is\s+.*\s+still\s+/i,
    ],
    keywords: [
      'still true', 'still valid', 'still correct',
      'verify', 'validate', 'confirm', 'check',
      'accurate', 'up to date', 'up-to-date', 'current',
    ],
  },
];

/**
 * Classify a query into an intent
 */
export function classifyIntent(query: string): QueryIntent {
  const lowerQuery = query.toLowerCase();
  
  // Score each intent
  const scores: Record<QueryIntent, number> = {
    debugging: 0,
    conventions: 0,
    implementation: 0,
    architecture: 0,
    history: 0,
    validation: 0,
    general: 0,
  };
  
  for (const { intent, patterns, keywords } of INTENT_PATTERNS) {
    // Check patterns (higher weight)
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        scores[intent] += 3;
      }
    }
    
    // Check keywords (lower weight)
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        scores[intent] += 1;
      }
    }
  }
  
  // Find highest scoring intent
  let maxScore = 0;
  let maxIntent: QueryIntent = 'general';
  
  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxIntent = intent as QueryIntent;
    }
  }
  
  // Only return specific intent if score is above threshold
  return maxScore >= 2 ? maxIntent : 'general';
}

/**
 * Get a human-readable description of an intent
 */
export function getIntentDescription(intent: QueryIntent): string {
  const descriptions: Record<QueryIntent, string> = {
    debugging: 'Looking for error fixes and failure patterns',
    conventions: 'Looking for coding standards and conventions',
    implementation: 'Looking for implementation guidance',
    architecture: 'Looking for system design information',
    history: 'Looking for past decisions and rationale',
    validation: 'Verifying current accuracy of information',
    general: 'General search',
  };
  return descriptions[intent];
}

/**
 * Get emoji for intent display
 */
export function getIntentEmoji(intent: QueryIntent): string {
  const emojis: Record<QueryIntent, string> = {
    debugging: '🐛',
    conventions: '📏',
    implementation: '🔨',
    architecture: '🏗️',
    history: '📜',
    validation: '✅',
    general: '🔍',
  };
  return emojis[intent];
}
