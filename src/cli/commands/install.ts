/**
 * Install command - install/uninstall Alexandria integrations for coding agents
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArgumentsCamelCase, Argv } from 'yargs';
import { colorize } from '../utils.ts';

interface InstallArgs {
  target: 'claude-code' | 'pi' | 'all';
  force: boolean;
  uninstall: boolean;
}

export const command = 'install <target>';
export const describe = 'Install Alexandria integrations for coding agents';

export function builder(yargs: Argv): Argv<InstallArgs> {
  return yargs
    .positional('target', {
      type: 'string',
      choices: ['claude-code', 'pi', 'all'] as const,
      describe: 'Integration target',
      demandOption: true,
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing installation',
    })
    .option('uninstall', {
      alias: 'u',
      type: 'boolean',
      default: false,
      describe: 'Uninstall the integration',
    }) as Argv<InstallArgs>;
}

// Find the integrations directory relative to this file or package
function findIntegrationsDir(): string | null {
  // Try relative to current file (development)
  const devPath = join(
    dirname(import.meta.path.replace('file://', '')),
    '..',
    '..',
    '..',
    'integrations',
  );
  if (existsSync(devPath)) {
    return devPath;
  }

  // Try global install location (npm/bun global)
  const globalPaths = [
    join(homedir(), '.bun', 'install', 'global', 'node_modules', 'alexandria', 'integrations'),
    join(homedir(), '.npm', 'lib', 'node_modules', 'alexandria', 'integrations'),
    '/usr/local/lib/node_modules/alexandria/integrations',
    '/opt/homebrew/lib/node_modules/alexandria/integrations',
  ];

  for (const p of globalPaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return null;
}

function installClaudeCode(integrationsDir: string, force: boolean): boolean {
  const source = join(integrationsDir, 'claude-code');
  const target = join(homedir(), '.claude', 'plugins', 'alexandria-memory');

  if (!existsSync(source)) {
    console.error(colorize(`Source not found: ${source}`, 'red'));
    return false;
  }

  if (existsSync(target) && !force) {
    console.log(colorize('⚠️  Claude Code plugin already installed', 'yellow'));
    console.log(`   Use ${colorize('--force', 'cyan')} to overwrite`);
    console.log(`   Location: ${target}`);
    return false;
  }

  // Ensure parent directory exists
  const pluginsDir = dirname(target);
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  // Copy the integration
  cpSync(source, target, { recursive: true });

  console.log(colorize('✓ Installed Claude Code plugin', 'green'));
  console.log(`  Location: ${target}`);
  console.log();
  console.log('Features:');
  console.log('  • Session start: Hot memories injected first (heatmap priority)');
  console.log('  • Context monitoring: Auto-checkpoint at 50% context window');
  console.log('  • Progressive disclosure: Re-inject context on topic shifts/errors');
  console.log('  • Checkpoint-driven curation: Automatic memory extraction');
  console.log('  • Alexandria skill for memory management');

  return true;
}

function installPi(integrationsDir: string, force: boolean): boolean {
  const source = join(integrationsDir, 'pi', 'hooks');
  const targetDir = join(homedir(), '.pi', 'agent', 'hooks');

  if (!existsSync(source)) {
    console.error(colorize(`Source not found: ${source}`, 'red'));
    return false;
  }

  // Ensure target directory exists
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Get list of hook files
  const hookFiles = ['alexandria.ts', 'revalidation.ts'];
  let installed = 0;
  let skipped = 0;

  for (const file of hookFiles) {
    const sourceFile = join(source, file);
    const targetFile = join(targetDir, `alexandria-${file}`);

    if (!existsSync(sourceFile)) {
      continue;
    }

    if (existsSync(targetFile) && !force) {
      skipped++;
      continue;
    }

    cpSync(sourceFile, targetFile);
    installed++;
  }

  if (installed === 0 && skipped > 0) {
    console.log(colorize('⚠️  pi-coding-agent hooks already installed', 'yellow'));
    console.log(`   Use ${colorize('--force', 'cyan')} to overwrite`);
    console.log(`   Location: ${targetDir}`);
    return false;
  }

  console.log(colorize('✓ Installed pi-coding-agent hooks', 'green'));
  console.log(`  Location: ${targetDir}`);
  console.log();
  console.log('Hooks installed:');
  console.log('  • alexandria-revalidation.ts - Interactive stale memory review');
  console.log('  • alexandria-alexandria.ts - Session lifecycle integration');

  return true;
}

function uninstallClaudeCode(): boolean {
  const target = join(homedir(), '.claude', 'plugins', 'alexandria-memory');

  if (!existsSync(target)) {
    console.log(colorize('Claude Code plugin not installed', 'dim'));
    return false;
  }

  rmSync(target, { recursive: true });
  console.log(colorize('✓ Uninstalled Claude Code plugin', 'green'));
  return true;
}

function uninstallPi(): boolean {
  const targetDir = join(homedir(), '.pi', 'agent', 'hooks');
  const hookFiles = ['alexandria-alexandria.ts', 'alexandria-revalidation.ts'];
  let removed = 0;

  for (const file of hookFiles) {
    const targetFile = join(targetDir, file);
    if (existsSync(targetFile)) {
      rmSync(targetFile);
      removed++;
    }
  }

  if (removed === 0) {
    console.log(colorize('pi-coding-agent hooks not installed', 'dim'));
    return false;
  }

  console.log(colorize(`✓ Uninstalled ${removed} pi-coding-agent hook(s)`, 'green'));
  return true;
}

export async function handler(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  console.log(
    colorize(
      argv.uninstall ? 'Alexandria Integration Uninstaller' : 'Alexandria Integration Installer',
      'bold',
    ),
  );
  console.log();

  if (argv.uninstall) {
    // Uninstall mode
    switch (argv.target) {
      case 'claude-code':
        uninstallClaudeCode();
        break;
      case 'pi':
        uninstallPi();
        break;
      case 'all':
        uninstallClaudeCode();
        console.log();
        uninstallPi();
        break;
    }
    console.log();
    console.log(colorize('Done!', 'green'));
    return;
  }

  // Install mode
  const integrationsDir = findIntegrationsDir();

  if (!integrationsDir) {
    console.error(colorize('Could not find integrations directory', 'red'));
    console.error('Make sure Alexandria is properly installed.');
    process.exit(1);
  }

  let success = true;

  switch (argv.target) {
    case 'claude-code':
      success = installClaudeCode(integrationsDir, argv.force);
      break;

    case 'pi':
      success = installPi(integrationsDir, argv.force);
      break;

    case 'all': {
      console.log(colorize('Installing all integrations...', 'dim'));
      console.log();

      const claudeSuccess = installClaudeCode(integrationsDir, argv.force);
      console.log();
      const piSuccess = installPi(integrationsDir, argv.force);

      success = claudeSuccess || piSuccess;
      break;
    }
  }

  console.log();

  if (success) {
    console.log(
      colorize('Done!', 'green'),
      'Restart your coding agent to activate the integration.',
    );
  }
}
