/**
 * ID generation utilities
 */

/**
 * Generate a unique ID using timestamp + random suffix
 * Format: {timestamp_base36}_{random_6chars}
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}`;
}

/**
 * Generate a shorter ID for internal use
 */
export function generateShortId(): string {
  return Math.random().toString(36).substring(2, 10);
}
