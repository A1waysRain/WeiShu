// In-match text communication. Text stays plain text throughout the client rendering path.
export const CHAT_MAX_LENGTH = 120;
export const CHAT_COOLDOWN_MS = 1000;
export const CHAT_BUBBLE_MS = 6000;

export function normalizeChat(text) {
  return typeof text === 'string' ? text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim() : '';
}

export function validChat(text) {
  return typeof text === 'string' && text.length <= CHAT_MAX_LENGTH && normalizeChat(text).length > 0;
}
