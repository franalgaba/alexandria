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
  ScrollBoxRenderable,
  SelectRenderableEvents,
  TabSelectRenderableEvents,
  type CliRenderer,
  type SelectOption,
  type TabSelectOption,
  type KeyEvent,
  type MouseEvent,
  t,
  bold,
  fg,
  underline,
} from "@opentui/core";
import { getConnection, listProjectDatabases, closeConnection } from "../stores/connection.ts";
import { MemoryObjectStore } from "../stores/memory-objects.ts";
import { EventStore } from "../stores/events.ts";
import { ReviewPipeline } from "../reviewer/index.ts";
import { Retriever } from "../retriever/index.ts";
import { ProgressiveRetriever, type ContextLevel } from "../retriever/progressive.ts";
import { formatContextPack } from "../utils/format.ts";
import type { MemoryObject, ObjectType, Confidence } from "../types/memory-objects.ts";
import type { ScopeType } from "../types/common.ts";
import type { Event, EventType } from "../types/events.ts";

// State
let renderer: CliRenderer;
let currentProject: string | null = null;
let currentMemories: MemoryObject[] = [];
let selectedMemoryIndex = 0;
let viewMode: "list" | "detail" | "trail" = "list";

// Input modes
type InputMode = "normal" | "add" | "search" | "pack" | "filter";
let inputMode: InputMode = "normal";
let filterSelectedIndex = 0;
let inputBuffer = "";
let inputCursorVisible = true;

// Add mode state
const MEMORY_TYPES: ObjectType[] = ["decision", "preference", "convention", "known_fix", "constraint", "failed_attempt", "environment"];
const CONFIDENCE_LEVELS: Confidence[] = ["certain", "high", "medium", "low"];
const SCOPE_TYPES: ScopeType[] = ["global", "project", "module", "file"];
const PACK_LEVELS: ContextLevel[] = ["minimal", "task", "deep"];

type AddStep = "content" | "type" | "confidence" | "scope" | "approve" | "confirm";
let addStep: AddStep = "content";
let addData: {
  content: string;
  type: ObjectType;
  confidence: Confidence;
  scope: ScopeType;
  autoApprove: boolean;
} = { content: "", type: "decision", confidence: "medium", scope: "project", autoApprove: false };
let addSelectedIndex = 0;

// Search mode state
let searchResults: MemoryObject[] = [];
let isSearching = false;

// Pack mode state
let packSelectedLevel = 0;
let packOutput = "";

// Exit state
let isExiting = false;

// Auto-refresh state
let refreshInterval: ReturnType<typeof setInterval> | null = null;
const REFRESH_INTERVAL_MS = 3000; // Refresh every 3 seconds

// Debug console state
let debugConsoleVisible = true;
let debugLogs: DebugLogEntry[] = [];
const MAX_DEBUG_LOGS = 100;
let lastSeenEventId: string | null = null;
let lastSeenMemoryCount = 0;
let debugRefreshInterval: ReturnType<typeof setInterval> | null = null;
const DEBUG_REFRESH_INTERVAL_MS = 500; // Check for new events/memories every 500ms

// Debug panel resize state
let debugPanelHeightPercent = 20; // Default 20% height
const DEBUG_PANEL_MIN_HEIGHT = 8; // Minimum 8%
const DEBUG_PANEL_MAX_HEIGHT = 60; // Maximum 60%
let isResizingDebugPanel = false;
let lastMouseY = 0;

// Debug log categories:
// - "recv_prompt"    : User prompt received from agent
// - "recv_response"  : Assistant response received from agent
// - "recv_tool"      : Tool call/output received from agent
// - "inject_context" : Context pack injected to agent
// - "inject_memory"  : Specific memories injected to agent
// - "store_memory"   : New memory created and stored
// - "store_pending"  : Memory stored as pending review
// - "info"           : System info messages
type DebugLogType = 
  | "recv_prompt" 
  | "recv_response" 
  | "recv_tool" 
  | "inject_context"
  | "inject_memory"
  | "store_memory"
  | "store_pending"
  | "info";

interface DebugLogEntry {
  timestamp: Date;
  type: DebugLogType;
  message: string;
  details?: string;
}

// UI Elements
let projectTabs: TabSelectRenderable;
let memoryList: SelectRenderable;
let detailPanel: ScrollBoxRenderable;
let detailText: TextRenderable;
let trailPanel: ScrollBoxRenderable;
let trailText: TextRenderable;
let statusBar: TextRenderable;
let helpText: TextRenderable;

// Input mode UI elements
let inputPanel: ScrollBoxRenderable;
let inputText: TextRenderable;

// Debug console UI elements
let debugPanel: ScrollBoxRenderable;
let debugText: TextRenderable;

// Type abbreviations (clean, no emojis)
const TYPE_ABBREV: Record<string, string> = {
  decision: "DEC",
  constraint: "CON",
  convention: "CNV",
  known_fix: "FIX",
  failed_attempt: "FAL",
  preference: "PRF",
  environment: "ENV",
};

// Review status indicators
const REVIEW_INDICATOR: Record<string, string> = {
  pending: "?",
  approved: "+",
  rejected: "-",
};

// Memory status indicators
const STATUS_INDICATOR: Record<string, string> = {
  active: " ",
  stale: "~",
  superseded: "^",
  retired: "x",
};

// Filter state
type FilterState = {
  hideRetired: boolean;
  typeFilter: ObjectType | null;
  reviewFilter: "pending" | "approved" | "rejected" | null;
};
let filters: FilterState = {
  hideRetired: true, // Hide retired by default
  typeFilter: null,
  reviewFilter: null,
};

// Feedback message state
let feedbackMessage = "";
let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

// ============ Debug Console Functions ============

function addDebugLog(type: DebugLogType, message: string, details?: string) {
  debugLogs.push({
    timestamp: new Date(),
    type,
    message: message.slice(0, 200),
    details: details?.slice(0, 500),
  });
  
  // Keep bounded - remove oldest entries from the start
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs = debugLogs.slice(-MAX_DEBUG_LOGS);
  }
  
  updateDebugPanel();
}

