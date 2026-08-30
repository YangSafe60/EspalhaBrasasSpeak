import { mediaUrl } from "./mediaUrl";

/** Save a remote attachment to disk (fetch blob, then anchor download). */
export async function downloadRemoteFile(
  url: string,
  filename: string,
): Promise<void> {
  const resolved = mediaUrl(url);
  const safeName = filename.trim() || "download";

  try {
    const res = await fetch(resolved, {
      mode: "cors",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  } catch {
    const link = document.createElement("a");
    link.href = resolved;
    link.download = safeName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}
