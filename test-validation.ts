#!/usr/bin/env bun
import { getMemoryConnection } from './src/stores/connection.ts';
import { Ingestor } from './src/ingestor/index.ts';
import { SessionStore } from './src/stores/sessions.ts';
import { MemoryObjectStore } from './src/stores/memory-objects.ts';

const NOISE_PATTERNS = [
  /let me check/i,
  /now let/i,
  /but let/i,
  /i will try/i,
  /console\.(log|error|warn)/,
  /actually,/i,
];

function isNoisy(content: string): boolean {
  return NOISE_PATTERNS.some(pattern => pattern.test(content));
}

async function testRealtimeMode() {
  const db = getMemoryConnection();
  const sessionStore = new SessionStore(db);
  const memoryStore = new MemoryObjectStore(db);
  const ingestor = new Ingestor(db, { useCheckpoints: false, useIntelligent: false });
  
  const session = sessionStore.start({ workingDirectory: '/test' });
  const beforeCount = memoryStore.list({ status: ['active'] }).length;
  
  const events = [
    '[user]: Let me check the API',
    '[assistant]: Now let me look...',
    '[assistant]: I will try using fetch',
    '[user]: Actually, use axios',
    '[user]: Don\'t use inline styles',
    'Error: test failed',
    'Success: all tests passed',
  ];
  
  for (const content of events) {
    await ingestor.ingest(session.id, content);
  }
  
  const afterCount = memoryStore.list({ status: ['active'] }).length;
  const created = afterCount - beforeCount;
  const memories = memoryStore.list({ status: ['active'] }).slice(-created);
  const noisy = memories.filter(m => isNoisy(m.content)).length;
  
  db.close();
  return { created, noisy, events: events.length };
}

async function testCheckpointMode() {
  const db = getMemoryConnection();
  const sessionStore = new SessionStore(db);
  const memoryStore = new MemoryObjectStore(db);
  const ingestor = new Ingestor(db, { 
    useCheckpoints: true,
    checkpointConfig: { curatorMode: 'tier0', minEventsForCheckpoint: 5 }
  });
  
  const session = sessionStore.start({ workingDirectory: '/test' });
  const beforeCount = memoryStore.list({ status: ['active'] }).length;
  
  const events = [
    '[user]: Let me check the API',
    '[assistant]: Now let me look...',
    '[assistant]: I will try using fetch',
    '[user]: Actually, use axios',
    '[user]: Don\'t use inline styles',
    'Error: test failed',
    'Success: all tests passed',
  ];
  
  for (const content of events) {
    await ingestor.ingest(session.id, content);
  }
  
  await ingestor.flushCheckpoint('Test');
  
  const afterCount = memoryStore.list({ status: ['active'] }).length;
  const created = afterCount - beforeCount;
  const memories = memoryStore.list({ status: ['active'] }).slice(-created);
  const noisy = memories.filter(m => isNoisy(m.content)).length;
  
  db.close();
  return { created, noisy, events: events.length };
}

console.log('Validating noise reduction claims...\n');

const realtime = await testRealtimeMode();
const checkpoint = await testCheckpointMode();

console.log('REAL-TIME MODE:');
console.log(`  Events: ${realtime.events}`);
console.log(`  Memories: ${realtime.created}`);
console.log(`  Noisy: ${realtime.noisy}`);
console.log(`  Noise rate: ${realtime.created > 0 ? ((realtime.noisy/realtime.created)*100).toFixed(1) : 0}%\n`);

console.log('CHECKPOINT MODE:');
console.log(`  Events: ${checkpoint.events}`);
console.log(`  Memories: ${checkpoint.created}`);
console.log(`  Noisy: ${checkpoint.noisy}`);
console.log(`  Noise rate: ${checkpoint.created > 0 ? ((checkpoint.noisy/checkpoint.created)*100).toFixed(1) : 0}%\n`);

const realtimeRate = realtime.created > 0 ? (realtime.noisy/realtime.created)*100 : 0;
const checkpointRate = checkpoint.created > 0 ? (checkpoint.noisy/checkpoint.created)*100 : 0;
const reduction = realtimeRate > 0 ? ((realtimeRate - checkpointRate) / realtimeRate) * 100 : 0;

console.log(`Noise reduction: ${reduction.toFixed(1)}%`);
console.log(reduction >= 50 ? '✅ VALIDATED' : '⚠️ NOT VALIDATED');