function getDebugTypeLabel(type: DebugLogType): { icon: string; label: string; color: string } {
  switch (type) {
    // RECEIVED from agent (incoming data)
    case "recv_prompt":
      return { icon: "▼", label: "RECV", color: "#7ee787" };  // Green - user input
    case "recv_response":
      return { icon: "▼", label: "RECV", color: "#d2a8ff" };  // Purple - assistant output
    case "recv_tool":
      return { icon: "▼", label: "RECV", color: "#ffa657" };  // Orange - tool activity
    
    // INJECTED to agent (outgoing context)
    case "inject_context":
      return { icon: "▲", label: "INJECT", color: "#58a6ff" };  // Blue - context pack
    case "inject_memory":
      return { icon: "▲", label: "INJECT", color: "#79c0ff" };  // Light blue - specific memory
    
    // STORED in database
    case "store_memory":
      return { icon: "★", label: "STORE", color: "#3fb950" };  // Bright green - approved
    case "store_pending":
      return { icon: "★", label: "STORE", color: "#d29922" };  // Yellow - pending review
    
    // System info
    case "info":
      return { icon: "•", label: "INFO", color: "#6e7681" };  // Gray
    
    default:
      return { icon: " ", label: "???", color: "#c9d1d9" };
  }
}

function updateDebugPanel() {
  if (!debugText || !debugPanel) return;
  
  // Get terminal width for proper formatting
  const terminalWidth = process.stdout.columns || 80;
  const contentWidth = terminalWidth - 4; // Account for borders and padding
  
  if (debugLogs.length === 0) {
    debugText.content = t`${fg("#6e7681")("Waiting for agent activity...")}

${fg("#6e7681")("▼ RECV   = Data received from coding agent")}
${fg("#6e7681")("▲ INJECT = Context sent back to agent")}
${fg("#6e7681")("★ STORE  = Memory saved to database")}`;
    return;
  }
  
  const lines: string[] = [];
  // Show last N entries, oldest at top, newest at bottom
  const visibleLogs = debugLogs.slice(-15); // Take last 15, already in chronological order
  
  for (const log of visibleLogs) {
    const time = log.timestamp.toLocaleTimeString("en-US", { 
      hour12: false, 
      hour: "2-digit", 
      minute: "2-digit", 
      second: "2-digit" 
    });
    const { icon, label } = getDebugTypeLabel(log.type);
    
    // Format: [HH:MM:SS] ▼ RECV   prompt: "user message..."
    const prefix = `[${time}] ${icon} ${label.padEnd(6)} `;
    const messageMaxLen = contentWidth - prefix.length;
    const message = log.message.length > messageMaxLen 
      ? log.message.slice(0, messageMaxLen - 3) + "..."
      : log.message;
    
    lines.push(`${prefix}${message}`);
    
    if (log.details) {
      // Indent details with proper spacing, use full width
      const detailIndent = "                  ";
      const detailMaxLen = contentWidth - detailIndent.length - 2; // -2 for quotes
      const detailPreview = log.details.slice(0, detailMaxLen).replace(/\n/g, " ");
      lines.push(`${detailIndent}"${detailPreview}${log.details.length > detailMaxLen ? "..." : ""}"`);
    }
  }
  
  debugText.content = lines.join("\n");
}

function checkForNewEvents() {
  if (!currentProject || inputMode !== "normal") return;
  
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(currentProject);
    
    // Check for new events (data RECEIVED from agent)
    const eventStore = new EventStore(db);
    const recentEvents = eventStore.getRecent(10);
    
    if (recentEvents.length > 0) {
      const latestEvent = recentEvents[0];
      
      // If we have a new event
      if (lastSeenEventId !== latestEvent.id) {
        // Log all new events since last check (in reverse to show oldest first)
        const newEvents = [];
        for (const event of recentEvents) {
          if (event.id === lastSeenEventId) break;
          newEvents.push(event);
        }
        
        // Process oldest to newest
        for (const event of newEvents.reverse()) {
          const eventType = event.eventType;
          const content = eventStore.getContent(event) || "(no content)";
          const preview = content.slice(0, 100).replace(/\n/g, " ");
          
          // Classify what was RECEIVED from the agent
          if (eventType === "user_prompt" || content.startsWith("[user]:")) {
            addDebugLog("recv_prompt", "user prompt", preview);
          } else if (eventType === "assistant_response" || content.startsWith("[assistant]:")) {
            addDebugLog("recv_response", "assistant response", preview);
          } else if (eventType === "tool_call") {
            addDebugLog("recv_tool", `tool call → ${event.toolName || "unknown"}`, preview);
          } else if (eventType === "tool_output") {
            const exitInfo = event.exitCode !== undefined && event.exitCode !== 0 ? ` [exit:${event.exitCode}]` : "";
            addDebugLog("recv_tool", `tool result ← ${event.toolName || "unknown"}${exitInfo}`, preview);
          } else if (eventType === "context_injection" || eventType === "context_pack") {
            // Context was INJECTED to agent
            addDebugLog("inject_context", "context pack sent to agent", preview);
          } else if (eventType === "memory_injection") {
            addDebugLog("inject_memory", "memories sent to agent", preview);
          } else {
            addDebugLog("recv_tool", `${eventType}`, preview);
          }
        }
        lastSeenEventId = latestEvent.id;
      }
    }
    
    // Check for new memories (data STORED in database)
    const memoryStore = new MemoryObjectStore(db);
    const allMemories = memoryStore.list({ limit: 1000 });
    const currentMemoryCount = allMemories.length;
    
    if (currentMemoryCount > lastSeenMemoryCount) {
      const newCount = currentMemoryCount - lastSeenMemoryCount;
      // Get the newest memories (they should be at the start if sorted by createdAt desc)
      const recentMemories = allMemories.slice(0, newCount);
      
      // Process oldest to newest
      for (const memory of recentMemories.reverse()) {
        const typeAbbrev = TYPE_ABBREV[memory.objectType] || "???";
        const typeName = memory.objectType.replace("_", " ");
        
        if (memory.reviewStatus === "approved") {
          addDebugLog(
            "store_memory", 
            `[${typeAbbrev}] ${typeName} (approved)`,
            memory.content.slice(0, 100)
          );
        } else {
          addDebugLog(
            "store_pending", 
            `[${typeAbbrev}] ${typeName} (pending review)`,
            memory.content.slice(0, 100)
          );
        }
      }
      
      lastSeenMemoryCount = currentMemoryCount;
    }
    
    db.close();
  } catch (error) {
    // Silently ignore errors
  }
}

function startDebugRefresh() {
  if (debugRefreshInterval) return;
  debugRefreshInterval = setInterval(checkForNewEvents, DEBUG_REFRESH_INTERVAL_MS);
}

function stopDebugRefresh() {
  if (debugRefreshInterval) {
    clearInterval(debugRefreshInterval);
    debugRefreshInterval = null;
  }
}

function toggleDebugConsole() {
  debugConsoleVisible = !debugConsoleVisible;
  debugPanel.visible = debugConsoleVisible;
  
  // Adjust main panel heights based on debug visibility
  updatePanelLayout();
  updateHelpText();
  showFeedback(debugConsoleVisible ? "Debug console shown [drag top border to resize]" : "Debug console hidden");
}

