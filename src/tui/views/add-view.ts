/**
 * Add Memory View
 *
 * Multi-step wizard for adding new memories.
 * Activated with 'a' key.
 */

import type { KeyEvent, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { ReviewPipeline } from '../../reviewer/index.ts';
import { getConnection } from '../../stores/connection.ts';
import type { ScopeType } from '../../types/common.ts';
import type { Confidence, MemoryObject, ObjectType } from '../../types/memory-objects.ts';
import { TYPE_ABBREV } from '../utils/constants.ts';

// Constants
const MEMORY_TYPES: ObjectType[] = [
  'decision',
  'preference',
  'convention',
  'known_fix',
  'constraint',
  'failed_attempt',
  'environment',
];

const CONFIDENCE_LEVELS: Confidence[] = ['certain', 'high', 'medium', 'low'];
const SCOPE_TYPES: ScopeType[] = ['global', 'project', 'module', 'file'];

type AddStep = 'content' | 'type' | 'confidence' | 'scope' | 'approve' | 'confirm';

// Module state
let currentProject: string | null = null;
let inputPanel: ScrollBoxRenderable | null = null;
let inputText: TextRenderable | null = null;

// Add mode state
let addStep: AddStep = 'content';
let addData = {
  content: '',
  type: 'decision' as ObjectType,
  confidence: 'medium' as Confidence,
  scope: 'project' as ScopeType,
  autoApprove: false,
};
let addSelectedIndex = 0;
let inputBuffer = '';
const inputCursorVisible = true;

// Callbacks
let onExitMode: (() => void) | null = null;
let onShowFeedback: ((msg: string) => void) | null = null;
let onReloadMemories: (() => MemoryObject[]) | null = null;
let onUpdateMemoryList: ((memories: MemoryObject[]) => void) | null = null;

/**
 * Initialize view with TUI elements
 */
export function initAddView(options: {
  project: string | null;
  inputPanelRef: ScrollBoxRenderable;
  inputTextRef: TextRenderable;
  exitModeCallback: () => void;
  showFeedbackCallback: (msg: string) => void;
  reloadMemoriesCallback: () => MemoryObject[];
  updateMemoryListCallback: (memories: MemoryObject[]) => void;
}): void {
  currentProject = options.project;
  inputPanel = options.inputPanelRef;
  inputText = options.inputTextRef;
  onExitMode = options.exitModeCallback;
  onShowFeedback = options.showFeedbackCallback;
  onReloadMemories = options.reloadMemoriesCallback;
  onUpdateMemoryList = options.updateMemoryListCallback;
}

/**
 * Update project reference
 */
export function setAddViewProject(project: string | null): void {
  currentProject = project;
}

/**
 * Enter add mode
 */
export function enterAddMode(): void {
  addStep = 'content';
  addData = {
    content: '',
    type: 'decision',
    confidence: 'medium',
    scope: 'project',
    autoApprove: false,
  };
  addSelectedIndex = 0;
  inputBuffer = '';
  showAddPanel();
  updateAddPanel();
}

/**
 * Show add panel
 */
function showAddPanel(): void {
  if (inputPanel) {
    inputPanel.visible = true;
  }
}

/**
 * Update add panel content
 */
export function updateAddPanel(): void {
  if (!inputText) return;

  const cursor = inputCursorVisible ? '|' : ' ';
  const stepNum = { content: 1, type: 2, confidence: 3, scope: 4, approve: 5, confirm: 6 }[addStep];
  let content = `ADD MEMORY (${stepNum}/6)\n`;
  content += '─'.repeat(35) + '\n\n';

  if (addStep === 'content') {
    content += 'What do you want to remember?\n\n';
    content += `> ${inputBuffer}${cursor}\n\n`;
    content += 'Examples:\n';
    content += '  "Always use async/await instead of callbacks"\n';
    content += '  "Database connection requires SSL in production"\n';
  } else if (addStep === 'type') {
    content += `Content: ${addData.content.slice(0, 40)}...\n\n`;
    content += 'What kind of memory is this?\n\n';
    const typeDescriptions: Record<ObjectType, string> = {
      decision: 'Technical choice with rationale',
      preference: 'Style or approach preference',
      convention: 'Coding standard or pattern',
      known_fix: 'Solution that worked',
      constraint: 'Hard rule or limitation',
      failed_attempt: "What didn't work",
      environment: 'Config, version, or setup',
    };
    MEMORY_TYPES.forEach((type, i) => {
      const abbrev = TYPE_ABBREV[type] || '???';
      const selected = i === addSelectedIndex;
      const prefix = selected ? '> ' : '  ';
      content += `${prefix}[${abbrev}] ${type}\n`;
      content += `       ${typeDescriptions[type]}\n`;
    });
  } else if (addStep === 'confidence') {
    content += `Type: [${TYPE_ABBREV[addData.type]}] ${addData.type}\n\n`;
    content += 'How confident are you in this?\n\n';
    const confDescriptions: Record<Confidence, string> = {
      certain: 'Verified, documented, or proven',
      high: 'Very likely correct',
      medium: 'Reasonable assumption',
      low: 'Hypothesis or guess',
    };
    CONFIDENCE_LEVELS.forEach((level, i) => {
      const selected = i === addSelectedIndex;
      const prefix = selected ? '> ' : '  ';
      content += `${prefix}${level}\n`;
      content += `       ${confDescriptions[level]}\n`;
    });
  } else if (addStep === 'scope') {
    content += `Confidence: ${addData.confidence}\n\n`;
    content += 'Where does this apply?\n\n';
    const scopeDescriptions: Record<ScopeType, string> = {
      global: 'Applies everywhere',
      project: 'This project only',
      module: 'Specific module/directory',
      file: 'Single file',
    };
    SCOPE_TYPES.forEach((scope, i) => {
      const selected = i === addSelectedIndex;
      const prefix = selected ? '> ' : '  ';
      content += `${prefix}${scope}\n`;
      content += `       ${scopeDescriptions[scope]}\n`;
    });
  } else if (addStep === 'approve') {
    content += `Scope: ${addData.scope}\n\n`;
    content += 'Auto-approve this memory?\n\n';
    const options = [
      { name: 'Yes', desc: 'Mark as approved immediately' },
      { name: 'No', desc: 'Keep as pending for review' },
    ];
    options.forEach((opt, i) => {
      const selected = i === addSelectedIndex;
      const prefix = selected ? '> ' : '  ';
      content += `${prefix}${opt.name}\n`;
      content += `       ${opt.desc}\n`;
    });
  } else if (addStep === 'confirm') {
    content += 'REVIEW\n';
    content += '─'.repeat(35) + '\n\n';
    content += `"${addData.content}"\n\n`;
    content += `Type:       [${TYPE_ABBREV[addData.type]}] ${addData.type}\n`;
    content += `Confidence: ${addData.confidence}\n`;
    content += `Scope:      ${addData.scope}\n`;
    content += `Status:     ${addData.autoApprove ? 'approved' : 'pending review'}\n\n`;
    content += '─'.repeat(35) + '\n';
    content += '[Enter] Save    [Esc] Cancel';
  }

  inputText.content = content;
}

/**
 * Handle add mode input
 */
export async function handleAddInput(key: KeyEvent): Promise<void> {
  if (key.name === 'escape') {
    exitAddMode();
    return;
  }

  if (addStep === 'content') {
    if (key.name === 'return' && inputBuffer.length > 0) {
      addData.content = inputBuffer;
      inputBuffer = '';
      addStep = 'type';
      addSelectedIndex = 0;
      updateAddPanel();
    } else if (key.name === 'backspace') {
      inputBuffer = inputBuffer.slice(0, -1);
      updateAddPanel();
    } else if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
      inputBuffer += key.sequence;
      updateAddPanel();
    }
  } else if (addStep === 'type') {
    if (key.name === 'up') {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateAddPanel();
    } else if (key.name === 'down') {
      addSelectedIndex = Math.min(MEMORY_TYPES.length - 1, addSelectedIndex + 1);
      updateAddPanel();
    } else if (key.name === 'return') {
      addData.type = MEMORY_TYPES[addSelectedIndex];
      addStep = 'confidence';
      addSelectedIndex = 2; // Default to medium
      updateAddPanel();
    }
  } else if (addStep === 'confidence') {
    if (key.name === 'up') {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateAddPanel();
    } else if (key.name === 'down') {
      addSelectedIndex = Math.min(CONFIDENCE_LEVELS.length - 1, addSelectedIndex + 1);
      updateAddPanel();
    } else if (key.name === 'return') {
      addData.confidence = CONFIDENCE_LEVELS[addSelectedIndex];
      addStep = 'scope';
      addSelectedIndex = 1; // Default to project
      updateAddPanel();
    }
  } else if (addStep === 'scope') {
    if (key.name === 'up') {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateAddPanel();
    } else if (key.name === 'down') {
      addSelectedIndex = Math.min(SCOPE_TYPES.length - 1, addSelectedIndex + 1);
      updateAddPanel();
    } else if (key.name === 'return') {
      addData.scope = SCOPE_TYPES[addSelectedIndex];
      addStep = 'approve';
      addSelectedIndex = 1; // Default to No (pending review)
      updateAddPanel();
    }
  } else if (addStep === 'approve') {
    if (key.name === 'up') {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateAddPanel();
    } else if (key.name === 'down') {
      addSelectedIndex = Math.min(1, addSelectedIndex + 1);
      updateAddPanel();
    } else if (key.name === 'return') {
      addData.autoApprove = addSelectedIndex === 0; // 0 = Yes
      addStep = 'confirm';
      updateAddPanel();
    }
  } else if (addStep === 'confirm') {
    if (key.name === 'return') {
      await saveMemory();
    }
  }
}

/**
 * Save memory to database
 */
async function saveMemory(): Promise<void> {
  if (!currentProject) return;

  try {
    const db = getConnection(currentProject);
    const pipeline = new ReviewPipeline(db);

    await pipeline.addMemory({
      content: addData.content,
      type: addData.type,
      confidence: addData.confidence,
      scope: { type: addData.scope },
      autoApprove: addData.autoApprove,
    });

    // Reload memories
    if (onReloadMemories && onUpdateMemoryList) {
      const memories = onReloadMemories();
      onUpdateMemoryList(memories);
    }

    exitAddMode();
    const status = addData.autoApprove ? 'approved' : 'pending review';
    if (onShowFeedback) {
      onShowFeedback(`+ Memory added (${status}): ${addData.content.slice(0, 30)}...`);
    }
  } catch (error) {
    if (inputText) {
      inputText.content = `Error: ${error}`;
    }
  }
}

/**
 * Exit add mode
 */
function exitAddMode(): void {
  if (inputPanel) {
    inputPanel.visible = false;
  }
  if (onExitMode) onExitMode();
}

/**
 * Get current add step (for help text)
 */
export function getAddStep(): AddStep {
  return addStep;
}
