import { describe, expect, test } from 'bun:test';
import { RetrievalRouter } from '../../src/retriever/router.ts';

describe('RetrievalRouter', () => {
  const router = new RetrievalRouter();

  test('routes debugging queries correctly', () => {
    const plan = router.route('why is this failing?');
    
    expect(plan.intent).toBe('debugging');
    expect(plan.sources).toContain('memories');
    expect(plan.sources).toContain('events');
    expect(plan.typeFilters).toContain('failed_attempt');
    expect(plan.typeFilters).toContain('known_fix');
    expect(plan.tokenBudget).toBe(1000);
    expect(plan.boosts.grounded).toBe(1.5);
  });

  test('routes conventions queries correctly', () => {
    const plan = router.route('how do we name files?');
    
    expect(plan.intent).toBe('conventions');
    expect(plan.typeFilters).toContain('convention');
    expect(plan.typeFilters).toContain('preference');
    expect(plan.tokenBudget).toBe(500);
  });

  test('routes implementation queries correctly', () => {
    const plan = router.route('how do I add a new endpoint?');
    
    expect(plan.intent).toBe('implementation');
    expect(plan.sources).toContain('memories');
    expect(plan.sources).toContain('code');
    expect(plan.typeFilters).toContain('decision');
    expect(plan.typeFilters).toContain('convention');
    expect(plan.boosts.hasCodeRefs).toBe(1.4);
  });

  test('routes history queries with includeStale', () => {
    const plan = router.route('what did we decide about the API?');
    
    expect(plan.intent).toBe('history');
    expect(plan.includeStale).toBe(true);
  });

  test('routes validation queries with minConfidence', () => {
    const plan = router.route('is this still true?');
    
    expect(plan.intent).toBe('validation');
    expect(plan.minConfidence).toBe('grounded');
    expect(plan.boosts.grounded).toBe(2.0);
  });

  test('routes general queries with defaults', () => {
    const plan = router.route('hello');
    
    expect(plan.intent).toBe('general');
    expect(plan.typeFilters).toEqual([]);
    expect(plan.tokenBudget).toBe(800);
  });

  test('getPlanForIntent returns correct plan', () => {
    const plan = router.getPlanForIntent('debugging');
    
    expect(plan.intent).toBe('debugging');
    expect(plan.typeFilters).toContain('failed_attempt');
  });

  test('customPlan merges overrides', () => {
    const plan = router.customPlan('debugging', {
      tokenBudget: 2000,
      boosts: { grounded: 3.0 },
    });
    
    expect(plan.intent).toBe('debugging');
    expect(plan.tokenBudget).toBe(2000);
    expect(plan.boosts.grounded).toBe(3.0);
    // Original type filters preserved
    expect(plan.typeFilters).toContain('failed_attempt');
  });
});