function updatePanelLayout() {
  // Calculate main panel height based on debug console visibility and size
  // Reserve ~3 lines for status bar and help text at bottom
  const reservedBottom = 5; // percentage for status/help
  const mainHeight = debugConsoleVisible 
    ? `${100 - debugPanelHeightPercent - reservedBottom}%` 
    : "70%";
  
  memoryList.height = mainHeight;
  detailPanel.height = mainHeight;
  trailPanel.height = mainHeight;
  inputPanel.height = mainHeight;
  
  if (debugPanel) {
    debugPanel.height = `${debugPanelHeightPercent}%`;
  }
}

function getDebugPanelTopRow(): number {
  const terminalHeight = process.stdout.rows || 24;
  // Debug panel is at bottom: 3 (for status/help) + height%
  // So top row = terminalHeight - 3 - (height% of terminalHeight)
  const debugHeightRows = Math.floor(terminalHeight * debugPanelHeightPercent / 100);
  return terminalHeight - 3 - debugHeightRows;
}

function resizeDebugPanel(delta: number) {
  const newHeight = debugPanelHeightPercent + delta;
  if (newHeight >= DEBUG_PANEL_MIN_HEIGHT && newHeight <= DEBUG_PANEL_MAX_HEIGHT) {
    debugPanelHeightPercent = newHeight;
    updatePanelLayout();
  }
}

function startDebugPanelResize(y: number) {
  isResizingDebugPanel = true;
  lastMouseY = y;
  
  // Change border color to indicate resize mode
  if (debugPanel) {
    debugPanel.borderColor = "#58a6ff";
    debugPanel.title = "Live Debug Console [resizing... release to finish]";
  }
}

function endDebugPanelResize() {
  if (!isResizingDebugPanel) return;
  isResizingDebugPanel = false;
  
  // Restore border color
  if (debugPanel) {
    debugPanel.borderColor = "#30363d";
    debugPanel.title = "Live Debug Console [+/- to resize, Shift+D to hide]";
  }
}

function handleDebugPanelDrag(y: number) {
  if (!isResizingDebugPanel) return;
  
  const terminalHeight = process.stdout.rows || 24;
  
  // Calculate delta from last position (not start position)
  // Moving up (smaller y) = larger panel
  const deltaY = lastMouseY - y;
  
  if (deltaY !== 0) {
    const deltaPercent = (deltaY / terminalHeight) * 100;
    const newHeight = debugPanelHeightPercent + deltaPercent;
    
    if (newHeight >= DEBUG_PANEL_MIN_HEIGHT && newHeight <= DEBUG_PANEL_MAX_HEIGHT) {
      debugPanelHeightPercent = Math.round(newHeight);
      updatePanelLayout();
    }
    lastMouseY = y;
  }
}

function applyFilters(memories: MemoryObject[]): MemoryObject[] {
  return memories.filter(m => {
    if (filters.hideRetired && m.status === "retired") return false;
    if (filters.typeFilter && m.objectType !== filters.typeFilter) return false;
    if (filters.reviewFilter && m.reviewStatus !== filters.reviewFilter) return false;
    return true;
  });
}

function getFilterSummary(): string {
  const parts: string[] = [];
  if (filters.hideRetired) parts.push("hiding retired");
  if (filters.typeFilter) parts.push(`type:${filters.typeFilter}`);
  if (filters.reviewFilter) parts.push(`review:${filters.reviewFilter}`);
  return parts.length > 0 ? parts.join(", ") : "no filters";
}

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
    // Newest first (default from database ORDER BY created_at DESC)
    return memories;
  } catch (error) {
    console.error("Failed to load memories:", error);
    return [];
  }
}

function showFeedback(message: string, durationMs = 2000) {
  feedbackMessage = message;
  updateStatusBar();
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  feedbackTimeout = setTimeout(() => {
    feedbackMessage = "";
    updateStatusBar();
  }, durationMs);
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  // For older dates, show short date
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getMemoryOptions(): SelectOption[] {
  const filtered = applyFilters(currentMemories);
  if (filtered.length === 0) {
    const msg = currentMemories.length === 0 ? "No memories" : "No matches (adjust filters)";
    return [{ name: msg, description: "[f] to change filters", value: "" }];
  }

  return filtered.map((m) => {
    const type = TYPE_ABBREV[m.objectType] || "???";
    const review = REVIEW_INDICATOR[m.reviewStatus] || " ";
    const status = STATUS_INDICATOR[m.status] || " ";
    const content = m.content.length > 45 ? m.content.slice(0, 42) + "..." : m.content;
    const timeAgo = formatRelativeTime(m.createdAt);
    return {
      name: `[${review}] ${content}`,
      description: `${type} | ${m.confidence} | ${timeAgo}`,
      value: m.id,
    };
  });
}

function getMemoryDetail(memory: MemoryObject): string {
  const type = TYPE_ABBREV[memory.objectType] || "???";
  const review = REVIEW_INDICATOR[memory.reviewStatus] || " ";

  return `[${type}] ${memory.objectType.toUpperCase()} [${review}] ${memory.reviewStatus}

${memory.content}

────────────────────────────────────────

ID: ${memory.id}
Status: ${memory.status}
Confidence: ${memory.confidence} (${memory.confidenceTier || "unknown"})
Scope: ${memory.scope.type}${memory.scope.path ? ` - ${memory.scope.path}` : ""}
Created: ${new Date(memory.createdAt).toLocaleString()}
Updated: ${new Date(memory.updatedAt).toLocaleString()}
Access Count: ${memory.accessCount}

${memory.codeRefs && memory.codeRefs.length > 0 ? `Code References:
${memory.codeRefs.map(r => `  - ${r.path}${r.symbol ? `:${r.symbol}` : ""}`).join("\n")}` : ""}`;
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
        trail += `* ${event.eventType.toUpperCase()} - ${new Date(event.timestamp).toLocaleString()}\n`;
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
  const filtered = applyFilters(currentMemories);
  const totalCount = currentMemories.length;
  const shownCount = filtered.length;
  const projectName = currentProject ? currentProject.split("/").pop()?.slice(0, 15) : "No project";

  if (feedbackMessage) {
    statusBar.content = t`${fg("#58a6ff")(feedbackMessage)}`;
  } else {
    const filterInfo = shownCount < totalCount ? `${shownCount}/${totalCount}` : `${totalCount}`;
    statusBar.content = t`${fg("#888888")(`${projectName} | ${filterInfo} memories | ${getFilterSummary()}`)}`;
  }
}

function updateHelpText() {
  if (inputMode === "add") {
    if (addStep === "content") {
      helpText.content = t`${fg("#666666")(`[Enter] Next | [Esc] Cancel`)}`;
    } else if (addStep === "confirm") {
      helpText.content = t`${fg("#666666")(`[Enter] Save | [Esc] Cancel`)}`;
    } else {
      helpText.content = t`${fg("#666666")(`[↑↓] Select | [Enter] Next | [Esc] Cancel`)}`;
    }
  } else if (inputMode === "search") {
    helpText.content = t`${fg("#666666")(`[Enter] Search | [↑↓] Navigate results | [Esc] Cancel`)}`;
  } else if (inputMode === "pack") {
    helpText.content = t`${fg("#666666")(`[↑↓] Select level | [Enter] Generate | [Esc] Cancel`)}`;
  } else if (inputMode === "filter") {
    helpText.content = t`${fg("#666666")(`[↑↓] Select | [Enter/Space] Toggle | [Esc] Close`)}`;
  } else {
    const debugInfo = debugConsoleVisible ? `[D]:on [+/-]:${debugPanelHeightPercent}%` : "[D]:off";
    helpText.content = t`${fg("#666666")(`[a]dd [s]earch [p]ack [f]ilter | [v]erify [r]etire [R]efresh | ${debugInfo} [q]uit`)}`;
  }
}

function switchToProject(dbPath: string) {
  if (!dbPath) return;

  currentProject = dbPath;
  currentMemories = loadMemories(dbPath);
  selectedMemoryIndex = 0;

  // Update memory list
  memoryList.options = getMemoryOptions();
  memoryList.setSelectedIndex(0);

  // Initialize debug tracking for this project
  initializeDebugTracking(dbPath);

  updateStatusBar();
  updateDetailPanel();
}

function initializeDebugTracking(dbPath: string) {
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath);
    
    // Get current event count and last event ID
    const eventStore = new EventStore(db);
    const recentEvents = eventStore.getRecent(1);
    if (recentEvents.length > 0) {
      lastSeenEventId = recentEvents[0].id;
    } else {
      lastSeenEventId = null;
    }
    
    // Get current memory count
    const memoryStore = new MemoryObjectStore(db);
    lastSeenMemoryCount = memoryStore.list({ limit: 1000 }).length;
    
    db.close();
    
    addDebugLog("info", `Connected to project: ${dbPath.split("/").pop()}`);
  } catch (error) {
    addDebugLog("info", `Failed to initialize tracking: ${error}`);
  }
}

