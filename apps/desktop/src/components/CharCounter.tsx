import { MAX_MESSAGE_CHARS, MESSAGE_COUNTER_FROM, messageLength } from "../lib/messageLimits";

/** "3612 / 4000" once a message nears the server limit; red when over it. */
export function CharCounter({ text, className }: { text: string; className?: string }) {
  const len = messageLength(text);
  if (len < MESSAGE_COUNTER_FROM) return null;
  const over = len > MAX_MESSAGE_CHARS;
  return (
    <span
      className={`char-counter${over ? " over" : ""}${className ? ` ${className}` : ""}`}
      aria-live="polite"
      title={over ? `Messages can be at most ${MAX_MESSAGE_CHARS} characters` : undefined}
    >
      {len} / {MAX_MESSAGE_CHARS}
    </span>
  );
}
