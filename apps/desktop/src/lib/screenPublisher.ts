import { sameId } from "./serverPerms";

/** LiveKit identities shaped like `{userId}~screen~{source}`. */
const MARK = "~screen~";

export function livekitUserId(identity: string): string {
  const at = identity.indexOf(MARK);
  return at === -1 ? identity : identity.slice(0, at);
}

export function isScreenPublisher(identity: string): boolean {
  return identity.includes(MARK);
}

export function isOwnScreenPublisher(
  identity: string,
  userId: string | null | undefined,
): boolean {
  return (
    !!userId &&
    isScreenPublisher(identity) &&
    sameId(livekitUserId(identity), userId)
  );
}