function refreshMemories() {
  // Don't refresh if in input mode or no project selected
  if (inputMode !== "normal" || !currentProject) return;

  // Remember current selection by ID
  const filtered = applyFilters(currentMemories);
  const currentId = filtered.length > 0 && selectedMemoryIndex < filtered.length
    ? filtered[selectedMemoryIndex].id
    : null;

  // Reload memories
  const newMemories = loadMemories(currentProject);

  // Check if anything changed
  if (newMemories.length === currentMemories.length) {
    const unchanged = newMemories.every((m, i) =>
      currentMemories[i]?.id === m.id &&
      currentMemories[i]?.status === m.status &&
      currentMemories[i]?.reviewStatus === m.reviewStatus
    );
    if (unchanged) return; // No changes, skip update
  }

  currentMemories = newMemories;
  memoryList.options = getMemoryOptions();

  // Try to restore selection by ID
  if (currentId) {
    const newFiltered = applyFilters(currentMemories);
    const newIndex = newFiltered.findIndex(m => m.id === currentId);
    if (newIndex >= 0) {
      selectedMemoryIndex = newIndex;
    } else {
      // Memory was filtered out, adjust index
      selectedMemoryIndex = Math.min(selectedMemoryIndex, Math.max(0, newFiltered.length - 1));
    }
  } else {
    selectedMemoryIndex = 0;
  }

  memoryList.setSelectedIndex(selectedMemoryIndex);
  updateStatusBar();
  updateDetailPanel();
}

