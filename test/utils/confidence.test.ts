import { describe, expect, test } from 'bun:test';
import {
  calculateConfidenceTier,
  getConfidenceBoost,
  getConfidenceEmoji,
} from '../../src/utils/confidence.ts';

describe('Confidence Tier Calculation', () => {
  test('grounded: has code refs + approved', () => {
    const tier = calculateConfidenceTier({
      codeRefs: [{ type: 'file', path: 'test.ts', verifiedAtCommit: 'abc123' }],
      reviewStatus: 'approved',
      lastVerifiedAt: new Date(),
    });
    expect(tier).toBe('grounded');
  });

  test('observed: has code refs but no recent verification', () => {
    // Code refs without recent verification = observed (not grounded)
    const tier = calculateConfidenceTier({
      codeRefs: [{ type: 'file', path: 'test.ts' }],
      reviewStatus: 'approved',
    });
    expect(tier).toBe('observed');
  });

  test('observed: has event evidence', () => {
    const tier = calculateConfidenceTier({
      evidenceEventIds: ['event1', 'event2'],
      reviewStatus: 'pending',
    });
    expect(tier).toBe('observed');
  });

  test('observed: approved without code refs', () => {
    const tier = calculateConfidenceTier({
      reviewStatus: 'approved',
    });
    expect(tier).toBe('observed');
  });

  test('inferred: pending review', () => {
    const tier = calculateConfidenceTier({
      reviewStatus: 'pending',
    });
    expect(tier).toBe('inferred');
  });

  test('hypothesis: no evidence', () => {
    const tier = calculateConfidenceTier({
      reviewStatus: 'rejected',
    });
    expect(tier).toBe('hypothesis');
  });

  test('grounded: has code refs + recent verification (status not considered)', () => {
    // Status is separate from confidence tier calculation
    // Confidence tier is about evidence quality, not staleness
    const tier = calculateConfidenceTier({
      codeRefs: [{ type: 'file', path: 'test.ts', verifiedAtCommit: 'abc123' }],
      reviewStatus: 'approved',
      lastVerifiedAt: new Date(),
    });
    expect(tier).toBe('grounded');
  });
});

describe('Confidence Boost', () => {
  test('grounded has highest boost', () => {
    expect(getConfidenceBoost('grounded')).toBe(2.0);
  });

  test('observed has medium boost', () => {
    expect(getConfidenceBoost('observed')).toBe(1.5);
  });

  test('inferred has default boost', () => {
    expect(getConfidenceBoost('inferred')).toBe(1.0);
  });

  test('hypothesis has lowest boost', () => {
    expect(getConfidenceBoost('hypothesis')).toBe(0.5);
  });
});

describe('Confidence Emoji', () => {
  test('returns correct emojis', () => {
    expect(getConfidenceEmoji('grounded')).toBe('✅');
    expect(getConfidenceEmoji('observed')).toBe('👁️');
    expect(getConfidenceEmoji('inferred')).toBe('🤖');
    expect(getConfidenceEmoji('hypothesis')).toBe('💭');
  });
});
