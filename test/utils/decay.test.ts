import { describe, expect, test } from 'bun:test';
import {
  calculateDecayedStrength,
  calculateEffectiveScore,
  calculateReinforcedStrength,
  daysSince,
  isArchivable,
} from '../../src/utils/decay.ts';

describe('decay utilities', () => {
  describe('daysSince', () => {
    test('returns 0 for today', () => {
      const now = new Date();
      const days = daysSince(now);
      expect(days).toBeLessThan(1);
      expect(days).toBeGreaterThanOrEqual(0);
    });

    test('returns correct days for past date', () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const days = daysSince(weekAgo);
      expect(days).toBeGreaterThanOrEqual(6.9);
      expect(days).toBeLessThan(7.1);
    });
  });

  describe('calculateDecayedStrength', () => {
    test('returns full strength for recently accessed memory', () => {
      const now = new Date();
      const strength = calculateDecayedStrength(1.0, now, now);
      expect(strength).toBeCloseTo(1.0, 1);
    });

    test('decays strength over time', () => {
      const now = new Date();
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const strength = calculateDecayedStrength(1.0, twoWeeksAgo, twoWeeksAgo);

      // With default decay rate 0.05, after 14 days: e^(-0.05 * 14) ≈ 0.497
      expect(strength).toBeGreaterThan(0.4);
      expect(strength).toBeLessThan(0.6);
    });

    test('never goes below minimum strength', () => {
      const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const strength = calculateDecayedStrength(1.0, veryOldDate, veryOldDate);

      expect(strength).toBeGreaterThanOrEqual(0.01);
    });

    test('uses createdAt when lastAccessed is undefined', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const strength = calculateDecayedStrength(1.0, undefined, twoWeeksAgo);

      expect(strength).toBeGreaterThan(0.4);
      expect(strength).toBeLessThan(0.6);
    });
  });

  describe('calculateReinforcedStrength', () => {
    test('boosts strength on access', () => {
      const newStrength = calculateReinforcedStrength(0.5);
      expect(newStrength).toBeGreaterThan(0.5);
    });

    test('caps strength at 1.0', () => {
      const newStrength = calculateReinforcedStrength(0.95);
      expect(newStrength).toBe(1.0);
    });

    test('uses custom boost value', () => {
      const newStrength = calculateReinforcedStrength(0.5, 0.3);
      expect(newStrength).toBe(0.8);
    });
  });

  describe('calculateEffectiveScore', () => {
    test('neutral outcome has no effect', () => {
      // At neutral (0.5), multiplier = 1.0
      const score = calculateEffectiveScore(1.0, 1.0, 0.5);
      expect(score).toBe(1.0);
    });

    test('helpful outcome boosts score', () => {
      // At helpful (1.0), multiplier = 1.5
      const score = calculateEffectiveScore(1.0, 1.0, 1.0);
      expect(score).toBe(1.5);
    });

    test('unhelpful outcome reduces score', () => {
      // At unhelpful (0.0), multiplier = 0.5
      const score = calculateEffectiveScore(1.0, 1.0, 0.0);
      expect(score).toBe(0.5);
    });

    test('combines base score, strength, and outcome', () => {
      const score = calculateEffectiveScore(0.8, 0.5, 0.75);
      // 0.8 * 0.5 * (0.5 + 0.75) = 0.8 * 0.5 * 1.25 = 0.5
      expect(score).toBeCloseTo(0.5, 2);
    });
  });

  describe('isArchivable', () => {
    test('returns true for low strength', () => {
      expect(isArchivable(0.05)).toBe(true);
    });

    test('returns false for normal strength', () => {
      expect(isArchivable(0.5)).toBe(false);
    });

    test('uses custom threshold', () => {
      expect(isArchivable(0.15, 0.2)).toBe(true);
      expect(isArchivable(0.25, 0.2)).toBe(false);
    });
  });
});
