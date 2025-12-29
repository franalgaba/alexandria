/**
 * Retrieval router - routes queries to different retrieval strategies
 */

import type { ConfidenceTier, ObjectType } from '../types/memory-objects.ts';
import type { QueryIntent } from './intent.ts';
import { classifyIntent } from './intent.ts';

export type RetrievalSource = 'memories' | 'events' | 'code';

export interface RetrievalPlan {
  /** Detected query intent */
  intent: QueryIntent;
  
  /** Which stores to query */
  sources: RetrievalSource[];
  
  /** Memory types to prioritize (empty = all types) */
  typeFilters: ObjectType[];
  
  /** Token budget for results */
  tokenBudget: number;
  
  /** Boost factors for ranking */
  boosts: {
    /** Boost for grounded (code-linked) memories */
    grounded?: number;
    /** Boost for memories with code refs */
    hasCodeRefs?: number;
    /** Boost for recently verified memories */
    recentlyVerified?: number;
    /** Boost for specific types */
    typeBoosts?: Partial<Record<ObjectType, number>>;
  };
  
  /** Minimum confidence tier required */
  minConfidence?: ConfidenceTier;
  
  /** Include stale memories? */
  includeStale?: boolean;
}

const RETRIEVAL_PLANS: Record<QueryIntent, Omit<RetrievalPlan, 'intent'>> = {
  debugging: {
    sources: ['memories', 'events'],  // Include events for stack traces, errors
    typeFilters: ['failed_attempt', 'known_fix', 'constraint'],
    tokenBudget: 1000,
    boosts: {
      grounded: 1.5,
      hasCodeRefs: 1.3,
      typeBoosts: {
        failed_attempt: 40,
        known_fix: 35,
      },
    },
    includeStale: false,
  },
  
  conventions: {
    sources: ['memories'],
    typeFilters: ['convention', 'preference', 'constraint'],
    tokenBudget: 500,
    boosts: {
      typeBoosts: {
        convention: 30,
        constraint: 25,
        preference: 20,
      },
    },
    includeStale: false,
  },
  
  implementation: {
    sources: ['memories', 'code'],  // Include code for examples
    typeFilters: ['decision', 'convention', 'known_fix', 'constraint'],
    tokenBudget: 800,
    boosts: {
      grounded: 1.3,
      hasCodeRefs: 1.4,
      typeBoosts: {
        decision: 25,
        known_fix: 20,
      },
    },
    includeStale: false,
  },
  
  architecture: {
    sources: ['memories'],
    typeFilters: ['decision', 'convention'],
    tokenBudget: 600,
    boosts: {
      typeBoosts: {
        decision: 30,
      },
    },
    includeStale: false,
  },
  
  history: {
    sources: ['memories', 'events'],  // Include events for historical context
    typeFilters: ['decision'],
    tokenBudget: 500,
    boosts: {
      // For history, we care less about recency
      recentlyVerified: 0.5,
      typeBoosts: {
        decision: 35,
      },
    },
    includeStale: true, // Include old decisions for historical context
  },
  
  validation: {
    sources: ['memories', 'code'],  // Include code to verify against
    typeFilters: [],
    tokenBudget: 300,
    boosts: {
      grounded: 2.0,
      hasCodeRefs: 1.5,
      recentlyVerified: 1.5,
    },
    minConfidence: 'grounded',
    includeStale: false,
  },
  
  general: {
    sources: ['memories'],
    typeFilters: [],
    tokenBudget: 800,
    boosts: {
      grounded: 1.2,
    },
    includeStale: false,
  },
};

export class RetrievalRouter {
  /**
   * Create a retrieval plan for a query
   */
  route(query: string): RetrievalPlan {
    const intent = classifyIntent(query);
    const plan = RETRIEVAL_PLANS[intent];
    
    return {
      intent,
      ...plan,
    };
  }
  
  /**
   * Get plan for a specific intent
   */
  getPlanForIntent(intent: QueryIntent): RetrievalPlan {
    return {
      intent,
      ...RETRIEVAL_PLANS[intent],
    };
  }
  
  /**
   * Merge a custom plan with defaults
   */
  customPlan(
    intent: QueryIntent,
    overrides: Partial<Omit<RetrievalPlan, 'intent'>>
  ): RetrievalPlan {
    const base = RETRIEVAL_PLANS[intent];
    return {
      intent,
      typeFilters: overrides.typeFilters ?? base.typeFilters,
      tokenBudget: overrides.tokenBudget ?? base.tokenBudget,
      boosts: {
        ...base.boosts,
        ...overrides.boosts,
      },
      minConfidence: overrides.minConfidence ?? base.minConfidence,
      includeStale: overrides.includeStale ?? base.includeStale,
    };
  }
}

/**
 * Apply retrieval plan boosts to reranker options
 */
export function planToRerankerBoosts(plan: RetrievalPlan): Record<string, number> {
  const boosts: Record<string, number> = {};
  
  if (plan.boosts.typeBoosts) {
    for (const [type, boost] of Object.entries(plan.boosts.typeBoosts)) {
      boosts[`type_${type}`] = boost;
    }
  }
  
  if (plan.boosts.grounded) {
    boosts.grounded = plan.boosts.grounded;
  }
  
  if (plan.boosts.hasCodeRefs) {
    boosts.hasCodeRefs = plan.boosts.hasCodeRefs;
  }
  
  if (plan.boosts.recentlyVerified) {
    boosts.recentlyVerified = plan.boosts.recentlyVerified;
  }
  
  return boosts;
}