function startAutoRefresh() {
  if (refreshInterval) return;
  refreshInterval = setInterval(refreshMemories, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

function updateDetailPanel() {
  const filtered = applyFilters(currentMemories);
  if (filtered.length === 0 || selectedMemoryIndex >= filtered.length) {
    detailText.content = "No memory selected";
    trailText.content = "";
    return;
  }

  const memory = filtered[selectedMemoryIndex];
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

// ============ Input Mode Functions ============

function enterAddMode() {
  inputMode = "add";
  addStep = "content";
  addData = { content: "", type: "decision", confidence: "medium", scope: "project", autoApprove: false };
  addSelectedIndex = 0;
  inputBuffer = "";
  showInputPanel();
  updateInputPanel();
  updateHelpText();
}

function enterSearchMode() {
  inputMode = "search";
  inputBuffer = "";
  searchResults = [];
  showInputPanel();
  updateInputPanel();
  updateHelpText();
}

function enterPackMode() {
  inputMode = "pack";
  packSelectedLevel = 1; // Default to "task"
  packOutput = "";
  showInputPanel();
  updateInputPanel();
  updateHelpText();
}

function exitInputMode() {
  inputMode = "normal";
  inputBuffer = "";
  hideInputPanel();
  // Restore original memories if we were searching
  if (searchResults.length > 0) {
    currentMemories = loadMemories(currentProject!);
    memoryList.options = getMemoryOptions();
    searchResults = [];
  }
  updateHelpText();
  updateStatusBar();
}

function showInputPanel() {
  inputPanel.visible = true;
  detailPanel.visible = false;
  trailPanel.visible = false;
  memoryList.blur();
  projectTabs.blur();
}

function hideInputPanel() {
  inputPanel.visible = false;
  detailPanel.visible = true;
  memoryList.focus();
}

function updateInputPanel() {
  if (inputMode === "add") {
    updateAddPanel();
  } else if (inputMode === "search") {
    updateSearchPanel();
  } else if (inputMode === "pack") {
    updatePackPanel();
  } else if (inputMode === "filter") {
    updateFilterPanel();
  }
}

function enterFilterMode() {
  inputMode = "filter";
  filterSelectedIndex = 0;
  showInputPanel();
  updateInputPanel();
  updateHelpText();
}

function updateFilterPanel() {
  let content = "FILTER MEMORIES\n";
  content += "─".repeat(35) + "\n\n";

  const options = [
    {
      label: `Hide retired: ${filters.hideRetired ? "ON" : "OFF"}`,
      desc: "Toggle hiding retired memories",
    },
    {
      label: `Type: ${filters.typeFilter || "all"}`,
      desc: "Filter by memory type",
    },
    {
      label: `Review: ${filters.reviewFilter || "all"}`,
      desc: "Filter by review status",
    },
    {
      label: "Clear all filters",
      desc: "Reset to defaults",
    },
  ];

  options.forEach((opt, i) => {
    const selected = i === filterSelectedIndex;
    const prefix = selected ? "> " : "  ";
    content += `${prefix}${opt.label}\n`;
    content += `       ${opt.desc}\n\n`;
  });

  const filtered = applyFilters(currentMemories);
  content += "─".repeat(35) + "\n";
  content += `Showing ${filtered.length} of ${currentMemories.length} memories`;

  inputText.content = content;
}

async function handleFilterInput(key: KeyEvent) {
  if (key.name === "escape") {
    exitInputMode();
    return;
  }

  if (key.name === "up") {
    filterSelectedIndex = Math.max(0, filterSelectedIndex - 1);
    updateInputPanel();
  } else if (key.name === "down") {
    filterSelectedIndex = Math.min(3, filterSelectedIndex + 1);
    updateInputPanel();
  } else if (key.name === "return" || key.name === "space") {
    handleFilterSelection();
  }
}

function handleFilterSelection() {
  if (filterSelectedIndex === 0) {
    // Toggle hide retired
    filters.hideRetired = !filters.hideRetired;
    memoryList.options = getMemoryOptions();
    updateInputPanel();
    updateStatusBar();
  } else if (filterSelectedIndex === 1) {
    // Cycle through type filters
    const types: (ObjectType | null)[] = [null, ...MEMORY_TYPES];
    const currentIdx = types.indexOf(filters.typeFilter);
    filters.typeFilter = types[(currentIdx + 1) % types.length];
    memoryList.options = getMemoryOptions();
    updateInputPanel();
    updateStatusBar();
  } else if (filterSelectedIndex === 2) {
    // Cycle through review filters
    const reviews: ("pending" | "approved" | "rejected" | null)[] = [null, "pending", "approved", "rejected"];
    const currentIdx = reviews.indexOf(filters.reviewFilter);
    filters.reviewFilter = reviews[(currentIdx + 1) % reviews.length];
    memoryList.options = getMemoryOptions();
    updateInputPanel();
    updateStatusBar();
  } else if (filterSelectedIndex === 3) {
    // Clear all filters
    filters = { hideRetired: true, typeFilter: null, reviewFilter: null };
    memoryList.options = getMemoryOptions();
    updateInputPanel();
    updateStatusBar();
    showFeedback("Filters cleared");
  }
}

function updateAddPanel() {
  const cursor = inputCursorVisible ? "|" : " ";
  const stepNum = { content: 1, type: 2, confidence: 3, scope: 4, approve: 5, confirm: 6 }[addStep];
  let content = `ADD MEMORY (${stepNum}/6)\n`;
  content += "─".repeat(35) + "\n\n";

  if (addStep === "content") {
    content += "What do you want to remember?\n\n";
    content += `> ${inputBuffer}${cursor}\n\n`;
    content += "Examples:\n";
    content += '  "Always use async/await instead of callbacks"\n';
    content += '  "Database connection requires SSL in production"\n';
  } else if (addStep === "type") {
    content += `Content: ${addData.content.slice(0, 40)}...\n\n`;
    content += "What kind of memory is this?\n\n";
    const typeDescriptions: Record<ObjectType, string> = {
      decision: "Technical choice with rationale",
      preference: "Style or approach preference",
      convention: "Coding standard or pattern",
      known_fix: "Solution that worked",
      constraint: "Hard rule or limitation",
      failed_attempt: "What didn't work",
      environment: "Config, version, or setup",
    };
    MEMORY_TYPES.forEach((type, i) => {
      const abbrev = TYPE_ABBREV[type] || "???";
      const selected = i === addSelectedIndex;
      const prefix = selected ? "> " : "  ";
      content += `${prefix}[${abbrev}] ${type}\n`;
      content += `       ${typeDescriptions[type]}\n`;
    });
  } else if (addStep === "confidence") {
    content += `Type: [${TYPE_ABBREV[addData.type]}] ${addData.type}\n\n`;
    content += "How confident are you in this?\n\n";
    const confDescriptions: Record<Confidence, string> = {
      certain: "Verified, documented, or proven",
      high: "Very likely correct",
      medium: "Reasonable assumption",
      low: "Hypothesis or guess",
    };
    CONFIDENCE_LEVELS.forEach((level, i) => {
      const selected = i === addSelectedIndex;
      const prefix = selected ? "> " : "  ";
      content += `${prefix}${level}\n`;
      content += `       ${confDescriptions[level]}\n`;
    });
  } else if (addStep === "scope") {
    content += `Confidence: ${addData.confidence}\n\n`;
    content += "Where does this apply?\n\n";
    const scopeDescriptions: Record<ScopeType, string> = {
      global: "Applies everywhere",
      project: "This project only",
      module: "Specific module/directory",
      file: "Single file",
    };
    SCOPE_TYPES.forEach((scope, i) => {
      const selected = i === addSelectedIndex;
      const prefix = selected ? "> " : "  ";
      content += `${prefix}${scope}\n`;
      content += `       ${scopeDescriptions[scope]}\n`;
    });
  } else if (addStep === "approve") {
    content += `Scope: ${addData.scope}\n\n`;
    content += "Auto-approve this memory?\n\n";
    const options = [
      { name: "Yes", desc: "Mark as approved immediately" },
      { name: "No", desc: "Keep as pending for review" },
    ];
    options.forEach((opt, i) => {
      const selected = i === addSelectedIndex;
      const prefix = selected ? "> " : "  ";
      content += `${prefix}${opt.name}\n`;
      content += `       ${opt.desc}\n`;
    });
  } else if (addStep === "confirm") {
    content += "REVIEW\n";
    content += "─".repeat(35) + "\n\n";
    content += `"${addData.content}"\n\n`;
    content += `Type:       [${TYPE_ABBREV[addData.type]}] ${addData.type}\n`;
    content += `Confidence: ${addData.confidence}\n`;
    content += `Scope:      ${addData.scope}\n`;
    content += `Status:     ${addData.autoApprove ? "approved" : "pending review"}\n\n`;
    content += "─".repeat(35) + "\n";
    content += "[Enter] Save    [Esc] Cancel";
  }

  inputText.content = content;
}

function updateSearchPanel() {
  const cursor = inputCursorVisible ? "|" : " ";
  let content = "SEARCH MEMORIES\n";
  content += "─".repeat(35) + "\n\n";
  content += "Enter your search query:\n\n";
  content += `> ${inputBuffer}${cursor}\n\n`;

  if (isSearching) {
    content += "Searching...";
  } else if (inputBuffer.length === 0) {
    content += "Tips:\n";
    content += "- Search by content, type, or keywords\n";
    content += '- Example: "database connection"\n';
    content += '- Example: "constraint ssl"\n';
  } else if (searchResults.length > 0) {
    content += `Found ${searchResults.length} result(s)\n\n`;
    // Show first few results inline
    const previewCount = Math.min(3, searchResults.length);
    for (let i = 0; i < previewCount; i++) {
      const m = searchResults[i];
      const abbrev = TYPE_ABBREV[m.objectType] || "???";
      content += `[${abbrev}] ${m.content.slice(0, 35)}...\n`;
    }
    if (searchResults.length > 3) {
      content += `   ...and ${searchResults.length - 3} more\n`;
    }
    content += "\nResults in left panel. [up/down] navigate, [Esc] close";
  } else if (inputBuffer.length > 0) {
    content += "[Enter] to search";
  }

  inputText.content = content;
}

function updatePackPanel() {
  let content = "GENERATE CONTEXT PACK\n";
  content += "─".repeat(35) + "\n\n";
  content += "Select Level:\n\n";

  const levelDescriptions: Record<ContextLevel, string> = {
    minimal: "Constraints only - fastest, smallest",
    task: "Task-relevant memories - balanced",
    deep: "Full context - comprehensive",
  };

  PACK_LEVELS.forEach((level, i) => {
    const selected = i === packSelectedLevel;
    const prefix = selected ? "> " : "  ";
    content += `${prefix}${level}\n`;
    content += `       ${levelDescriptions[level]}\n`;
  });

  if (packOutput) {
    content += "\n" + "─".repeat(35) + "\n\n";
    content += packOutput.slice(0, 500);
    if (packOutput.length > 500) content += "\n...";
  } else {
    content += "\n[Enter] to generate pack";
  }

  inputText.content = content;
}

async function handleAddInput(key: KeyEvent) {
  if (key.name === "escape") {
    exitInputMode();
    return;
  }

  if (addStep === "content") {
    if (key.name === "return" && inputBuffer.length > 0) {
      addData.content = inputBuffer;
      inputBuffer = "";
      addStep = "type";
      addSelectedIndex = 0;
      updateInputPanel();
    } else if (key.name === "backspace") {
      inputBuffer = inputBuffer.slice(0, -1);
      updateInputPanel();
    } else if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
      inputBuffer += key.sequence;
      updateInputPanel();
    }
  } else if (addStep === "type") {
    if (key.name === "up") {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateInputPanel();
    } else if (key.name === "down") {
      addSelectedIndex = Math.min(MEMORY_TYPES.length - 1, addSelectedIndex + 1);
      updateInputPanel();
    } else if (key.name === "return") {
      addData.type = MEMORY_TYPES[addSelectedIndex];
      addStep = "confidence";
      addSelectedIndex = 2; // Default to medium
      updateInputPanel();
    }
  } else if (addStep === "confidence") {
    if (key.name === "up") {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateInputPanel();
    } else if (key.name === "down") {
      addSelectedIndex = Math.min(CONFIDENCE_LEVELS.length - 1, addSelectedIndex + 1);
      updateInputPanel();
    } else if (key.name === "return") {
      addData.confidence = CONFIDENCE_LEVELS[addSelectedIndex];
      addStep = "scope";
      addSelectedIndex = 1; // Default to project
      updateInputPanel();
    }
  } else if (addStep === "scope") {
    if (key.name === "up") {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateInputPanel();
    } else if (key.name === "down") {
      addSelectedIndex = Math.min(SCOPE_TYPES.length - 1, addSelectedIndex + 1);
      updateInputPanel();
    } else if (key.name === "return") {
      addData.scope = SCOPE_TYPES[addSelectedIndex];
      addStep = "approve";
      addSelectedIndex = 1; // Default to No (pending review)
      updateInputPanel();
    }
  } else if (addStep === "approve") {
    if (key.name === "up") {
      addSelectedIndex = Math.max(0, addSelectedIndex - 1);
      updateInputPanel();
    } else if (key.name === "down") {
      addSelectedIndex = Math.min(1, addSelectedIndex + 1);
      updateInputPanel();
    } else if (key.name === "return") {
      addData.autoApprove = addSelectedIndex === 0; // 0 = Yes
      addStep = "confirm";
      updateInputPanel();
    }
  } else if (addStep === "confirm") {
    if (key.name === "return") {
      await saveMemory();
    }
  }
}

async function saveMemory() {
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
    currentMemories = loadMemories(currentProject);
    memoryList.options = getMemoryOptions();

    exitInputMode();
    const status = addData.autoApprove ? "approved" : "pending review";
    showFeedback(`+ Memory added (${status}): ${addData.content.slice(0, 30)}...`);
  } catch (error) {
    inputText.content = `Error: ${error}`;
  }
}

async function handleSearchInput(key: KeyEvent) {
  if (key.name === "escape") {
    exitInputMode();
    return;
  }

  if (key.name === "return" && inputBuffer.length > 0) {
    await performSearch();
  } else if (key.name === "backspace") {
    inputBuffer = inputBuffer.slice(0, -1);
    updateInputPanel();
  } else if (key.name === "up" && searchResults.length > 0) {
    // Navigate results while in search mode
    selectedMemoryIndex = Math.max(0, selectedMemoryIndex - 1);
    memoryList.setSelectedIndex(selectedMemoryIndex);
    updateDetailPanel();
  } else if (key.name === "down" && searchResults.length > 0) {
    selectedMemoryIndex = Math.min(searchResults.length - 1, selectedMemoryIndex + 1);
    memoryList.setSelectedIndex(selectedMemoryIndex);
    updateDetailPanel();
  } else if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
    inputBuffer += key.sequence;
    updateInputPanel();
  }
}

