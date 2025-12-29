/**
 * Add-contract command - add an API/interface contract
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import type { ContractStructured } from '../../types/structured.ts';
import { colorize, success } from '../utils.ts';
import { formatMemoryObject } from '../../utils/format.ts';

interface AddContractArgs {
  name: string;
  type: string;
  definition?: string;
  contractVersion?: string;
  file?: string;
  approve: boolean;
}

export const command = 'add-contract <name>';
export const describe = 'Add an API or interface contract';

export function builder(yargs: Argv): Argv<AddContractArgs> {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Name of the contract/interface',
      demandOption: true,
    })
    .option('type', {
      alias: 't',
      type: 'string',
      choices: ['api', 'schema', 'interface', 'protocol'],
      default: 'api',
      describe: 'Type of contract',
    })
    .option('definition', {
      alias: 'd',
      type: 'string',
      describe: 'The contract definition',
    })
    .option('contract-version', {
      type: 'string',
      describe: 'Version of the contract',
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      describe: 'File where the contract is defined',
    })
    .option('approve', {
      type: 'boolean',
      default: false,
      describe: 'Auto-approve this contract',
    }) as Argv<AddContractArgs>;
}

export async function handler(argv: ArgumentsCamelCase<AddContractArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  try {
    // Build structured data
    const structured: ContractStructured = {
      name: argv.name,
      contractType: argv.type as ContractStructured['contractType'],
    };

    if (argv.definition) {
      structured.definition = argv.definition;
    }
    if (argv.contractVersion) {
      structured.version = argv.contractVersion;
    }

    // Build content
    let content = `Contract: ${argv.name} (${argv.type})`;
    if (argv.contractVersion) {
      content += ` v${argv.contractVersion}`;
    }

    // Add code ref if file specified
    const codeRefs = argv.file ? [{ path: argv.file }] : [];

    const obj = store.create({
      content,
      objectType: 'convention', // Store contracts as conventions
      reviewStatus: argv.approve ? 'approved' : 'pending',
      structured,
      codeRefs,
    });

    success(`Added contract: ${obj.id}`);
    console.log(formatMemoryObject(obj));

    // Show structured data
    console.log(colorize('\nContract Details:', 'dim'));
    console.log(colorize(`  Name: ${structured.name}`, 'cyan'));
    console.log(colorize(`  Type: ${structured.contractType}`, 'dim'));
    if (structured.version) {
      console.log(colorize(`  Version: ${structured.version}`, 'dim'));
    }
    if (structured.definition) {
      console.log(colorize(`  Definition:`, 'dim'));
      console.log(colorize(`    ${structured.definition}`, 'dim'));
    }
  } finally {
    closeConnection();
  }
}
