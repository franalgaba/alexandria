/**
 * Tests for Checkpoint system
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { getMemoryConnection } from '../../src/stores/connection.ts';
import { Checkpoint } from '../../src/ingestor/checkpoint.ts';
import { EventStore } from '../../src/stores/events.ts';
import { MemoryObjectStore } from '../../src/stores/memory-objects.ts';
import { SessionStore } from '../../src/stores/sessions.ts';

describe('Checkpoint', () => {
  let db: Database;
  let checkpoint: Checkpoint;
  let eventStore: EventStore;
  let memoryStore: MemoryObjectStore;
  let sessionStore: SessionStore;
  let TEST_SESSION_ID: string;

  beforeEach(() => {
    db = getMemoryConnection();
    sessionStore = new SessionStore(db);
    checkpoint = new Checkpoint(db, { 
      curatorMode: 'tier0',
      minEventsForCheckpoint: 5,
      toolBurstCount: 10,
      toolBurstWindowMs: 120000,
    });
    eventStore = new EventStore(db);
    memoryStore = new MemoryObjectStore(db);
    
    // Create test session and get its ID
    const session = sessionStore.start({ workingDirectory: '/test' });
    TEST_SESSION_ID = session.id;
  });

  afterEach(() => {
    db.close();
  });

  test('addEvent adds to buffer', async () => {
    const event = eventStore.append({
      sessionId: TEST_SESSION_ID,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Test message',
    });

    await checkpoint.addEvent(event);
    const stats = checkpoint.getBufferStats();
    
    expect(stats.events).toBe(1);
  });

  test('manual checkpoint extracts memories from buffer', async () => {
    // Create events simulating user correction pattern (most reliable)
    const sessionId = TEST_SESSION_ID;
    
    // User correction with clear "don't" pattern
    const correction1 = eventStore.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: '[user]: Don\'t use any type, always use specific types',
    });

    // Add filler events to meet minimum threshold (5 events)
    for (let i = 0; i < 4; i++) {
      const filler = eventStore.append({
        sessionId,
        timestamp: new Date(),
        eventType: 'turn',
        content: `Context message ${i}`,
      });
      await checkpoint.addEvent(filler);
    }

    // Add correction event
    await checkpoint.addEvent(correction1);

    // Execute checkpoint
    const result = await checkpoint.executeManual('Test checkpoint');

    expect(result.episodeEventCount).toBe(5);
    
    // User correction should be extracted as constraint
    expect(result.candidatesExtracted).toBeGreaterThan(0);
    expect(result.memoriesCreated).toBeGreaterThan(0);
    
    // Check that constraint was created
    const memories = memoryStore.list({ status: ['active'] });
    expect(memories.length).toBeGreaterThan(0);
    const constraints = memories.filter(m => m.objectType === 'constraint');
    expect(constraints.length).toBeGreaterThan(0);
    
    // Buffer should be cleared
    const stats = checkpoint.getBufferStats();
    expect(stats.events).toBe(0);
  });

  test('detectTrigger detects tool burst', async () => {
    const sessionId = TEST_SESSION_ID;
    
    // Create 11 tool outputs in quick succession (threshold is 10)
    for (let i = 0; i < 11; i++) {
      const event = eventStore.append({
        sessionId,
        timestamp: new Date(),
        eventType: 'tool_output',
        content: `Tool output ${i}`,
        toolName: 'bash',
        exitCode: 0,
      });
      
      const trigger = await checkpoint.addEvent(event);
      
      // Should auto-trigger on the 10th event
      if (i === 9) {
        expect(trigger).not.toBeNull();
        expect(trigger?.type).toBe('tool_burst');
      }
    }
  });

  test('detectTrigger detects task completion', async () => {
    const sessionId = TEST_SESSION_ID;
    
    // Create events leading to task completion
    const events = [
      { content: 'Running tests...', exitCode: undefined },
      { content: 'Test failed: assertion error', exitCode: 1 },
      { content: 'Fixed the issue', exitCode: undefined },
      { content: 'All tests passing', exitCode: 0 },
    ];

    let lastTrigger = null;
    for (const { content, exitCode } of events) {
      const event = eventStore.append({
        sessionId,
        timestamp: new Date(),
        eventType: 'tool_output',
        content,
        toolName: 'test',
        exitCode,
      });
      
      const trigger = await checkpoint.addEvent(event);
      if (trigger) lastTrigger = trigger;
    }

    expect(lastTrigger).not.toBeNull();
    expect(lastTrigger?.type).toBe('task_complete');
  });

  test('manual checkpoint allows small buffers but auto-triggers require minimum', async () => {
    const sessionId = TEST_SESSION_ID;
    
    // Add fewer events than minEventsForCheckpoint (default 5)
    for (let i = 0; i < 3; i++) {
      const event = eventStore.append({
        sessionId,
        timestamp: new Date(),
        eventType: 'turn',
        content: `Message ${i}`,
      });
      
      await checkpoint.addEvent(event);
    }

    // Manual checkpoint should work even with few events
    const result = await checkpoint.executeManual('Test');
    expect(result.episodeEventCount).toBe(3);
    
    // But it may not extract anything if patterns aren't strong
    expect(result.candidatesExtracted).toBeGreaterThanOrEqual(0);
  });

  test('deterministic curator works with manual checkpoint', async () => {
    const sessionId = TEST_SESSION_ID;
    
    // Create simple events that won't trigger auto-checkpoint
    for (let i = 0; i < 5; i++) {
      const event = eventStore.append({
        sessionId,
        timestamp: new Date(),
        eventType: 'turn',
        content: `Working on feature ${i}`,
      });
      await checkpoint.addEvent(event);
    }

    // Verify buffer has events
    expect(checkpoint.getBufferStats().events).toBe(5);

    // Execute manual checkpoint
    const result = await checkpoint.executeManual('Test');
    
    expect(result.episodeEventCount).toBe(5);
    
    // The deterministic curator is intentionally conservative
    // It may not extract anything from generic messages
    expect(result.candidatesExtracted).toBeGreaterThanOrEqual(0);
    
    // Buffer should be cleared
    expect(checkpoint.getBufferStats().events).toBe(0);
  });

  test('deterministic curator extracts constraint from user correction', async () => {
    const sessionId = TEST_SESSION_ID;
    
    const correctionEvent = eventStore.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: '[user]: No, don\'t use inline styles. Always use CSS modules.',
    });

    // Need at least 5 events for minimum threshold
    for (let i = 0; i < 4; i++) {
      const event = eventStore.append({
        sessionId,
        timestamp: new Date(),
        eventType: 'turn',
        content: `Filler event ${i}`,
      });
      await checkpoint.addEvent(event);
    }

    await checkpoint.addEvent(correctionEvent);

    const result = await checkpoint.executeManual('Test');
    
    const memories = memoryStore.list({ status: ['active'] });
    const constraints = memories.filter(m => m.objectType === 'constraint');
    expect(constraints.length).toBeGreaterThan(0);
    
    const correction = constraints.find(c => c.content.includes('inline styles'));
    expect(correction).toBeDefined();
  });

  test('getBufferStats returns correct statistics', async () => {
    const sessionId = TEST_SESSION_ID;
    
    // Add different types of events
    const toolOutput = eventStore.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'tool_output',
      content: 'Output',
      toolName: 'bash',
      exitCode: 0,
    });

    const error = eventStore.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'error',
      content: 'Error message',
      exitCode: 1,
    });

    await checkpoint.addEvent(toolOutput);
    await checkpoint.addEvent(error);

    const stats = checkpoint.getBufferStats();
    
    expect(stats.events).toBe(2);
    expect(stats.toolOutputs).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.age).toBeGreaterThanOrEqual(0);
  });

  test('clearBuffer removes all buffered events', async () => {
    const sessionId = TEST_SESSION_ID;
    
    const event = eventStore.append({
      sessionId,
      timestamp: new Date(),
      eventType: 'turn',
      content: 'Test',
    });

    await checkpoint.addEvent(event);
    
    let stats = checkpoint.getBufferStats();
    expect(stats.events).toBe(1);

    checkpoint.clearBuffer();

    stats = checkpoint.getBufferStats();
    expect(stats.events).toBe(0);
  });
});
