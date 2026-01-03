/**
 * LSP Client - Language Server Protocol integration
 *
 * Provides rich symbol information, go-to-definition, references, etc.
 * Falls back to regex-based extraction when LSP is unavailable.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { type Symbol, SymbolExtractor, type SymbolKind } from './symbols.ts';

// LSP Message Types
interface LSPMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

interface LSPLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface LSPSymbolInformation {
  name: string;
  kind: number;
  location: LSPLocation;
  containerName?: string;
}

interface LSPDocumentSymbol {
  name: string;
  kind: number;
  range: { start: { line: number }; end: { line: number } };
  selectionRange: { start: { line: number }; end: { line: number } };
  children?: LSPDocumentSymbol[];
}

// LSP Symbol Kind mapping
const LSP_SYMBOL_KIND: Record<number, SymbolKind> = {
  1: 'function', // File
  2: 'function', // Module
  3: 'function', // Namespace
  4: 'function', // Package
  5: 'class', // Class
  6: 'function', // Method
  7: 'property', // Property
  8: 'variable', // Field
  9: 'function', // Constructor
  10: 'type', // Enum
  11: 'interface', // Interface
  12: 'function', // Function
  13: 'variable', // Variable
  14: 'const', // Constant
  15: 'variable', // String
  16: 'variable', // Number
  17: 'variable', // Boolean
  18: 'variable', // Array
  19: 'variable', // Object
  20: 'variable', // Key
  21: 'variable', // Null
  22: 'type', // EnumMember
  23: 'variable', // Struct
  24: 'variable', // Event
  25: 'function', // Operator
  26: 'type', // TypeParameter
};

// Language server configurations
const LSP_SERVERS: Record<string, { command: string; args: string[] }> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  python: {
    command: 'pylsp',
    args: [],
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
  },
  go: {
    command: 'gopls',
    args: [],
  },
};

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
};

export interface LSPClientOptions {
  /** Root directory for the project */
  rootDir: string;
  /** Timeout for LSP requests in ms */
  timeout?: number;
  /** Whether to use fallback when LSP unavailable */
  useFallback?: boolean;
}

export interface DefinitionResult {
  path: string;
  line: number;
  character: number;
}

export interface ReferenceResult {
  path: string;
  line: number;
  character: number;
  preview?: string;
}

export class LSPClient {
  private processes: Map<string, ChildProcess> = new Map();
  private messageId = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private buffers: Map<string, string> = new Map();
  private initialized: Map<string, boolean> = new Map();
  private fallbackExtractor: SymbolExtractor;
  private options: Required<LSPClientOptions>;

  constructor(options: LSPClientOptions) {
    this.options = {
      timeout: options.timeout ?? 5000,
      useFallback: options.useFallback ?? true,
      rootDir: options.rootDir,
    };
    this.fallbackExtractor = new SymbolExtractor({ includePrivate: true });
  }

  /**
   * Get symbols from a file using LSP or fallback
   */
  async getSymbols(filePath: string): Promise<Symbol[]> {
    const language = this.getLanguage(filePath);
    if (!language) {
      return this.fallbackExtractor.extract(filePath);
    }

    try {
      await this.ensureServer(language);
      const symbols = await this.requestDocumentSymbols(filePath, language);
      return symbols;
    } catch (error) {
      console.debug(`LSP failed for ${filePath}, using fallback:`, error);
      if (this.options.useFallback) {
        return this.fallbackExtractor.extract(filePath);
      }
      return [];
    }
  }

  /**
   * Go to definition of a symbol at position
   */
  async getDefinition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<DefinitionResult | null> {
    const language = this.getLanguage(filePath);
    if (!language) return null;

    try {
      await this.ensureServer(language);
      return await this.requestDefinition(filePath, line, character, language);
    } catch (error) {
      console.debug(`LSP definition failed:`, error);
      return null;
    }
  }

