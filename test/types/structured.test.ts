import { describe, expect, test } from 'bun:test';
import {
  isDecisionStructured,
  isContractStructured,
  parseStructured,
  serializeStructured,
  formatDecision,
  formatContract,
  type DecisionStructured,
  type ContractStructured,
} from '../../src/types/structured.ts';

describe('Type Guards', () => {
  test('isDecisionStructured', () => {
    expect(isDecisionStructured({ decision: 'Use SQLite' })).toBe(true);
    expect(isDecisionStructured({ name: 'API' })).toBe(false);
    expect(isDecisionStructured(null)).toBe(false);
  });

  test('isContractStructured', () => {
    expect(isContractStructured({ name: 'API', contractType: 'api' })).toBe(true);
    expect(isContractStructured({ decision: 'test' })).toBe(false);
    expect(isContractStructured(null)).toBe(false);
  });

  
});

describe('Serialization', () => {
  test('parseStructured handles valid JSON', () => {
    const json = '{"decision": "Use SQLite"}';
    const result = parseStructured(json);
    expect(result).toEqual({ decision: 'Use SQLite' });
  });

  test('parseStructured handles invalid JSON', () => {
    expect(parseStructured('not json')).toBeUndefined();
    expect(parseStructured(null)).toBeUndefined();
    expect(parseStructured(undefined)).toBeUndefined();
  });

  test('serializeStructured', () => {
    const data: DecisionStructured = { decision: 'Use SQLite' };
    const result = serializeStructured(data);
    expect(result).toBe('{"decision":"Use SQLite"}');
  });

  test('serializeStructured handles undefined', () => {
    expect(serializeStructured(undefined)).toBeNull();
  });
});

describe('Formatting', () => {
  test('formatDecision with all fields', () => {
    const decision: DecisionStructured = {
      decision: 'Use SQLite',
      alternatives: ['PostgreSQL', 'MongoDB'],
      rationale: 'Simpler deployment',
      tradeoffs: ['Limited concurrent writes'],
      decidedBy: 'team',
    };

    const result = formatDecision(decision);
    expect(result).toContain('Decision: Use SQLite');
    expect(result).toContain('Alternatives: PostgreSQL, MongoDB');
    expect(result).toContain('Rationale: Simpler deployment');
    expect(result).toContain('Tradeoffs: Limited concurrent writes');
    expect(result).toContain('Decided by: team');
  });

  test('formatDecision with minimal fields', () => {
    const decision: DecisionStructured = { decision: 'Use SQLite' };
    const result = formatDecision(decision);
    expect(result).toBe('Decision: Use SQLite');
  });

  test('formatContract', () => {
    const contract: ContractStructured = {
      name: 'User API',
      contractType: 'api',
      version: '1.0.0',
      definition: 'GET /users',
    };

    const result = formatContract(contract);
    expect(result).toContain('Contract: User API');
    expect(result).toContain('Type: api');
    expect(result).toContain('Version: 1.0.0');
    expect(result).toContain('Definition:');
    expect(result).toContain('GET /users');
  });

  
});
