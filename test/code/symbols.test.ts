import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { SymbolExtractor, listSymbols } from '../../src/code/symbols.ts';

const TEST_DIR = '/tmp/alexandria-symbols-test';

describe('SymbolExtractor', () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    try {
      rmdirSync(TEST_DIR, { recursive: true });
    } catch {}
  });

  describe('TypeScript extraction', () => {
    test('extracts functions', () => {
      const filePath = join(TEST_DIR, 'functions.ts');
      writeFileSync(filePath, `
export function publicFunc() {}
function privateFunc() {}
async function asyncFunc() {}
export async function exportedAsync() {}
      `);
      
      const extractor = new SymbolExtractor();
      const symbols = extractor.extract(filePath);
      
      expect(symbols.length).toBe(4);
      
      const publicFunc = symbols.find(s => s.name === 'publicFunc');
      expect(publicFunc).toBeDefined();
      expect(publicFunc!.kind).toBe('function');
      expect(publicFunc!.exported).toBe(true);
      
      const privateFunc = symbols.find(s => s.name === 'privateFunc');
      expect(privateFunc).toBeDefined();
      expect(privateFunc!.exported).toBe(false);
    });

    test('extracts classes', () => {
      const filePath = join(TEST_DIR, 'classes.ts');
      writeFileSync(filePath, `
export class PublicClass {}
class PrivateClass {}
      `);
      
      const extractor = new SymbolExtractor();
      const symbols = extractor.extract(filePath);
      
      expect(symbols.length).toBe(2);
      expect(symbols.find(s => s.name === 'PublicClass')?.exported).toBe(true);
      expect(symbols.find(s => s.name === 'PrivateClass')?.exported).toBe(false);
    });

    test('extracts interfaces and types', () => {
      const filePath = join(TEST_DIR, 'types.ts');
      writeFileSync(filePath, `
export interface User {}
interface PrivateInterface {}
export type ID = string;
type Internal = number;
      `);
      
      const extractor = new SymbolExtractor();
      const symbols = extractor.extract(filePath);
      
      const user = symbols.find(s => s.name === 'User');
      expect(user?.kind).toBe('interface');
      expect(user?.exported).toBe(true);
      
      const id = symbols.find(s => s.name === 'ID');
      expect(id?.kind).toBe('type');
      expect(id?.exported).toBe(true);
    });

    test('extracts arrow functions', () => {
      const filePath = join(TEST_DIR, 'arrows.ts');
      writeFileSync(filePath, `
export const arrowFunc = () => {};
const privateArrow = async () => {};
      `);
      
      const extractor = new SymbolExtractor();
      const symbols = extractor.extract(filePath);
      
      const arrowFunc = symbols.find(s => s.name === 'arrowFunc');
      expect(arrowFunc?.kind).toBe('function');
      expect(arrowFunc?.exported).toBe(true);
    });
  });

  describe('Python extraction', () => {
    test('extracts functions and classes', () => {
      const filePath = join(TEST_DIR, 'module.py');
      writeFileSync(filePath, `
def public_function():
    pass

def _private_function():
    pass

class MyClass:
    pass

CONSTANT = 42
      `);
      
      const extractor = new SymbolExtractor();
      const symbols = extractor.extract(filePath);
      
      const publicFunc = symbols.find(s => s.name === 'public_function');
      expect(publicFunc?.kind).toBe('function');
      expect(publicFunc?.exported).toBe(true);
      
      const myClass = symbols.find(s => s.name === 'MyClass');
      expect(myClass?.kind).toBe('class');
      
      const constant = symbols.find(s => s.name === 'CONSTANT');
      expect(constant?.kind).toBe('const');
    });
  });

  describe('findSymbol', () => {
    test('finds existing symbol', () => {
      const filePath = join(TEST_DIR, 'find.ts');
      writeFileSync(filePath, `
export function targetFunc() {}
function otherFunc() {}
      `);
      
      const extractor = new SymbolExtractor();
      const symbol = extractor.findSymbol(filePath, 'targetFunc');
      
      expect(symbol).not.toBeNull();
      expect(symbol!.name).toBe('targetFunc');
      expect(symbol!.line).toBeGreaterThan(0);
    });

    test('returns null for missing symbol', () => {
      const filePath = join(TEST_DIR, 'find.ts');
      
      const extractor = new SymbolExtractor();
      const symbol = extractor.findSymbol(filePath, 'nonexistent');
      
      expect(symbol).toBeNull();
    });
  });

  describe('includePrivate option', () => {
    test('excludes underscore-prefixed by default', () => {
      const filePath = join(TEST_DIR, 'private.ts');
      writeFileSync(filePath, `
function _private() {}
function public() {}
      `);
      
      const extractor = new SymbolExtractor({ includePrivate: false });
      const symbols = extractor.extract(filePath);
      
      expect(symbols.find(s => s.name === '_private')).toBeUndefined();
      expect(symbols.find(s => s.name === 'public')).toBeDefined();
    });

    test('includes private when enabled', () => {
      const filePath = join(TEST_DIR, 'private.ts');
      
      const extractor = new SymbolExtractor({ includePrivate: true });
      const symbols = extractor.extract(filePath);
      
      expect(symbols.find(s => s.name === '_private')).toBeDefined();
    });
  });
});

describe('listSymbols', () => {
  test('returns symbols from file', () => {
    // Use a file created in the SymbolExtractor tests
    const filePath = join(TEST_DIR, 'list-test.ts');
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(filePath, `
export function hello() {}
    `);
    
    const symbols = listSymbols(filePath);
    expect(symbols.length).toBeGreaterThan(0);
    
    unlinkSync(filePath);
  });
});