  /**
   * Find all references to a symbol at position
   */
  async getReferences(
    filePath: string,
    line: number,
    character: number,
  ): Promise<ReferenceResult[]> {
    const language = this.getLanguage(filePath);
    if (!language) return [];

    try {
      await this.ensureServer(language);
      return await this.requestReferences(filePath, line, character, language);
    } catch (error) {
      console.debug(`LSP references failed:`, error);
      return [];
    }
  }

  /**
   * Get hover information at position
   */
  async getHover(filePath: string, line: number, character: number): Promise<string | null> {
    const language = this.getLanguage(filePath);
    if (!language) return null;

    try {
      await this.ensureServer(language);
      return await this.requestHover(filePath, line, character, language);
    } catch (error) {
      console.debug(`LSP hover failed:`, error);
      return null;
    }
  }

  /**
   * Check if LSP is available for a language
   */
  async isAvailable(language: string): Promise<boolean> {
    const config = LSP_SERVERS[language];
    if (!config) return false;

    try {
      // Check if command exists
      const result = spawn('which', [config.command], { stdio: 'pipe' });
      return new Promise((resolve) => {
        result.on('close', (code) => resolve(code === 0));
        result.on('error', () => resolve(false));
      });
    } catch {
      return false;
    }
  }

  /**
   * Shutdown all LSP servers
   */
  async shutdown(): Promise<void> {
    for (const [language, process] of this.processes) {
      try {
        await this.sendRequest(language, 'shutdown', {});
        this.sendNotification(language, 'exit', {});
        process.kill();
      } catch {
        process.kill('SIGKILL');
      }
    }
    this.processes.clear();
    this.initialized.clear();
  }

  // Private methods

  private getLanguage(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    return EXT_TO_LANGUAGE[ext] || null;
  }