async function performSearch() {
  if (!currentProject || inputBuffer.length === 0) return;

  isSearching = true;
  updateInputPanel();

  try {
    const db = getConnection(currentProject);
    const retriever = new Retriever(db);

    const results = await retriever.search(inputBuffer, { limit: 20 });
    searchResults = results.map(r => r.object);

    if (searchResults.length === 0) {
      // No results - show message but don't change memory list
      isSearching = false;
      let content = "SEARCH MEMORIES\n";
      content += "─".repeat(35) + "\n\n";
      content += `Query: ${inputBuffer}\n\n`;
      content += "No results found.\n\n";
      content += "Try different keywords or check spelling.";
      inputText.content = content;
      return;
    }

    // Update memory list with search results
    currentMemories = searchResults;
    memoryList.options = getMemoryOptions();
    selectedMemoryIndex = 0;
    memoryList.setSelectedIndex(0);

    isSearching = false;
    updateInputPanel();
    updateStatusBar();
  } catch (error) {
    isSearching = false;
    inputText.content = `Search error: ${error}`;
  }
}

async function handlePackInput(key: KeyEvent) {
  if (key.name === "escape") {
    exitInputMode();
    return;
  }

  if (key.name === "up") {
    packSelectedLevel = Math.max(0, packSelectedLevel - 1);
    updateInputPanel();
  } else if (key.name === "down") {
    packSelectedLevel = Math.min(PACK_LEVELS.length - 1, packSelectedLevel + 1);
    updateInputPanel();
  } else if (key.name === "return") {
    await generatePack();
  }
}

