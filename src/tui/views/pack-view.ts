/**
 * Pack View
 *
 * Generate context packs for agent injection.
 * Activated with 'p' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { type ContextLevel, ProgressiveRetriever } from '../../retriever/progressive.ts';
import { getConnection } from '../../stores/connection.ts';
import { formatContextPack } from '../../utils/format.ts';

// Constants
const PACK_LEVELS: ContextLevel[] = ['minimal', 'task', 'deep'];

// Module state
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;

// Pack mode state
let packSelectedLevel = 1; // Default to 'task'
let packOutput = '';

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initPackView(options: {
  project: string | null;
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
}): void {
  currentProject = options.project;
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
}

/**
 * Update project reference
 */
export function setPackViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter pack mode
 */
export function enterPackMode(): void {
  packSelectedLevel = 1; // Default to "task"
  packOutput = '';
  showPackPanel();
  updatePackPanel();
}

/**
 * Show pack panel
 */
function showPackPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Update pack panel content
 */
export function updatePackPanel(): void {
  if (!inputText) return;

  let content = 'GENERATE CONTEXT PACK\n';
  content += '─'.repeat(35) + '\n\n';
  content += 'Select Level:\n\n';

  const levelDescriptions: Record<ContextLevel, string> = {
    minimal: 'Constraints only - fastest, smallest',
    task: 'Task-relevant memories - balanced',
    deep: 'Full context - comprehensive',
  };

  PACK_LEVELS.forEach((level, i) => {
    const selected = i === packSelectedLevel;
    const prefix = selected ? '> ' : '  ';
    content += `${prefix}${level}\n`;
    content += `       ${levelDescriptions[level]}\n`;
  });

  if (packOutput) {
    content += '\n' + '─'.repeat(35) + '\n\n';
    content += packOutput.slice(0, 500);
    if (packOutput.length > 500) content += '\n...';
  } else {
    content += '\n[Enter] to generate pack';
  }

  inputText.content = content;
}

/**
 * Handle pack mode input
 */
export async function handlePackInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitPackMode();
    return;
  }

  if (key.name === 'up') {
    packSelectedLevel = Math.max(0, packSelectedLevel - 1);
    updatePackPanel();
  } else if (key.name === 'down') {
    packSelectedLevel = Math.min(PACK_LEVELS.length - 1, packSelectedLevel + 1);
    updatePackPanel();
  } else if (key.name === 'return') {
    await generatePack();
  }
}

/**
 * Generate context pack
 */
async function generatePack(): Promise<void> {
  if (!currentProject) return;

  const level = PACK_LEVELS[packSelectedLevel];
  packOutput = 'Generating...';
  updatePackPanel();

  try {
    const db = getConnection(currentProject);
    const progressive = new ProgressiveRetriever(db);

    const pack = await progressive.getContext(level, { tokenBudget: 1500 });
    const output = formatContextPack(pack, 'yaml');

    packOutput = output;
    updatePackPanel();
  } catch (error) {
    packOutput = `Error: ${error}`;
    updatePackPanel();
  }
}

/**
 * Exit pack mode
 */
function exitPackMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}
