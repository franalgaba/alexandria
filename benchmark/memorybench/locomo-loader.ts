/**
 * LoCoMo dataset loader for Alexandria memorybench
 *
 * Loads the LoCoMo benchmark (Long-term Conversational Memory)
 * from snap-research/locomo
 */

import type { UnifiedSession, UnifiedMessage } from './types.ts';

interface LoCoMoMessage {
  speaker: string;
  dia_id: string;
  text: string;
  image_url?: string;
  image_caption?: string;
}

interface LoCoMoQuestion {
  question: string;
  answer: string | number;
  evidence: string[];
  category: number;
}

interface LoCoMoConversation {
  speaker_a: string;
  speaker_b: string;
  [key: string]: unknown;
}

interface LoCoMoItem {
  sample_id: string;
  conversation: LoCoMoConversation;
  qa: LoCoMoQuestion[];
  event_summary?: unknown;
  observation?: unknown;
  session_summary?: unknown;
}

export interface BenchmarkQuestion {
  id: string;
  question: string;
  groundTruth: string;
  haystackSessionIds: string[];
  type: string;
  category: number;
}

export interface BenchmarkData {
  name: string;
  sessions: UnifiedSession[];
  questions: BenchmarkQuestion[];
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'single-hop',
  2: 'temporal',
  3: 'world-knowledge',
  4: 'multi-hop',
  5: 'adversarial',
};

/**
 * Parse dialog ID like "D1:3" to session index and message index
 */
function parseDialogId(diaId: string): { sessionNum: number; msgNum: number } | null {
  const match = diaId.match(/D(\d+):(\d+)/);
  if (!match) {
    // Skip malformed evidence (e.g., just "D" without numbers)
    return null;
  }
  return {
    sessionNum: parseInt(match[1], 10),
    msgNum: parseInt(match[2], 10),
  };
}

/**
 * Load LoCoMo dataset from file
 */
export async function loadLoCoMo(
  filePath = 'benchmark/memorybench/data/locomo10.json',
  options: { conversationLimit?: number; questionLimit?: number } = {},
): Promise<BenchmarkData> {
  const { conversationLimit, questionLimit } = options;

  const file = Bun.file(filePath);
  const data = (await file.json()) as LoCoMoItem[];

  const allSessions: UnifiedSession[] = [];
  const allQuestions: BenchmarkQuestion[] = [];

  // Process each conversation
  const conversations = conversationLimit ? data.slice(0, conversationLimit) : data;

  for (const item of conversations) {
    const conv = item.conversation;
    const sampleId = item.sample_id || `conv_${conversations.indexOf(item)}`;

    // Find all session keys
    const sessionKeys = Object.keys(conv)
      .filter((k) => /^session_\d+$/.test(k))
      .sort((a, b) => {
        const aNum = parseInt(a.replace('session_', ''), 10);
        const bNum = parseInt(b.replace('session_', ''), 10);
        return aNum - bNum;
      });

    // Process each session
    for (const sessionKey of sessionKeys) {
      const sessionNum = parseInt(sessionKey.replace('session_', ''), 10);
      const sessionId = `${sampleId}_D${sessionNum}`;
      const sessionData = conv[sessionKey] as Record<string, LoCoMoMessage>;
      const dateTimeKey = `${sessionKey}_date_time`;
      const dateTime = conv[dateTimeKey] as string | undefined;

      // Convert messages to unified format
      const messages: UnifiedMessage[] = [];
      const msgIndices = Object.keys(sessionData)
        .filter((k) => /^\d+$/.test(k))
        .map((k) => parseInt(k, 10))
        .sort((a, b) => a - b);

      for (const idx of msgIndices) {
        const msg = sessionData[idx.toString()];
        if (!msg?.text) continue;

        // Determine role based on speaker
        const isUserA = msg.speaker === conv.speaker_a;
        const role: 'user' | 'assistant' = isUserA ? 'user' : 'assistant';

        messages.push({
          role,
          content: msg.text,
          timestamp: dateTime,
          speaker: msg.speaker,
        });
      }

      if (messages.length > 0) {
        allSessions.push({
          sessionId,
          messages,
          metadata: { dateTime, sampleId },
        });
      }
    }

    // Process questions
    for (let qIdx = 0; qIdx < item.qa.length; qIdx++) {
      const q = item.qa[qIdx];
      const questionId = `${sampleId}_q${qIdx}`;

      // Parse evidence to find haystack session IDs
      const haystackSessionIds = new Set<string>();
      for (const evidence of q.evidence) {
        const parsed = parseDialogId(evidence);
        if (parsed) {
          haystackSessionIds.add(`${sampleId}_D${parsed.sessionNum}`);
        }
      }

      allQuestions.push({
        id: questionId,
        question: q.question,
        groundTruth: String(q.answer),
        haystackSessionIds: Array.from(haystackSessionIds),
        type: CATEGORY_NAMES[q.category] || 'unknown',
        category: q.category,
      });
    }
  }

  // Apply question limit
  const questions = questionLimit ? allQuestions.slice(0, questionLimit) : allQuestions;

  console.log(`Loaded LoCoMo: ${allSessions.length} sessions, ${questions.length} questions`);

  return {
    name: 'locomo',
    sessions: allSessions,
    questions,
  };
}

/**
 * Download LoCoMo dataset if not present
 */
export async function ensureLoCoMoDataset(
  filePath = 'benchmark/memorybench/data/locomo10.json',
): Promise<void> {
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return;
  }

  console.log('Downloading LoCoMo dataset...');
  const url = 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download LoCoMo: ${response.status}`);
  }

  const data = await response.text();
  await Bun.write(filePath, data);
  console.log('Downloaded LoCoMo dataset.');
}
