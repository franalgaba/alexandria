/**
 * Temporal normalization helpers.
 */

const MONTH_MAP: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_NAMES = Object.keys(MONTH_MAP).join('|');

export function normalizeTemporalAnchor(anchor: string, sessionDate?: string): string | undefined {
  const session = sessionDate ? parseSessionDate(sessionDate) : null;
  const explicit = parseExplicitDate(anchor, session ?? undefined);
  if (explicit) {
    return formatDate(explicit);
  }

  if (session) {
    const relative = parseRelativeDate(anchor, session);
    if (relative) {
      return formatDate(relative);
    }
  }

  if (session) {
    return formatDate(session);
  }

  return undefined;
}

export function parseSessionDate(sessionDate: string): Date | null {
  const match = sessionDate.match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})/i,
  );
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3].toLowerCase();
    const day = Number(match[4]);
    const month = MONTH_MAP[match[5].toLowerCase()];
    const year = Number(match[6]);

    if (Number.isNaN(day) || Number.isNaN(year) || month === undefined) {
      return null;
    }

    const normalizedHour =
      meridiem === 'pm' ? (hour % 12) + 12 : hour % 12;
    return new Date(year, month, day, normalizedHour, minute, 0, 0);
  }

  const dateOnly = sessionDate.match(/(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})/i);
  if (dateOnly) {
    const day = Number(dateOnly[1]);
    const month = MONTH_MAP[dateOnly[2].toLowerCase()];
    const year = Number(dateOnly[3]);
    if (Number.isNaN(day) || Number.isNaN(year) || month === undefined) {
      return null;
    }
    return new Date(year, month, day);
  }

  return null;
}

function parseExplicitDate(text: string, sessionDate?: Date): Date | null {
  const dmy = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})\\s+(\\d{4})\\b`, 'i'));
  if (dmy) {
    return new Date(Number(dmy[3]), MONTH_MAP[dmy[2].toLowerCase()], Number(dmy[1]));
  }

  const mdy = text.match(
    new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, 'i'),
  );
  if (mdy) {
    const year = mdy[3] ? Number(mdy[3]) : sessionDate?.getFullYear();
    if (!year) return null;
    return new Date(year, MONTH_MAP[mdy[1].toLowerCase()], Number(mdy[2]));
  }

  const dmyNoYear = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})\\b`, 'i'));
  if (dmyNoYear && sessionDate) {
    return new Date(sessionDate.getFullYear(), MONTH_MAP[dmyNoYear[2].toLowerCase()], Number(dmyNoYear[1]));
  }

  return null;
}

function parseRelativeDate(text: string, sessionDate: Date): Date | null {
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower) || /\btonight\b/.test(lower)) {
    return new Date(sessionDate);
  }
  if (/\byesterday\b/.test(lower)) {
    return addDays(sessionDate, -1);
  }

  const agoMatch = lower.match(/\b(\d+|a|an)\s+(day|week|month|year)s?\s+ago\b/);
  if (agoMatch) {
    const count = agoMatch[1] === 'a' || agoMatch[1] === 'an' ? 1 : Number(agoMatch[1]);
    const unit = agoMatch[2];
    return shiftDate(sessionDate, -count, unit);
  }

  const relativeMatch = lower.match(/\b(last|this|next)\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (relativeMatch) {
    const direction = relativeMatch[1];
    const unit = relativeMatch[2];
    if (unit.endsWith('day')) {
      return resolveWeekday(sessionDate, unit, direction);
    }
    if (direction === 'this') {
      return new Date(sessionDate);
    }
    const offset = direction === 'last' ? -1 : 1;
    return shiftDate(sessionDate, offset, unit);
  }

  return null;
}

function shiftDate(base: Date, count: number, unit: string): Date {
  const date = new Date(base);
  switch (unit) {
    case 'day':
      return addDays(date, count);
    case 'week':
      return addDays(date, count * 7);
    case 'month':
      date.setMonth(date.getMonth() + count);
      return date;
    case 'year':
      date.setFullYear(date.getFullYear() + count);
      return date;
    default:
      return addDays(date, count);
  }
}

function addDays(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}

function resolveWeekday(base: Date, weekday: string, direction: string): Date {
  const weekdayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const target = weekdayMap[weekday];
  if (target === undefined) return new Date(base);

  const current = base.getDay();
  let delta = target - current;
  if (direction === 'last' && delta >= 0) delta -= 7;
  if (direction === 'next' && delta <= 0) delta += 7;
  return addDays(base, delta);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
