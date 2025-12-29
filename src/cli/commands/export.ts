/**
 * Export/Import command - export and import memory data
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { VectorIndex } from '../../indexes/vector.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { error, info, success } from '../utils.ts';

interface ExportArgs {
  action: 'export' | 'import';
  file?: string;
  status: string[];
}

export const command = 'export <action>';
export const describe = 'Export or import memory objects';

export function builder(yargs: Argv): Argv<ExportArgs> {
  return yargs
    .positional('action', {
      type: 'string',
      choices: ['export', 'import'] as const,
      demandOption: true,
      describe: 'Action to perform',
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      describe: 'File path (stdout/stdin if not specified)',
    })
    .option('status', {
      alias: 's',
      type: 'array',
      default: ['active', 'stale'],
      describe: 'Status filter for export',
    }) as Argv<ExportArgs>;
}

export async function handler(argv: ArgumentsCamelCase<ExportArgs>): Promise<void> {
  const db = getConnection();
  const store = new MemoryObjectStore(db);

  try {
    if (argv.action === 'export') {
      // Export objects
      const objects = store.list({ status: argv.status as any[], limit: 10000 });

      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        objects: objects.map((obj) => ({
          content: obj.content,
          objectType: obj.objectType,
          scope: obj.scope,
          status: obj.status,
          confidence: obj.confidence,
          evidenceExcerpt: obj.evidenceExcerpt,
          createdAt: obj.createdAt.toISOString(),
        })),
      };

      const json = JSON.stringify(exportData, null, 2);

      if (argv.file) {
        await Bun.write(argv.file, json);
        success(`Exported ${objects.length} objects to ${argv.file}`);
      } else {
        console.log(json);
      }
    } else {
      // Import objects
      let json: string;

      if (argv.file) {
        const file = Bun.file(argv.file);
        json = await file.text();
      } else {
        // Read from stdin
        const reader = Bun.stdin.stream().getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const decoder = new TextDecoder();
        json = chunks.map((c) => decoder.decode(c)).join('');
      }

      const importData = JSON.parse(json);

      if (!importData.objects || !Array.isArray(importData.objects)) {
        error('Invalid import file format');
        process.exit(1);
      }

      info(`Importing ${importData.objects.length} objects...`);

      const vector = new VectorIndex(db);
      let imported = 0;

      for (const objData of importData.objects) {
        try {
          const obj = store.create({
            content: objData.content,
            objectType: objData.objectType,
            scope: objData.scope,
            confidence: objData.confidence || 'medium',
            evidenceExcerpt: objData.evidenceExcerpt,
            reviewStatus: 'approved', // Auto-approve imports
          });

          // Index for vector search
          await vector.indexObject(obj.id, obj.content);
          imported++;
        } catch (err) {
          console.error(`Failed to import object: ${err}`);
        }
      }

      success(`Imported ${imported} objects`);
    }
  } finally {
    closeConnection();
  }
}
