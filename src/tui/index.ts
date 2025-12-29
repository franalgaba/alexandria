#!/usr/bin/env bun
/**
 * Alexandria TUI - Terminal UI for memory management
 * 
 * Run side-by-side with Claude Code or pi-coding-agent to review memories
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  TabSelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderableEvents,
  type CliRenderer,
  type SelectOption,
  type TabSelectOption,
  type KeyEvent,
  t,
  bold,
  fg,
  underline,
} from "@opentui/core";
import { getConnection, listProjectDatabases } from "../stores/connection.ts";
import { MemoryObjectStore } from "../stores/memory-objects.ts";
import { EventStore } from "../stores/events.ts";
import type { MemoryObject } from "../types/memory-objects.ts";

// State
let renderer: CliRenderer;
let currentProject: string | null = null;
let currentMemories: MemoryObject[] = [];
let selectedMemoryIndex = 0;
let viewMode: "list" | "detail" | "trail" = "list";

// UI Elements
let projectTabs: TabSelectRenderable;
let memoryList: SelectRenderable;
let detailPanel: BoxRenderable;
let detailText: TextRenderable;
let trailPanel: BoxRenderable;
let trailText: TextRenderable;
let statusBar: TextRenderable;
let helpText: TextRenderable;

// Memory type icons
const TYPE_ICONS: Record<string, string> = {
  decision: "🎯",
  constraint: "🚫",
  convention: "📏",
  known_fix: "✅",
  failed_attempt: "❌",
  preference: "⭐",
  environment: "⚙️",
};

// Status icons
const STATUS_ICONS: Record<string, string> = {
  pending: "🟡",
  approved: "🟢",
  rejected: "🔴",
};

function getProjects(): TabSelectOption[] {
  const projects = listProjectDatabases();
  if (projects.length === 0) {
    return [{ name: "No projects", description: "No Alexandria projects found", value: "" }];
  }
  return projects.map(p => ({
    name: p.name.length > 15 ? p.name.slice(0, 12) + "..." : p.name,
    description: p.projectPath,
    value: p.dbPath,  // Use dbPath, not path
  }));
}

function loadMemories(dbPath: string): MemoryObject[] {
  try {
    // Open database directly without caching
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath);
    const store = new MemoryObjectStore(db);
    const memories = store.list({ limit: 100 });
    db.close();
    return memories;
  } catch (error) {
    console.error("Failed to load memories:", error);
    return [];
  }
}

function getMemoryOptions(): SelectOption[] {
  if (currentMemories.length === 0) {
    return [{ name: "No memories", description: "No memories in this project", value: "" }];
  }
  
  return currentMemories.map((m, i) => {
    const icon = TYPE_ICONS[m.objectType] || "📝";
    const status = STATUS_ICONS[m.reviewStatus] || "⚪";
    const content = m.content.length > 50 ? m.content.slice(0, 47) + "..." : m.content;
    return {
      name: `${icon} ${status} ${content}`,
      description: `[${m.objectType}] ${m.confidence} confidence`,
      value: m.id,
    };
  });
}

function getMemoryDetail(memory: MemoryObject): string {
  const icon = TYPE_ICONS[memory.objectType] || "📝";
  const status = STATUS_ICONS[memory.reviewStatus] || "⚪";
  
  return `${icon} ${memory.objectType.toUpperCase()} ${status} ${memory.reviewStatus}

${memory.content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ID: ${memory.id}
Confidence: ${memory.confidence} (${memory.confidenceTier || "unknown"})
Scope: ${memory.scope.type}${memory.scope.path ? ` - ${memory.scope.path}` : ""}
Created: ${new Date(memory.createdAt).toLocaleString()}
Updated: ${new Date(memory.updatedAt).toLocaleString()}
Access Count: ${memory.accessCount}

${memory.codeRefs && memory.codeRefs.length > 0 ? `Code References:
${memory.codeRefs.map(r => `  • ${r.path}${r.symbol ? `:${r.symbol}` : ""}`).join("\n")}` : "No code references"}

${memory.evidenceExcerpt ? `Evidence:
${memory.evidenceExcerpt.slice(0, 200)}...` : ""}`;
}

function getMemoryTrail(memory: MemoryObject): string {
  if (!memory.evidenceEventIds || memory.evidenceEventIds.length === 0) {
    return "No event trail available for this memory.";
  }

  try {
    const db = getConnection(currentProject!);
    const eventStore = new EventStore(db);
    
    let trail = `Event Trail for Memory: ${memory.id}\n`;
    trail += "━".repeat(50) + "\n\n";
    
    for (const eventId of memory.evidenceEventIds) {
      const event = eventStore.get(eventId);
      if (event) {
        const content = eventStore.getContent(event);
        trail += `📌 ${event.eventType.toUpperCase()} - ${new Date(event.timestamp).toLocaleString()}\n`;
        if (event.toolName) trail += `   Tool: ${event.toolName}\n`;
        trail += `   ${content?.slice(0, 200) || "(no content)"}...\n\n`;
      }
    }
    
    return trail;
  } catch (error) {
    return `Failed to load trail: ${error}`;
  }
}

function updateStatusBar() {
  const memoryCount = currentMemories.length;
  const pendingCount = currentMemories.filter(m => m.reviewStatus === "pending").length;
  const projectName = currentProject ? currentProject.split("/").pop() : "No project";
  
  statusBar.content = t`${fg("#888888")(`Project: ${projectName} | Memories: ${memoryCount} | Pending: ${pendingCount} | Mode: ${viewMode}`)}`; 
}

function updateHelpText() {
  helpText.content = t`${fg("#666666")(`[Tab] Switch projects | [↑↓] Navigate | [Enter] Select | [v] Verify | [r] Retire | [t] Trail | [d] Detail | [q] Quit`)}`;
}

function switchToProject(dbPath: string) {
  if (!dbPath) return;
  
  currentProject = dbPath;
  currentMemories = loadMemories(dbPath);
  selectedMemoryIndex = 0;
  
  // Update memory list
  memoryList.options = getMemoryOptions();
  memoryList.setSelectedIndex(0);
  
  updateStatusBar();
  updateDetailPanel();
}

function updateDetailPanel() {
  if (currentMemories.length === 0 || selectedMemoryIndex >= currentMemories.length) {
    detailText.content = "No memory selected";
    trailText.content = "";
    return;
  }
  
  const memory = currentMemories[selectedMemoryIndex];
  detailText.content = getMemoryDetail(memory);
  
  if (viewMode === "trail") {
    trailText.content = getMemoryTrail(memory);
    trailPanel.visible = true;
    detailPanel.visible = false;
  } else {
    trailPanel.visible = false;
    detailPanel.visible = true;
  }
}

async function verifyMemory(memory: MemoryObject) {
  try {
    const db = getConnection(currentProject!);
    const store = new MemoryObjectStore(db);
    store.update(memory.id, { reviewStatus: "approved" });
    
    // Reload
    currentMemories = loadMemories(currentProject!);
    memoryList.options = getMemoryOptions();
    updateDetailPanel();
    updateStatusBar();
  } catch (error) {
    console.error("Failed to verify:", error);
  }
}

async function retireMemory(memory: MemoryObject) {
  try {
    const db = getConnection(currentProject!);
    const store = new MemoryObjectStore(db);
    store.update(memory.id, { status: "retired" });
    
    // Reload
    currentMemories = loadMemories(currentProject!);
    memoryList.options = getMemoryOptions();
    updateDetailPanel();
    updateStatusBar();
  } catch (error) {
    console.error("Failed to retire:", error);
  }
}

function handleKeypress(key: KeyEvent) {
  // Global keys
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    renderer.stop();
    process.exit(0);
  }
  
  if (key.name === "tab") {
    // Toggle focus between tabs and list
    if (projectTabs.focused) {
      projectTabs.blur();
      memoryList.focus();
    } else {
      memoryList.blur();
      projectTabs.focus();
    }
    return;
  }
  
  // When memory list is focused
  if (memoryList.focused && currentMemories.length > 0) {
    const memory = currentMemories[selectedMemoryIndex];
    
    if (key.name === "v") {
      verifyMemory(memory);
      return;
    }
    
    if (key.name === "r") {
      retireMemory(memory);
      return;
    }
    
    if (key.name === "t") {
      viewMode = viewMode === "trail" ? "list" : "trail";
      updateDetailPanel();
      updateStatusBar();
      return;
    }
    
    if (key.name === "d") {
      viewMode = "detail";
      updateDetailPanel();
      updateStatusBar();
      return;
    }
  }
}

export async function runTUI() {
  renderer = await createCliRenderer({
    consoleOptions: {
      startInDebugMode: false,
    },
  });
  
  renderer.setBackgroundColor("#0d1117");
  
  // Header
  const header = new TextRenderable(renderer, {
    id: "header",
    content: t`${bold(fg("#58a6ff")("📚 Alexandria Memory System"))}`,
    position: "absolute",
    left: 2,
    top: 0,
  });
  renderer.root.add(header);
  
  // Project tabs
  const projects = getProjects();
  projectTabs = new TabSelectRenderable(renderer, {
    id: "project-tabs",
    position: "absolute",
    left: 0,
    top: 2,
    width: "100%",
    options: projects,
    tabWidth: 20,
    backgroundColor: "#161b22",
    focusedBackgroundColor: "#21262d",
    textColor: "#8b949e",
    focusedTextColor: "#c9d1d9",
    selectedBackgroundColor: "#238636",
    selectedTextColor: "#ffffff",
    showDescription: false,
    showScrollArrows: true,
  });
  renderer.root.add(projectTabs);
  
  // Memory list (left panel)
  memoryList = new SelectRenderable(renderer, {
    id: "memory-list",
    position: "absolute",
    left: 0,
    top: 5,
    width: "50%",
    height: "70%",
    options: [],
    backgroundColor: "#0d1117",
    focusedBackgroundColor: "#161b22",
    textColor: "#c9d1d9",
    focusedTextColor: "#ffffff",
    selectedBackgroundColor: "#21262d",
    showDescription: true,
  });
  renderer.root.add(memoryList);
  
  // Detail panel (right panel)
  detailPanel = new BoxRenderable(renderer, {
    id: "detail-panel",
    position: "absolute",
    left: "50%",
    top: 5,
    width: "50%",
    height: "70%",
    backgroundColor: "#161b22",
    borderStyle: "single",
    borderColor: "#30363d",
    title: "Memory Details",
    titleAlignment: "left",
    padding: 1,
  });
  renderer.root.add(detailPanel);
  
  detailText = new TextRenderable(renderer, {
    id: "detail-text",
    content: "Select a memory to view details",
    fg: "#c9d1d9",
    width: "100%",
    height: "100%",
  });
  detailPanel.add(detailText);
  
  // Trail panel (hidden by default)
  trailPanel = new BoxRenderable(renderer, {
    id: "trail-panel",
    position: "absolute",
    left: "50%",
    top: 5,
    width: "50%",
    height: "70%",
    backgroundColor: "#161b22",
    borderStyle: "single",
    borderColor: "#30363d",
    title: "Event Trail",
    titleAlignment: "left",
    padding: 1,
    visible: false,
  });
  renderer.root.add(trailPanel);
  
  trailText = new TextRenderable(renderer, {
    id: "trail-text",
    content: "",
    fg: "#c9d1d9",
    width: "100%",
    height: "100%",
  });
  trailPanel.add(trailText);
  
  // Status bar
  statusBar = new TextRenderable(renderer, {
    id: "status-bar",
    content: "",
    position: "absolute",
    left: 0,
    bottom: 1,
    width: "100%",
    fg: "#8b949e",
    backgroundColor: "#161b22",
  });
  renderer.root.add(statusBar);
  
  // Help text
  helpText = new TextRenderable(renderer, {
    id: "help-text",
    content: "",
    position: "absolute",
    left: 0,
    bottom: 0,
    width: "100%",
    fg: "#6e7681",
  });
  renderer.root.add(helpText);
  
  // Event handlers
  projectTabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index: number, option: TabSelectOption) => {
    if (option.value) {
      switchToProject(option.value as string);
    }
  });
  
  memoryList.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
    selectedMemoryIndex = index;
    updateDetailPanel();
  });
  
  memoryList.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
    selectedMemoryIndex = index;
    viewMode = "detail";
    updateDetailPanel();
    updateStatusBar();
  });
  
  renderer.keyInput.on("keypress", handleKeypress);
  
  // Initialize
  if (projects.length > 0 && projects[0].value) {
    switchToProject(projects[0].value as string);
  }
  
  updateHelpText();
  memoryList.focus();
  
  // Start renderer
  renderer.start();
}

// Run if executed directly
if (import.meta.main) {
  runTUI().catch(console.error);
}
