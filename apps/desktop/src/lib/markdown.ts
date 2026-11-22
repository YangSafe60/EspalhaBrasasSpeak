import { createElement, type ReactNode } from "react";

/**
 * Message formatting (a Discord-like subset):
 *   ```code block```   `inline code`   > quote
 *   **bold**   *italic*   __underline__   ~~strike~~   ||spoiler||
 *
 * Links, mentions and custom emoji tokens are never split by formatting: they
 * are atoms (a `_` inside a URL stays a `_`). Plain text pieces go to `leaf`,
 * which renders emojis, mentions and links.
 */
type Leaf = (text: string, key: string) => ReactNode[];

/** Ranges the formatter must not look inside. */
const ATOM_RE = /https?:\/\/[^\s<>"']+|<a?:\w+:\d+>|<[@#][!&]?[\w-]+>/g;

const INLINE: { mark: string; tag: string; className?: string }[] = [
  { mark: "||", tag: "span", className: "spoiler" },
  { mark: "**", tag: "strong" },
  { mark: "__", tag: "u" },
  { mark: "~~", tag: "s" },
  { mark: "*", tag: "em" },
];

function atomRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = new RegExp(ATOM_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

function atomEndAt(atoms: [number, number][], i: number): number | null {
  for (const [s, e] of atoms) if (i >= s && i < e) return e;
  return null;
}

/** Index of the closing `mark` at or after `from` (outside atoms), or -1. */
function findClose(text: string, mark: string, from: number, atoms: [number, number][]): number {
  let i = from;
  while (i <= text.length - mark.length) {
    const atomEnd = atomEndAt(atoms, i);
    if (atomEnd != null) {
      i = atomEnd;
      continue;
    }
    // A backtick span is literal: don't close inside it.
    if (text[i] === "`" && mark !== "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith(mark, i)) {
      // `**` must not be read as two `*`.
      if (mark === "*" && text[i + 1] === "*") {
        i += 2;
        continue;
      }
      // "***" closing "**...*": the inner "*" closes first, "**" takes the rest.
      if (mark === "**" && text[i + 2] === "*") return i + 1;
      return i;
    }
    i++;
  }
  return -1;
}

function revealSpoiler(e: { currentTarget: HTMLElement }) {
  e.currentTarget.classList.add("revealed");
}

function parseInline(text: string, leaf: Leaf, keyPrefix: string): ReactNode[] {
  const atoms = atomRanges(text);
  const out: ReactNode[] = [];
  let buf = "";
  let key = 0;
  const flush = () => {
    if (buf) out.push(...leaf(buf, `${keyPrefix}-t${key++}`));
    buf = "";
  };

  let i = 0;
  outer: while (i < text.length) {
    const atomEnd = atomEndAt(atoms, i);
    if (atomEnd != null) {
      buf += text.slice(i, atomEnd);
      i = atomEnd;
      continue;
    }
    if (text[i] === "\\" && i + 1 < text.length && /[*_~|`\\>]/.test(text[i + 1])) {
      // Escaped marker: keep the character, drop the backslash.
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push(createElement("code", { key: `${keyPrefix}-c${key++}`, className: "inline-code" }, text.slice(i + 1, end)));
        i = end + 1;
        continue;
      }
    }
    for (const { mark, tag, className } of INLINE) {
      if (!text.startsWith(mark, i)) continue;
      const start = i + mark.length;
      const close = findClose(text, mark, start, atoms);
      if (close <= start) continue;
      const inner = text.slice(start, close);
      // `*` italics need text right inside the stars (so "2 * 3 * 4" stays).
      if (mark === "*" && (/^\s/.test(inner) || /\s$/.test(inner))) continue;
      flush();
      const props: Record<string, unknown> = { key: `${keyPrefix}-f${key++}` };
      if (className) props.className = className;
      if (className === "spoiler") {
        props.onClick = revealSpoiler;
        props.title = "Spoiler: click to reveal";
      }
      out.push(createElement(tag, props, ...parseInline(inner, leaf, `${keyPrefix}-${key}`)));
      i = close + mark.length;
      continue outer;
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

/** Quote lines ("> text") become blockquotes; the rest stays inline. */
function parseLines(text: string, leaf: Leaf, keyPrefix: string): ReactNode[] {
  if (!/(^|\n)> /.test(text)) return parseInline(text, leaf, keyPrefix);
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let key = 0;
  let quote: string[] = [];
  let plain: string[] = [];
  const flushPlain = (trailingNewline: boolean) => {
    if (!plain.length) return;
    const t = plain.join("\n") + (trailingNewline ? "\n" : "");
    out.push(...parseInline(t, leaf, `${keyPrefix}-l${key++}`));
    plain = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(
      createElement(
        "blockquote",
        { key: `${keyPrefix}-q${key++}`, className: "message-quote" },
        ...parseInline(quote.join("\n"), leaf, `${keyPrefix}-qi${key}`),
      ),
    );
    quote = [];
  };
  for (const line of lines) {
    if (line.startsWith("> ")) {
      flushPlain(false);
      quote.push(line.slice(2));
    } else {
      flushQuote();
      plain.push(line);
    }
  }
  flushQuote();
  flushPlain(false);
  return out;
}

/** Full message: code blocks first (their content is shown as is). */
export function renderMarkdown(content: string, leaf: Leaf): ReactNode[] {
  if (!/[*_~|`>\\]/.test(content)) return leaf(content, "md");
  const out: ReactNode[] = [];
  const re = /```(?:([\w+-]{1,20})\n)?([\s\S]*?)```/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) out.push(...parseLines(content.slice(last, m.index), leaf, `md${key++}`));
    const code = m[2].replace(/^\n/, "").replace(/\n$/, "");
    out.push(
      createElement(
        "pre",
        { key: `md-pre${key++}`, className: "code-block", "data-lang": m[1] || undefined },
        createElement("code", null, code),
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push(...parseLines(content.slice(last), leaf, `md${key++}`));
  return out;
}