async function generatePack() {
  if (!currentProject) return;

  const level = PACK_LEVELS[packSelectedLevel];
  packOutput = "Generating...";
  updateInputPanel();

  try {
    const db = getConnection(currentProject);
    const progressive = new ProgressiveRetriever(db);

    const pack = await progressive.getContext(level, { tokenBudget: 1500 });
    const output = formatContextPack(pack, "yaml");

    packOutput = output;
    updateInputPanel();
  } catch (error) {
    packOutput = `Error: ${error}`;
    updateInputPanel();
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

    // Adjust selected index if out of bounds after filtering
    const filtered = applyFilters(currentMemories);
    if (selectedMemoryIndex >= filtered.length) {
      selectedMemoryIndex = Math.max(0, filtered.length - 1);
    }
    memoryList.setSelectedIndex(selectedMemoryIndex);

    updateDetailPanel();
    updateStatusBar();
    showFeedback(`+ Approved: ${memory.content.slice(0, 30)}...`);
  } catch (error) {
    showFeedback(`x Failed to verify: ${error}`);
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

    // Adjust selected index if out of bounds after filtering
    const filtered = applyFilters(currentMemories);
    if (selectedMemoryIndex >= filtered.length) {
      selectedMemoryIndex = Math.max(0, filtered.length - 1);
    }
    memoryList.setSelectedIndex(selectedMemoryIndex);

    updateDetailPanel();
    updateStatusBar();
    showFeedback(`x Retired: ${memory.content.slice(0, 30)}...`);
  } catch (error) {
    showFeedback(`x Failed to retire: ${error}`);
  }
}

