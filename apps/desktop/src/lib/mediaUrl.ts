import { getApiBase } from "../api/client";

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1";
}

/** Rewrite API-hosted media so localhost URLs saved on the VPS still load in the app. */
export function mediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  const base = getApiBase().replace(/\/$/, "");
  if (url.startsWith("/")) return `${base}${url}`;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.startsWith("/media")) {
      if (isLoopbackHost(parsed.hostname) || parsed.port === "8080") {
        return `${base}${path}`;
      }
    }
  } catch {
    return url;
  }
  return url;
}

/**
 * ImgBB album/viewer links (ibb.co, imgbb.com) are HTML pages. When that
 * service is down they paint the blue "service unavailable" screen. Direct
 * pictures live on i.ibb.co and stay usable.
 */
export function imageSrc(url: string | null | undefined): string {
  const resolved = mediaUrl(url);
  if (!resolved) return "";
  try {
    const host = new URL(resolved).hostname.toLowerCase();
    if (host === "ibb.co" || host === "imgbb.com" || host.endsWith(".imgbb.com")) {
      return "";
    }
  } catch {
    return resolved;
  }
  return resolved;
}

export function mediaCssUrl(url: string | null | undefined): string | undefined {
  const resolved = mediaUrl(url);
  return resolved ? `url(${resolved})` : undefined;
}
