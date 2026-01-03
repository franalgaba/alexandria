import { describe, expect, test } from 'bun:test';
import {
  classifyIntent,
  getIntentDescription,
  getIntentEmoji,
} from '../../src/retriever/intent.ts';

describe('Intent Classifier', () => {
  describe('debugging intent', () => {
    test('detects error queries', () => {
      expect(classifyIntent('the API is failing with an error')).toBe('debugging');
      expect(classifyIntent('getting an error when running tests')).toBe('debugging');
      expect(classifyIntent('debug this bug')).toBe('debugging');
      expect(classifyIntent('this is broken and crashing')).toBe('debugging');
      expect(classifyIntent('troubleshoot the issue')).toBe('debugging');
    });
  });

  describe('conventions intent', () => {
    test('detects convention queries', () => {
      expect(classifyIntent('how do we name files?')).toBe('conventions');
      expect(classifyIntent('what is our coding style?')).toBe('conventions');
      expect(classifyIntent('best practices for testing')).toBe('conventions');
      expect(classifyIntent('naming convention for components')).toBe('conventions');
    });
  });

  describe('implementation intent', () => {
    test('detects implementation queries', () => {
      expect(classifyIntent('how do I add a new endpoint?')).toBe('implementation');
      expect(classifyIntent('how to create a new component')).toBe('implementation');
      expect(classifyIntent('implementing the auth flow')).toBe('implementation');
      expect(classifyIntent('how can I build a test')).toBe('implementation');
    });
  });

  describe('architecture intent', () => {
    test('detects architecture queries', () => {
      expect(classifyIntent('what is the system architecture?')).toBe('architecture');
      expect(classifyIntent('how is the database structured?')).toBe('architecture');
      expect(classifyIntent('design pattern for services')).toBe('architecture');
    });
  });

  describe('history intent', () => {
    test('detects history queries', () => {
      expect(classifyIntent('what did we decide about the API?')).toBe('history');
      expect(classifyIntent('why did we choose React?')).toBe('history');
      expect(classifyIntent('what was the decision on auth?')).toBe('history');
    });
  });

  describe('validation intent', () => {
    test('detects validation queries', () => {
      expect(classifyIntent('is this still true?')).toBe('validation');
      expect(classifyIntent('verify that the API uses REST')).toBe('validation');
      expect(classifyIntent('is the config still valid?')).toBe('validation');
    });
  });

  describe('general intent', () => {
    test('falls back to general for unclear queries', () => {
      expect(classifyIntent('hello')).toBe('general');
      expect(classifyIntent('what is x')).toBe('general');
      expect(classifyIntent('list all')).toBe('general');
    });
  });
});

describe('Intent Utilities', () => {
  test('getIntentEmoji returns emojis', () => {
    expect(getIntentEmoji('debugging')).toBe('🐛');
    expect(getIntentEmoji('conventions')).toBe('📏');
    expect(getIntentEmoji('implementation')).toBe('🔨');
  });

  test('getIntentDescription returns descriptions', () => {
    expect(getIntentDescription('debugging')).toContain('error');
    expect(getIntentDescription('conventions')).toContain('standards');
  });
});
