/**
 * Memory strength decay calculations (Ebbinghaus-inspired)
 *
 * Strength decays exponentially over time: S(t) = S₀ × e^(-λt)
 * where λ is the decay rate and t is days since last access/reinforcement.
 */

// Default decay rate: ~50% strength after 14 days of no access
const DEFAULT_DECAY_RATE = Number(process.env.ALEXANDRIA_DECAY_RATE) || 0.05;

// Default reinforcement boost when memory is accessed
const DEFAULT_REINFORCE_BOOST = Number(process.env.ALEXANDRIA_REINFORCE_BOOST) || 0.15;

// Minimum strength before memory is considered for archival
const MIN_STRENGTH = 0.01;

/**
 * Calculate current strength based on decay since last access
 */
export function calculateDecayedStrength(
  baseStrength: number,
  lastAccessedAt: Date | undefined,
  createdAt: Date,
  decayRate = DEFAULT_DECAY_RATE,
): number {
  const referenceDate = lastAccessedAt || createdAt;
  const daysSinceAccess = daysSince(referenceDate);

  // S(t) = S₀ × e^(-λt)
  const decayedStrength = baseStrength * Math.exp(-decayRate * daysSinceAccess);

  return Math.max(MIN_STRENGTH, decayedStrength);
}

/**
 * Calculate reinforced strength after access
 */
export function calculateReinforcedStrength(
  currentStrength: number,
  boost = DEFAULT_REINFORCE_BOOST,
): number {
  return Math.min(1.0, currentStrength + boost);
}

/**
 * Calculate effective score combining base score, strength, and outcome
 */
export function calculateEffectiveScore(
  baseScore: number,
  strength: number,
  outcomeScore: number,
): number {
  // outcome_score acts as a multiplier (0.5 = neutral, 1.0 = very helpful)
  // Formula: baseScore × strength × (0.5 + outcomeScore)
  // At neutral (0.5): multiplier = 1.0
  // At very helpful (1.0): multiplier = 1.5
  // At unhelpful (0.0): multiplier = 0.5
  return baseScore * strength * (0.5 + outcomeScore);
}

/**
 * Calculate days since a reference date
 */
export function daysSince(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

/**
 * Check if memory strength is below archival threshold
 */
export function isArchivable(strength: number, threshold = 0.1): boolean {
  return strength < threshold;
}

/**
 * Get decay rate from environment or default
 */
export function getDecayRate(): number {
  return DEFAULT_DECAY_RATE;
}

/**
 * Get reinforcement boost from environment or default
 */
export function getReinforcementBoost(): number {
  return DEFAULT_REINFORCE_BOOST;
}
