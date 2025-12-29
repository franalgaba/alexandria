/**
 * TUI command - launch the Alexandria terminal UI
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';

interface TuiArgs {}

export const command = 'tui';
export const describe = 'Launch the Alexandria terminal UI';

export function builder(yargs: Argv): Argv<TuiArgs> {
  return yargs as Argv<TuiArgs>;
}

export async function handler(_argv: ArgumentsCamelCase<TuiArgs>): Promise<void> {
  const { runTUI } = await import('../../tui/index.ts');
  await runTUI();
}