function cleanupAndExit() {
  // Prevent multiple cleanup calls
  if (isExiting) return;
  isExiting = true;

  // Stop auto-refresh and debug refresh
  stopAutoRefresh();
  stopDebugRefresh();

  // Disable mouse first via renderer
  if (renderer) {
    try {
      renderer.useMouse = false;
    } catch {
      // Ignore
    }
  }

  // Write all escape sequences in one call to avoid race conditions
  const resetSequence = [
    "\x1b[?1000l", // Disable mouse click tracking
    "\x1b[?1002l", // Disable mouse button tracking
    "\x1b[?1003l", // Disable all mouse tracking
    "\x1b[?1006l", // Disable SGR mouse mode
    "\x1b[?25h",   // Show cursor
    "\x1b[?1049l", // Exit alternate screen buffer
    "\x1b[0m",     // Reset all attributes
    "\x1b[2J",     // Clear screen
    "\x1b[H",      // Move cursor to home
  ].join("");

  process.stdout.write(resetSequence);

  // Destroy renderer (more thorough than stop)
  if (renderer) {
    try {
      renderer.destroy();
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Small delay to ensure output is flushed
  setTimeout(() => {
    process.exit(0);
  }, 50);
}

function handleKeypress(key: KeyEvent) {
  // Handle input mode keys first
  if (inputMode !== "normal") {
    if (inputMode === "add") {
      handleAddInput(key);
    } else if (inputMode === "search") {
      handleSearchInput(key);
    } else if (inputMode === "pack") {
      handlePackInput(key);
    } else if (inputMode === "filter") {
      handleFilterInput(key);
    }
    return;
  }

  // Global keys (only in normal mode)
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    cleanupAndExit();
    return;
  }

  // Mode shortcuts
  if (key.name === "a") {
    enterAddMode();
    return;
  }

  if (key.name === "s") {
    enterSearchMode();
    return;
  }

  if (key.name === "p") {
    enterPackMode();
    return;
  }

  if (key.name === "f") {
    enterFilterMode();
    return;
  }

  // Manual refresh with Shift+R
  if (key.name === "r" && key.shift) {
    refreshMemories();
    showFeedback("Refreshed");
    return;
  }

  // Toggle debug console with Shift+D
  if (key.name === "d" && key.shift) {
    toggleDebugConsole();
    return;
  }

  // Resize debug console with + and - keys
  if (debugConsoleVisible && (key.sequence === "+" || key.sequence === "=")) {
    resizeDebugPanel(5);
    showFeedback(`Debug console: ${debugPanelHeightPercent}%`);
    return;
  }
  
  if (debugConsoleVisible && (key.sequence === "-" || key.sequence === "_")) {
    resizeDebugPanel(-5);
    showFeedback(`Debug console: ${debugPanelHeightPercent}%`);
    return;
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

  // Memory actions - work whenever we have a selected memory (no focus required)
  const filtered = applyFilters(currentMemories);
  if (filtered.length > 0 && selectedMemoryIndex < filtered.length) {
    const memory = filtered[selectedMemoryIndex];

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

    // Arrow keys for navigation
    if (key.name === "up") {
      selectedMemoryIndex = Math.max(0, selectedMemoryIndex - 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
      return;
    }

    if (key.name === "down") {
      selectedMemoryIndex = Math.min(filtered.length - 1, selectedMemoryIndex + 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
      return;
    }
  }
}

export async function runTUI() {
  renderer = await createCliRenderer({
    consoleOptions: {
      startInDebugMode: false,
    },
    useMouse: true,
    enableMouseMovement: true,
  });

  renderer.setBackgroundColor("#0d1117");
  
  // Header
  const header = new TextRenderable(renderer, {
    id: "header",
    content: t`${bold(fg("#58a6ff")("Alexandria Memory System"))}`,
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
    height: "55%",
    options: [],
    backgroundColor: "#0d1117",
    focusedBackgroundColor: "#161b22",
    textColor: "#c9d1d9",
    focusedTextColor: "#ffffff",
    selectedBackgroundColor: "#21262d",
    showDescription: true,
  });
  renderer.root.add(memoryList);
  
  // Detail panel (right panel) - scrollable
  detailPanel = new ScrollBoxRenderable(renderer, {
    id: "detail-panel",
    position: "absolute",
    left: "50%",
    top: 5,
    width: "50%",
    height: "55%",
    backgroundColor: "#161b22",
    borderStyle: "single",
    borderColor: "#30363d",
    title: "Memory Details",
    titleAlignment: "left",
    padding: 1,
    scrollY: true,
    scrollX: false,
  });
  renderer.root.add(detailPanel);

  detailText = new TextRenderable(renderer, {
    id: "detail-text",
    content: "Select a memory to view details",
    fg: "#c9d1d9",
    width: "100%",
  });
  detailPanel.content.add(detailText);

  // Trail panel (hidden by default) - scrollable
  trailPanel = new ScrollBoxRenderable(renderer, {
    id: "trail-panel",
    position: "absolute",
    left: "50%",
    top: 5,
    width: "50%",
    height: "55%",
    backgroundColor: "#161b22",
    borderStyle: "single",
    borderColor: "#30363d",
    title: "Event Trail",
    titleAlignment: "left",
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: false,
  });
  renderer.root.add(trailPanel);

  trailText = new TextRenderable(renderer, {
    id: "trail-text",
    content: "",
    fg: "#c9d1d9",
    width: "100%",
  });
  trailPanel.content.add(trailText);

  // Input panel (hidden by default, used for add/search/pack modes) - scrollable
  inputPanel = new ScrollBoxRenderable(renderer, {
    id: "input-panel",
    position: "absolute",
    left: "50%",
    top: 5,
    width: "50%",
    height: "55%",
    backgroundColor: "#161b22",
    borderStyle: "single",
    borderColor: "#58a6ff",
    title: "Input",
    titleAlignment: "left",
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: false,
  });
  renderer.root.add(inputPanel);

  inputText = new TextRenderable(renderer, {
    id: "input-text",
    content: "",
    fg: "#c9d1d9",
    width: "100%",
  });
  inputPanel.content.add(inputText);

  // Debug console panel (at the bottom)
  debugPanel = new ScrollBoxRenderable(renderer, {
    id: "debug-panel",
    position: "absolute",
    left: 0,
    bottom: 3,
    width: "100%",
    height: `${debugPanelHeightPercent}%`,
    backgroundColor: "#0d1117",
    borderStyle: "single",
    borderColor: "#30363d",
    title: "Live Debug Console [+/- to resize]",
    titleAlignment: "left",
    padding: 1,
    scrollY: true,
    scrollX: false,
    visible: debugConsoleVisible,
  });
  renderer.root.add(debugPanel);

  debugText = new TextRenderable(renderer, {
    id: "debug-text",
    content: t`${fg("#6e7681")("Waiting for events...")}`,
    fg: "#c9d1d9",
    width: "100%",
  });
  debugPanel.content.add(debugText);

  // Debug panel resize handlers - click on border starts resize
  debugPanel.onMouseDown = (event: MouseEvent) => {
    if (!debugConsoleVisible) return;
    
    // Check if clicking near the top border (within first 2 rows of the panel)
    const panelTop = getDebugPanelTopRow();
    // The event.y is relative to terminal, panelTop is where the panel starts
    if (event.y >= panelTop && event.y <= panelTop + 1) {
      startDebugPanelResize(event.y);
    }
  };

  // Status bar
  statusBar = new TextRenderable(renderer, {
    id: "status-bar",
    content: "",
    position: "absolute",
    left: 0,
    bottom: 1,
    width: "100%",
    fg: "#8b949e",
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

  // Mouse click handlers for memory list - calculate which item was clicked
  memoryList.onMouseDown = (event: MouseEvent) => {
    if (inputMode !== "normal") return;

    projectTabs.blur();
    memoryList.focus();

    const filtered = applyFilters(currentMemories);
    // Calculate which item was clicked based on y position
    // Each item takes ~2 lines (name + description) when showDescription is true
    const localY = event.y - 5; // Subtract top offset (top: 5)
    if (localY >= 0 && filtered.length > 0) {
      const itemHeight = 2; // Each item is roughly 2 lines with description
      const clickedIndex = Math.floor(localY / itemHeight);
      if (clickedIndex >= 0 && clickedIndex < filtered.length) {
        selectedMemoryIndex = clickedIndex;
        memoryList.setSelectedIndex(clickedIndex);
        updateDetailPanel();
        updateStatusBar();
      }
    }
  };

  // Mouse scroll handler for memory list
  memoryList.onMouseScroll = (event: MouseEvent) => {
    const filtered = applyFilters(currentMemories);
    if (inputMode !== "normal" || filtered.length === 0) return;

    const direction = event.scroll?.direction;
    if (direction === "up") {
      selectedMemoryIndex = Math.max(0, selectedMemoryIndex - 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
    } else if (direction === "down") {
      selectedMemoryIndex = Math.min(filtered.length - 1, selectedMemoryIndex + 1);
      memoryList.setSelectedIndex(selectedMemoryIndex);
      updateDetailPanel();
    }
  };

  // Mouse click handlers for project tabs
  projectTabs.onMouseDown = (event: MouseEvent) => {
    if (inputMode !== "normal") return;

    memoryList.blur();
    projectTabs.focus();

    // Calculate which tab was clicked based on x position
    const tabWidth = 20; // tabWidth: 20 in options
    const clickedTabIndex = Math.floor(event.x / tabWidth);
    const projects = getProjects();
    if (clickedTabIndex >= 0 && clickedTabIndex < projects.length) {
      const project = projects[clickedTabIndex];
      if (project.value) {
        projectTabs.setSelectedIndex(clickedTabIndex);
        switchToProject(project.value as string);
      }
    }
  };

  renderer.keyInput.on("keypress", handleKeypress);

  // Global mouse handlers for debug panel resizing
  renderer.root.onMouseDown = (event: MouseEvent) => {
    if (!debugConsoleVisible || isResizingDebugPanel) return;
    
    // Check if clicking on or near the debug panel top border
    const panelTop = getDebugPanelTopRow();
    if (Math.abs(event.y - panelTop) <= 1) {
      startDebugPanelResize(event.y);
    }
  };

  renderer.root.onMouseUp = (event: MouseEvent) => {
    if (isResizingDebugPanel) {
      endDebugPanelResize();
    }
  };

  renderer.root.onMouseMove = (event: MouseEvent) => {
    if (isResizingDebugPanel) {
      handleDebugPanelDrag(event.y);
    }
  };

  // Signal handlers for clean exit
  process.on("SIGINT", cleanupAndExit);
  process.on("SIGTERM", cleanupAndExit);
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    cleanupAndExit();
  });

  // Initialize
  if (projects.length > 0 && projects[0].value) {
    switchToProject(projects[0].value as string);
  }

  updateHelpText();
  memoryList.focus();

  // Start auto-refresh to pick up new memories from other sessions
  startAutoRefresh();
  
  // Start debug console refresh to watch for events/memories in real-time
  startDebugRefresh();

  // Start renderer
  renderer.start();
}

// Run if executed directly
if (import.meta.main) {
  runTUI().catch(console.error);
}
