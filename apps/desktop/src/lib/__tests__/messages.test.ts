import { describe, expect, it } from "vitest";
import { messageLength, MAX_MESSAGE_CHARS } from "../messageLimits";
import { messageMentionsMe } from "../mentions";
import { collectUrlHits, parseYouTubeVideoId } from "../linkify";
import { keyLabel } from "../../hooks/usePushToTalk";

const me = { id: "11111111-2222-3333-4444-555555555555", username: "alice", display_name: "Alice" };
const roleId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ctx = { members: [], roles: [], me, myRoleIds: [roleId] };

describe("messageLength", () => {
  it("counts code points of the trimmed text, like the server", () => {
    expect(messageLength("  hi  ")).toBe(2);
    expect(messageLength("😀😀")).toBe(2);
    expect(MAX_MESSAGE_CHARS).toBe(4000);
  });
});

describe("messageMentionsMe", () => {
  it("matches user tokens, role tokens, @everyone and @username", () => {
    expect(messageMentionsMe(`hey <@${me.id}>`, ctx)).toBe(true);
    expect(messageMentionsMe(`hey <@&${roleId}>`, ctx)).toBe(true);
    expect(messageMentionsMe("@everyone look", ctx)).toBe(true);
    expect(messageMentionsMe("ping @alice!", ctx)).toBe(true);
  });
  it("ignores other users, emails and missing context", () => {
    expect(messageMentionsMe("<@99999999-2222-3333-4444-555555555555>", ctx)).toBe(false);
    expect(messageMentionsMe("mail bob@alice.com", ctx)).toBe(false);
    expect(messageMentionsMe("@alicebob", ctx)).toBe(false);
    expect(messageMentionsMe("@alice", { ...ctx, me: null })).toBe(false);
  });
});

describe("linkify", () => {
  it("finds URLs and stops before trailing punctuation", () => {
    const hits = collectUrlHits("see https://example.com/a?b=1, and http://x.y.");
    expect(hits.map((h) => h.url)).toEqual(["https://example.com/a?b=1", "http://x.y"]);
  });
  it("parses YouTube ids from common URL shapes", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("push-to-talk key labels", () => {
  it("names keys readably", () => {
    expect(keyLabel("KeyV")).toBe("V");
    expect(keyLabel("Digit4")).toBe("4");
    expect(keyLabel("Backquote")).toBe("`");
    expect(keyLabel("Mouse4")).toBe("Mouse4");
    expect(keyLabel("")).toBe("Not set");
  });
});
