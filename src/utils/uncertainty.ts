/**
 * Uncertainty Detection - detect when agent needs more context
 * 
 * Signals:
 * - In response: "not sure", "might be", "I think"
 * - In query: exploratory patterns
 */

import type { ContextLevel } from '../retriever/progressive.ts';

/** Phrases indicating uncertainty in responses */
const UNCERTAINTY_PHRASES = [
  'not sure',
  'not certain',
  "don't know",
  "i don't know",
  'might be',
  'could be',
  'possibly',
  'perhaps',
  'maybe',
  'i think',
  'i believe',
  'probably',
  'unclear',
  'unsure',
  'not confident',
  'hard to say',
  'difficult to determine',
  'would need to check',
  'need more information',
  'need more context',
];

/** Patterns indicating exploratory queries */
const EXPLORATORY_PATTERNS = [
  /^how\s+(do|does|can|should|would)/i,
  /^what\s+(is|are|was|were|does|do)/i,
  /^why\s+(is|are|do|does|did|would)/i,
  /^when\s+(should|do|does|did)/i,
  /^where\s+(is|are|do|does|should)/i,
  /^which\s+(is|are|should|would)/i,
  /explain/i,
  /tell me about/i,
  /describe/i,
  /walk me through/i,
];

/** Patterns indicating complex queries needing deep context */
const COMPLEXITY_PATTERNS = [
  /architecture/i,
  /design\s+(pattern|decision)/i,
  /trade-?off/i,
  /comparison/i,
  /difference\s+between/i,
  /history\s+of/i,
  /evolution/i,
  /all\s+(the|of)/i,
  /everything\s+about/i,
  /comprehensive/i,
  /complete\s+(overview|picture|understanding)/i,
];

/** Patterns indicating simple queries needing minimal context */
const SIMPLE_PATTERNS = [
  /^is\s+\w+\s+(still|valid|correct|true)/i,
  /^should\s+I\s+use/i,
  /^can\s+I/i,
  /status/i,
  /check/i,
  /verify/i,
  /confirm/i,
];

export interface UncertaintyAnalysis {
  /** Is uncertainty detected? */
  isUncertain: boolean;
  /** Confidence in the assessment (0-1) */
  confidence: number;
  /** Phrases that triggered detection */
  triggers: string[];
  /** Suggested action */
  suggestion: string;
}

/**
 * Detect uncertainty in text (usually agent's response)
 */
export function detectUncertainty(text: string): UncertaintyAnalysis {
  const lowerText = text.toLowerCase();
  const triggers: string[] = [];
  
  for (const phrase of UNCERTAINTY_PHRASES) {
    if (lowerText.includes(phrase)) {
      triggers.push(phrase);
    }
  }
  
  const isUncertain = triggers.length > 0;
  const confidence = Math.min(triggers.length * 0.3, 1);
  
  let suggestion = '';
  if (isUncertain) {
    if (triggers.length >= 3) {
      suggestion = 'Consider upgrading to deep context level';
    } else if (triggers.length >= 1) {
      suggestion = 'Consider upgrading to task context level';
    }
  }
  
  return {
    isUncertain,
    confidence,
    triggers,
    suggestion,
  };
}

/**
 * Analyze query to determine if it's exploratory
 */
export function isExploratoryQuery(query: string): boolean {
  return EXPLORATORY_PATTERNS.some(pattern => pattern.test(query));
}

/**
 * Analyze query to determine if it's complex
 */
export function isComplexQuery(query: string): boolean {
  return COMPLEXITY_PATTERNS.some(pattern => pattern.test(query));
}

/**
 * Analyze query to determine if it's simple
 */
export function isSimpleQuery(query: string): boolean {
  return SIMPLE_PATTERNS.some(pattern => pattern.test(query));
}

/**
 * Suggest context level based on query analysis
 */
export function suggestContextLevel(query: string): ContextLevel {
  // Simple queries need minimal context
  if (isSimpleQuery(query)) {
    return 'minimal';
  }
  
  // Complex queries need deep context
  if (isComplexQuery(query)) {
    return 'deep';
  }
  
  // Exploratory queries need task context
  if (isExploratoryQuery(query)) {
    return 'task';
  }
  
  // Default to task
  return 'task';
}

/**
 * Suggest whether to upgrade context level based on uncertainty
 */
export function shouldUpgradeContext(
  currentLevel: ContextLevel, 
  responseText: string
): { upgrade: boolean; toLevel: ContextLevel; reason: string } {
  const analysis = detectUncertainty(responseText);
  
  if (!analysis.isUncertain) {
    return { upgrade: false, toLevel: currentLevel, reason: 'No uncertainty detected' };
  }
  
  const levels: ContextLevel[] = ['minimal', 'task', 'deep'];
  const currentIndex = levels.indexOf(currentLevel);
  
  // Already at max level
  if (currentIndex >= levels.length - 1) {
    return { 
      upgrade: false, 
      toLevel: currentLevel, 
      reason: 'Already at maximum context level' 
    };
  }
  
  // Determine upgrade size based on uncertainty level
  let upgradeBy = 1;
  if (analysis.triggers.length >= 3) {
    upgradeBy = 2; // Jump to deep if very uncertain
  }
  
  const newIndex = Math.min(currentIndex + upgradeBy, levels.length - 1);
  const toLevel = levels[newIndex];
  
  return {
    upgrade: true,
    toLevel,
    reason: `Uncertainty detected: ${analysis.triggers.slice(0, 3).join(', ')}`,
  };
}

/**
 * Format uncertainty analysis for display
 */
export function formatUncertaintyAnalysis(analysis: UncertaintyAnalysis): string {
  if (!analysis.isUncertain) {
    return '✓ No uncertainty detected';
  }
  
  const lines = [
    `⚠️  Uncertainty detected (${Math.round(analysis.confidence * 100)}% confidence)`,
    `   Triggers: ${analysis.triggers.join(', ')}`,
  ];
  
  if (analysis.suggestion) {
    lines.push(`   ${analysis.suggestion}`);
  }
  
  return lines.join('\n');
}