  private async ensureServer(language: string): Promise<void> {
    if (this.initialized.get(language)) return;

    const config = LSP_SERVERS[language];
    if (!config) {
      throw new Error(`No LSP server configured for ${language}`);
    }

    // Start the server
    const process = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.rootDir,
    });

    this.processes.set(language, process);
    this.buffers.set(language, '');

    // Handle incoming messages
    process.stdout?.on('data', (data: Buffer) => {
      this.handleServerData(language, data);
    });

    process.stderr?.on('data', (data: Buffer) => {
      console.debug(`LSP ${language} stderr:`, data.toString());
    });

    process.on('error', (error) => {
      console.error(`LSP ${language} error:`, error);
      this.processes.delete(language);
      this.initialized.delete(language);
    });

    process.on('close', (code) => {
      console.debug(`LSP ${language} closed with code ${code}`);
      this.processes.delete(language);
      this.initialized.delete(language);
    });

    // Initialize
    await this.sendRequest(language, 'initialize', {
      processId: process.pid,
      rootUri: `file://${this.options.rootDir}`,
      capabilities: {
        textDocument: {
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
        },
      },
    });

    this.sendNotification(language, 'initialized', {});
    this.initialized.set(language, true);
  }

  private handleServerData(language: string, data: Buffer): void {
    let buffer = (this.buffers.get(language) || '') + data.toString();

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.substring(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (buffer.length < messageEnd) break;

      const messageJson = buffer.substring(messageStart, messageEnd);
      buffer = buffer.substring(messageEnd);

      try {
        const message: LSPMessage = JSON.parse(messageJson);
        this.handleMessage(language, message);
      } catch (error) {
        console.debug(`Failed to parse LSP message:`, error);
      }
    }

    this.buffers.set(language, buffer);
  }

  private handleMessage(language: string, message: LSPMessage): void {
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  private sendMessage(language: string, message: LSPMessage): void {
    const process = this.processes.get(language);
    if (!process?.stdin) {
      throw new Error(`No LSP process for ${language}`);
    }

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    process.stdin.write(header + content);
  }

  private sendNotification(language: string, method: string, params: any): void {
    this.sendMessage(language, { jsonrpc: '2.0', method, params });
  }

  private sendRequest(language: string, method: string, params: any): Promise<any> {
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }, this.options.timeout);

      this.pendingRequests.set(id, {
        resolve: (result: any) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.sendMessage(language, { jsonrpc: '2.0', id, method, params });
    });
  }

  private async requestDocumentSymbols(filePath: string, language: string): Promise<Symbol[]> {
    // Open the document first
    const content = await Bun.file(filePath).text();
    this.sendNotification(language, 'textDocument/didOpen', {
      textDocument: {
        uri: `file://${resolve(filePath)}`,
        languageId: language,
        version: 1,
        text: content,
      },
    });

    const result = await this.sendRequest(language, 'textDocument/documentSymbol', {
      textDocument: { uri: `file://${resolve(filePath)}` },
    });

    if (!result) return [];

    // Handle both flat and hierarchical responses
    const symbols: Symbol[] = [];
    const processSymbol = (
      sym: LSPDocumentSymbol | LSPSymbolInformation,
      containerName?: string,
    ) => {
      const kind = LSP_SYMBOL_KIND[sym.kind] || 'variable';
      const line =
        'range' in sym ? sym.range.start.line + 1 : sym.location?.range.start.line + 1 || 1;
      const endLine = 'range' in sym ? sym.range.end.line + 1 : undefined;

      symbols.push({
        name: sym.name,
        kind,
        path: filePath,
        line,
        endLine,
        exported: !sym.name.startsWith('_'),
      });

      // Process children for hierarchical symbols
      if ('children' in sym && sym.children) {
        for (const child of sym.children) {
          processSymbol(child, sym.name);
        }
      }
    };

    for (const sym of result) {
      processSymbol(sym);
    }

    return symbols;
  }

  private async requestDefinition(
    filePath: string,
    line: number,
    character: number,
    language: string,
  ): Promise<DefinitionResult | null> {
    const result = await this.sendRequest(language, 'textDocument/definition', {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
    });

    if (!result) return null;

    const location = Array.isArray(result) ? result[0] : result;
    if (!location?.uri) return null;

    return {
      path: location.uri.replace('file://', ''),
      line: location.range.start.line + 1,
      character: location.range.start.character,
    };
  }

  private async requestReferences(
    filePath: string,
    line: number,
    character: number,
    language: string,
  ): Promise<ReferenceResult[]> {
    const result = await this.sendRequest(language, 'textDocument/references', {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
      context: { includeDeclaration: true },
    });

    if (!result || !Array.isArray(result)) return [];

    return result.map((loc: LSPLocation) => ({
      path: loc.uri.replace('file://', ''),
      line: loc.range.start.line + 1,
      character: loc.range.start.character,
    }));
  }

  private async requestHover(
    filePath: string,
    line: number,
    character: number,
    language: string,
  ): Promise<string | null> {
    const result = await this.sendRequest(language, 'textDocument/hover', {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line: line - 1, character },
    });

    if (!result?.contents) return null;

    // Handle different content formats
    if (typeof result.contents === 'string') {
      return result.contents;
    }
    if (result.contents.value) {
      return result.contents.value;
    }
    if (Array.isArray(result.contents)) {
      return result.contents.map((c: any) => (typeof c === 'string' ? c : c.value)).join('\n');
    }

    return null;
  }
}

/**
 * Get a shared LSP client instance
 */
let sharedClient: LSPClient | null = null;

export function getLSPClient(rootDir?: string): LSPClient {
  if (!sharedClient) {
    sharedClient = new LSPClient({
      rootDir: rootDir || process.cwd(),
      useFallback: true,
    });
  }
  return sharedClient;
}

/**
 * Cleanup LSP resources on exit
 */
export async function shutdownLSP(): Promise<void> {
  if (sharedClient) {
    await sharedClient.shutdown();
    sharedClient = null;
  }
}
