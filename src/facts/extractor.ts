/**
 * Lightweight fact extractor for conversational text.
 *
 * Produces subject-predicate-object facts with optional time anchors.
 */

import type { Confidence } from '../types/memory-objects.ts';
import { normalizeTemporalAnchor } from './temporal.ts';

export interface FactCandidate {
  subject: string;
  predicate: string;
  object: string;
  time?: string;
  confidence: Confidence;
}

export interface FactExtractionOptions {
  speaker?: string;
  sessionDate?: string;
  maxFacts?: number;
}

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

const DATE_PATTERNS = [
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}\\b`, 'i'),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, 'i'),
  new RegExp('\\b(last|this|next)\\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b', 'i'),
  new RegExp('\\b\\d+\\s+(day|week|month|year)s?\\s+ago\\b', 'i'),
  new RegExp('\\b(recently|lately|yesterday|today|tonight)\\b', 'i'),
];

interface FactPattern {
  predicate: string;
  regex: RegExp;
  confidence: Confidence;
}

const FACT_PATTERNS: FactPattern[] = [
  {
    predicate: 'identity',
    regex: /^(?:am|i\s+am|i'm)\s+(?:a|an)?\s*(.+?)\s+(?:person|individual|woman|man|nonbinary|non-binary|trans|transgender|queer|gay|lesbian|bisexual)\b/i,
    confidence: 'high',
  },
  {
    predicate: 'attribute',
    regex: /^(?!am\b|is\b|are\b|was\b|were\b)(.+?)\s+is\s+(.+)/i,
    confidence: 'medium',
  },
  {
    predicate: 'field',
    regex: /^(?:am|i\s+am|i'm)\s+(?:a|an)?\s*(.+?)\s+(?:researcher|engineer|scientist|developer|designer|artist|writer|doctor|lawyer|teacher|nurse|musician|entrepreneur|student|manager)\b/i,
    confidence: 'high',
  },
  {
    predicate: 'field',
    regex: /^(?:my|our)\s+(?:field|background|area)\s+(?:is|was|has\s+been)\s+(.+)/i,
    confidence: 'medium',
  },
  {
    predicate: 'identity',
    regex: /^(?:i\s+identify\s+as|i'm)\s+(.+)/i,
    confidence: 'high',
  },
  {
    predicate: 'field',
    regex: /^(?:am|i\s+am|i'm)\s+(?:keen on|interested in|into|focused on|considering|looking into)\s+(.+)/i,
    confidence: 'high',
  },
  {
    predicate: 'field',
    regex: /^(?:want|wanting|would like|i'd like|i would like|plan|planning|intend|intends|consider|considering|looking to)\s+(?:to\s+)?(?:study|pursue|work in|work on|focus on)\s+(.+)/i,
    confidence: 'medium',
  },
  {
    predicate: 'identity',
    regex: /\b(lgbtq|transgender|trans|queer|gay|lesbian|bisexual|nonbinary|non-binary)\b(?:[^.]{0,40})\b(support group|community|pride|identity|identify|embrace|coming out)\b/i,
    confidence: 'low',
  },
  {
    predicate: 'likes',
    regex: /^(?:really\s+)?(?:like|love|enjoy|prefer|hate)\s+(.+)/i,
    confidence: 'high',
  },
  {
    predicate: 'went_to',
    regex: /^(?:went\s+to|goes\s+to|visited|attended|traveled\s+to|travelled\s+to)\s+(.+)/i,
    confidence: 'high',
  },
  {
    predicate: 'is',
    regex: /^(?:am|is|are|was|were)\s+(.+)/i,
    confidence: 'medium',
  },
  {
    predicate: 'has',
    regex: /^(?:has|had)\s+(.+)/i,
    confidence: 'medium',
  },
  {
    predicate: 'works_at',
    regex: /^(?:work|works)\s+(?:as|at|for)\s+(.+)/i,
    confidence: 'high',
  },
  {
    predicate: 'plans_to',
    regex: /^(?:plan|plans|planning|intend|intends|going)\s+to\s+(.+)/i,
    confidence: 'medium',
  },
  {
    predicate: 'got',
    regex: /^(?:got|received|bought)\s+(.+)/i,
    confidence: 'medium',
  },
];

export function extractFacts(text: string, options: FactExtractionOptions = {}): FactCandidate[] {
  if (!text.trim()) return [];

  const sentences = text
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const facts: FactCandidate[] = [];
  const maxFacts = options.maxFacts ?? 3;

  for (const sentence of sentences) {
    if (facts.length >= maxFacts) break;

    const { subject, remainder } = splitSubject(sentence, options.speaker);
    if (!subject || !remainder) continue;

    for (const pattern of FACT_PATTERNS) {
      const match = remainder.match(pattern.regex);
      if (!match) continue;

      const object =
        pattern.predicate === 'attribute'
          ? sanitizeObject(`${match[1]}: ${match[2]}`)
          : sanitizeObject(match[1]);
      if (!object) continue;

      facts.push({
        subject,
        predicate: pattern.predicate,
        object,
        time: extractTimeAnchor(sentence, options.sessionDate),
        confidence: pattern.confidence,
      });

      break;
    }
  }

  return facts;
}

export function formatFactContent(fact: FactCandidate): string {
  const base = formatFactLine(fact);
  return fact.time ? `${base} (date: ${fact.time})` : base;
}

function splitSubject(sentence: string, speaker?: string): { subject: string | null; remainder: string } {
  const possessiveMatch = sentence.match(/^(my|our)\b/i);
  if (possessiveMatch && speaker) {
    const remainder = sentence.slice(possessiveMatch[0].length).trim();
    return { subject: speaker, remainder: normalizeRemainder(remainder) };
  }

  const subjectMatch = sentence.match(/^(I|We|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (subjectMatch) {
    const raw = subjectMatch[1];
    const subject = normalizeSubject(raw, speaker);
    const remainder = sentence.slice(subjectMatch[0].length).trim();
    return { subject, remainder: normalizeRemainder(remainder) };
  }

  if (speaker) {
    return { subject: speaker, remainder: normalizeRemainder(sentence) };
  }

  return { subject: null, remainder: sentence };
}

function normalizeSubject(raw: string, speaker?: string): string {
  if (/^(i|we)$/i.test(raw) && speaker) {
    return speaker;
  }
  return raw;
}

function sanitizeObject(object: string): string | null {
  const cleaned = object.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return null;
  const withoutIntro = cleaned.replace(/^(to|about)\s+/i, '');
  const splitOnDash = withoutIntro.split(/\s+[-–—]{1,2}\s+/)[0];
  const splitOnAside = splitOnDash.split(/\s+(?:because|so that|so|which|that)\s+/i)[0];
  return splitOnAside.trim();
}

function extractTimeAnchor(text: string, sessionDate?: string): string | undefined {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[0]) {
      return normalizeTemporalAnchor(match[0], sessionDate);
    }
  }

  return sessionDate ? normalizeTemporalAnchor(sessionDate, sessionDate) : undefined;
}

function formatFactLine(fact: FactCandidate): string {
  if (fact.predicate === 'identity') {
    return `${fact.subject} identity is ${fact.object}`.trim();
  }

  if (fact.predicate === 'field') {
    return `${fact.subject} field is ${fact.object}`.trim();
  }

  if (fact.predicate === 'attribute') {
    const [key, ...rest] = fact.object.split(':');
    const value = rest.join(':').trim();
    if (value) {
      return `${fact.subject}'s ${key.trim()} is ${value}`.trim();
    }
  }

  const predicate = predicateToPhrase(fact.predicate);
  return `${fact.subject} ${predicate} ${fact.object}`.trim();
}

