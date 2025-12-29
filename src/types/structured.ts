/**
 * Structured data types for enhanced memory objects
 */

/**
 * Structured data for decision memories
 */
export interface DecisionStructured {
  /** The actual decision made */
  decision: string;
  /** Alternatives that were considered */
  alternatives?: string[];
  /** Why this choice was made */
  rationale?: string;
  /** Known tradeoffs or downsides */
  tradeoffs?: string[];
  /** Who made the decision */
  decidedBy?: 'team' | 'user' | 'inferred';
}

/**
 * Structured data for contract/interface memories
 */
export interface ContractStructured {
  /** Name of the contract/interface */
  name: string;
  /** Type of contract */
  contractType: 'api' | 'schema' | 'interface' | 'protocol';
  /** The actual definition (OpenAPI, TypeScript interface, etc.) */
  definition?: string;
  /** Version of the contract */
  version?: string;
}

/**
 * Union of all structured types
 */
export type StructuredData = 
  | DecisionStructured 
  | ContractStructured;

/**
 * Type guard for DecisionStructured
 */
export function isDecisionStructured(data: unknown): data is DecisionStructured {
  return (
    typeof data === 'object' &&
    data !== null &&
    'decision' in data &&
    typeof (data as DecisionStructured).decision === 'string'
  );
}

/**
 * Type guard for ContractStructured
 */
export function isContractStructured(data: unknown): data is ContractStructured {
  return (
    typeof data === 'object' &&
    data !== null &&
    'name' in data &&
    'contractType' in data &&
    typeof (data as ContractStructured).name === 'string'
  );
}



/**
 * Parse structured data from JSON string
 */
export function parseStructured(json: string | null | undefined): StructuredData | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Serialize structured data to JSON string
 */
export function serializeStructured(data: StructuredData | undefined): string | null {
  if (!data) return null;
  return JSON.stringify(data);
}

/**
 * Format decision structured data for display
 */
export function formatDecision(data: DecisionStructured): string {
  const lines: string[] = [];
  lines.push(`Decision: ${data.decision}`);
  
  if (data.alternatives && data.alternatives.length > 0) {
    lines.push(`Alternatives: ${data.alternatives.join(', ')}`);
  }
  
  if (data.rationale) {
    lines.push(`Rationale: ${data.rationale}`);
  }
  
  if (data.tradeoffs && data.tradeoffs.length > 0) {
    lines.push(`Tradeoffs: ${data.tradeoffs.join(', ')}`);
  }
  
  if (data.decidedBy) {
    lines.push(`Decided by: ${data.decidedBy}`);
  }
  
  return lines.join('\n');
}

/**
 * Format contract structured data for display
 */
export function formatContract(data: ContractStructured): string {
  const lines: string[] = [];
  lines.push(`Contract: ${data.name}`);
  lines.push(`Type: ${data.contractType}`);
  
  if (data.version) {
    lines.push(`Version: ${data.version}`);
  }
  
  if (data.definition) {
    lines.push(`Definition:\n${data.definition}`);
  }
  
  return lines.join('\n');
}

/**
 * Format any structured data for display
 */
export function formatStructured(data: StructuredData): string {
  if (isDecisionStructured(data)) {
    return formatDecision(data);
  }
  if (isContractStructured(data)) {
    return formatContract(data);
  }
  return JSON.stringify(data, null, 2);
}
