import { describe, expect, test } from 'bun:test';
import {
  detectUncertainty,
  isExploratoryQuery,
  isComplexQuery,
  isSimpleQuery,
  suggestContextLevel,
  shouldUpgradeContext,
  formatUncertaintyAnalysis,
} from '../../src/utils/uncertainty.ts';

describe('detectUncertainty', () => {
  test('detects "not sure" phrases', () => {
    const result = detectUncertainty("I'm not sure about this");
    
    expect(result.isUncertain).toBe(true);
    expect(result.triggers).toContain('not sure');
  });

  test('detects "might be" phrases', () => {
    const result = detectUncertainty('This might be the correct approach');
    
    expect(result.isUncertain).toBe(true);
    expect(result.triggers).toContain('might be');
  });

  test('detects "I think" phrases', () => {
    const result = detectUncertainty('I think this is how it works');
    
    expect(result.isUncertain).toBe(true);
    expect(result.triggers).toContain('i think');
  });

  test('detects multiple uncertainty signals', () => {
    const result = detectUncertainty("I'm not sure, but I think it might be this");
    
    expect(result.isUncertain).toBe(true);
    expect(result.triggers.length).toBeGreaterThanOrEqual(2);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  test('returns false for confident text', () => {
    const result = detectUncertainty('The function returns a boolean value');
    
    expect(result.isUncertain).toBe(false);
    expect(result.triggers.length).toBe(0);
  });
});

describe('Query Analysis', () => {
  describe('isExploratoryQuery', () => {
    test('detects "how does" questions', () => {
      expect(isExploratoryQuery('how does the auth system work')).toBe(true);
    });

    test('detects "what is" questions', () => {
      expect(isExploratoryQuery('what is the purpose of this function')).toBe(true);
    });

    test('detects "why" questions', () => {
      expect(isExploratoryQuery('why is this implemented this way')).toBe(true);
    });

    test('returns false for non-exploratory', () => {
      expect(isExploratoryQuery('fix the bug')).toBe(false);
    });
  });

  describe('isComplexQuery', () => {
    test('detects architecture questions', () => {
      expect(isComplexQuery('what is the system architecture')).toBe(true);
    });

    test('detects design pattern questions', () => {
      expect(isComplexQuery('what design pattern should I use')).toBe(true);
    });

    test('detects comprehensive requests', () => {
      expect(isComplexQuery('give me a comprehensive overview')).toBe(true);
    });

    test('returns false for simple queries', () => {
      expect(isComplexQuery('fix the typo')).toBe(false);
    });
  });

  describe('isSimpleQuery', () => {
    test('detects validation questions', () => {
      expect(isSimpleQuery('is this still valid')).toBe(true);
    });

    test('detects status checks', () => {
      expect(isSimpleQuery('what is the status')).toBe(true);
    });

    test('detects verification requests', () => {
      expect(isSimpleQuery('verify this is correct')).toBe(true);
    });

    test('returns false for complex queries', () => {
      expect(isSimpleQuery('explain the entire architecture')).toBe(false);
    });
  });
});

describe('suggestContextLevel', () => {
  test('returns minimal for simple queries', () => {
    expect(suggestContextLevel('is this still valid')).toBe('minimal');
    expect(suggestContextLevel('check status')).toBe('minimal');
  });

  test('returns deep for complex queries', () => {
    expect(suggestContextLevel('what is the architecture')).toBe('deep');
    expect(suggestContextLevel('comprehensive overview')).toBe('deep');
  });

  test('returns task for exploratory queries', () => {
    expect(suggestContextLevel('how does authentication work')).toBe('task');
    expect(suggestContextLevel('what is this function for')).toBe('task');
  });

  test('returns task as default', () => {
    expect(suggestContextLevel('random text')).toBe('task');
  });
});

describe('shouldUpgradeContext', () => {
  test('suggests upgrade when uncertainty detected', () => {
    const result = shouldUpgradeContext('minimal', "I'm not sure about this");
    
    expect(result.upgrade).toBe(true);
    expect(result.toLevel).toBe('task');
    expect(result.reason).toContain('not sure');
  });

  test('suggests larger upgrade for high uncertainty', () => {
    const result = shouldUpgradeContext(
      'minimal', 
      "I'm not sure, I think it might be, but I don't know"
    );
    
    expect(result.upgrade).toBe(true);
    expect(result.toLevel).toBe('deep');
  });

  test('returns no upgrade when already at deep', () => {
    const result = shouldUpgradeContext('deep', "I'm not sure");
    
    expect(result.upgrade).toBe(false);
    expect(result.toLevel).toBe('deep');
  });

  test('returns no upgrade when no uncertainty', () => {
    const result = shouldUpgradeContext('minimal', 'This is definitely correct');
    
    expect(result.upgrade).toBe(false);
  });
});

describe('formatUncertaintyAnalysis', () => {
  test('formats uncertain analysis', () => {
    const analysis = detectUncertainty("I'm not sure about this");
    const formatted = formatUncertaintyAnalysis(analysis);
    
    expect(formatted).toContain('Uncertainty detected');
    expect(formatted).toContain('not sure');
  });

  test('formats certain analysis', () => {
    const analysis = detectUncertainty('This is correct');
    const formatted = formatUncertaintyAnalysis(analysis);
    
    expect(formatted).toContain('No uncertainty detected');
  });
});
