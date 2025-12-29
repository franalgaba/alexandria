/**
 * Hooks command - manage git hooks for Alexandria
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { getGitRoot } from '../../code/git.ts';
import { colorize } from '../utils.ts';

interface HooksArgs {
  action: 'install' | 'uninstall' | 'status';
}

export const command = 'hooks <action>';
export const describe = 'Manage git hooks for automatic memory verification';

export function builder(yargs: Argv): Argv<HooksArgs> {
  return yargs
    .positional('action', {
      type: 'string',
      choices: ['install', 'uninstall', 'status'] as const,
      describe: 'Action to perform',
      demandOption: true,
    }) as Argv<HooksArgs>;
}

const POST_COMMIT_HOOK = `#!/bin/bash
# Alexandria post-commit hook
# Auto-verifies memories for unchanged files after each commit

# Find alex binary
ALEX=""
if command -v alex &> /dev/null; then
  ALEX="alex"
elif [ -f "$HOME/.local/bin/alex" ]; then
  ALEX="$HOME/.local/bin/alex"
fi

if [ -z "$ALEX" ]; then
  exit 0  # Alexandria not installed, skip silently
fi

# Run staleness check quietly
RESULT=$($ALEX check --json 2>/dev/null)

if [ $? -ne 0 ]; then
  exit 0  # Error running check, skip
fi

# Parse results
NEEDS_REVIEW=$(echo "$RESULT" | grep -o '"needsReview":[0-9]*' | cut -d: -f2)
STALE=$(echo "$RESULT" | grep -o '"stale":[0-9]*' | cut -d: -f2)

# Notify if there are issues
if [ "$NEEDS_REVIEW" -gt 0 ] || [ "$STALE" -gt 0 ]; then
  echo ""
  echo "[Alexandria] ⚠️  Some memories may need attention:"
  if [ "$NEEDS_REVIEW" -gt 0 ]; then
    echo "  • $NEEDS_REVIEW memory(s) reference changed files"
  fi
  if [ "$STALE" -gt 0 ]; then
    echo "  • $STALE memory(s) reference deleted files"
  fi
  echo "  Run 'alex check' for details"
  echo ""
fi
`;

const HOOK_MARKER = '# Alexandria post-commit hook';

export async function handler(argv: ArgumentsCamelCase<HooksArgs>): Promise<void> {
  const gitRoot = getGitRoot();
  
  if (!gitRoot) {
    console.error(colorize('Not in a git repository', 'red'));
    process.exit(1);
  }
  
  const hooksDir = join(gitRoot, '.git', 'hooks');
  const postCommitPath = join(hooksDir, 'post-commit');
  
  switch (argv.action) {
    case 'install':
      installHook(hooksDir, postCommitPath);
      break;
    case 'uninstall':
      uninstallHook(postCommitPath);
      break;
    case 'status':
      showStatus(postCommitPath);
      break;
  }
}

function installHook(hooksDir: string, postCommitPath: string): void {
  // Ensure hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  
  // Check if hook already exists
  if (existsSync(postCommitPath)) {
    const existing = readFileSync(postCommitPath, 'utf-8');
    
    if (existing.includes(HOOK_MARKER)) {
      console.log(colorize('✓ Alexandria hook already installed', 'green'));
      return;
    }
    
    // Append to existing hook
    const updated = existing + '\n\n' + POST_COMMIT_HOOK;
    writeFileSync(postCommitPath, updated);
    console.log(colorize('✓ Added Alexandria hook to existing post-commit', 'green'));
  } else {
    // Create new hook
    writeFileSync(postCommitPath, POST_COMMIT_HOOK);
    chmodSync(postCommitPath, 0o755);
    console.log(colorize('✓ Installed Alexandria post-commit hook', 'green'));
  }
  
  console.log();
  console.log('The hook will:');
  console.log('  • Run after each commit');
  console.log('  • Notify if memories reference changed files');
  console.log('  • Remind you to run `alex check` when needed');
  console.log();
  console.log(colorize('To uninstall:', 'dim'), 'alex hooks uninstall');
}

function uninstallHook(postCommitPath: string): void {
  if (!existsSync(postCommitPath)) {
    console.log(colorize('No post-commit hook found', 'dim'));
    return;
  }
  
  const existing = readFileSync(postCommitPath, 'utf-8');
  
  if (!existing.includes(HOOK_MARKER)) {
    console.log(colorize('Alexandria hook not installed', 'dim'));
    return;
  }
  
  // Check if it's only our hook
  const lines = existing.split('\n');
  const ourHookStart = lines.findIndex(l => l.includes(HOOK_MARKER));
  
  if (ourHookStart <= 1) {
    // Our hook is the only content (or nearly so)
    unlinkSync(postCommitPath);
    console.log(colorize('✓ Removed Alexandria post-commit hook', 'green'));
  } else {
    // There's other content, just remove our part
    const beforeOurs = lines.slice(0, ourHookStart - 1).join('\n').trim();
    writeFileSync(postCommitPath, beforeOurs + '\n');
    console.log(colorize('✓ Removed Alexandria hook from post-commit', 'green'));
  }
}

function showStatus(postCommitPath: string): void {
  console.log(colorize('Git Hook Status', 'bold'));
  console.log();
  
  if (!existsSync(postCommitPath)) {
    console.log(`  post-commit: ${colorize('not installed', 'dim')}`);
    console.log();
    console.log(`  Run ${colorize('alex hooks install', 'cyan')} to enable automatic checks after commits.`);
    return;
  }
  
  const content = readFileSync(postCommitPath, 'utf-8');
  
  if (content.includes(HOOK_MARKER)) {
    console.log(`  post-commit: ${colorize('✓ installed', 'green')}`);
    console.log();
    console.log('  The hook will notify you after commits if memories need attention.');
  } else {
    console.log(`  post-commit: ${colorize('exists (not Alexandria)', 'yellow')}`);
    console.log();
    console.log(`  Run ${colorize('alex hooks install', 'cyan')} to add Alexandria to your existing hook.`);
  }
}