function predicateToPhrase(predicate: string): string {
  switch (predicate) {
    case 'attribute':
      return 'has';
    case 'identity':
      return 'identifies as';
    case 'field':
      return 'works in';
    case 'likes':
      return 'likes';
    case 'went_to':
      return 'went to';
    case 'is':
      return 'is';
    case 'has':
      return 'has';
    case 'works_at':
      return 'works at';
    case 'plans_to':
      return 'plans to';
    case 'got':
      return 'got';
    default:
      return predicate.replace(/_/g, ' ');
  }
}

function normalizeRemainder(remainder: string): string {
  let trimmed = remainder.trim();

  if (trimmed.startsWith("'s") || trimmed.startsWith('’s')) {
    trimmed = trimmed.slice(2).trim();
  }

  if (trimmed.startsWith("'m") || trimmed.startsWith('’m')) {
    return `am${trimmed.slice(2)}`.trim();
  }
  if (trimmed.startsWith("'re") || trimmed.startsWith('’re')) {
    return `are${trimmed.slice(3)}`.trim();
  }

  const possessiveMatch = trimmed.match(/^([A-Za-z]+)'s\s+/);
  if (possessiveMatch) {
    return `${possessiveMatch[1]} is ${trimmed.slice(possessiveMatch[0].length)}`.trim();
  }

  return trimmed;
}
