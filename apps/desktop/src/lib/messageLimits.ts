/** Server cap on channel messages and edits (see MAX_MESSAGE_CHARS). */
export const MAX_MESSAGE_CHARS = 4000;
/** Show the counter once the draft gets this close to the limit. */
export const MESSAGE_COUNTER_FROM = 3500;

/** Characters as the server counts them: trimmed, by code point (not UTF-16 unit). */
export function messageLength(text: string): number {
  return Array.from(text.trim()).length;
}
