import { encryptAttachment } from "../../lib/attachmentCrypto";
/** File uploads and remote media attachment. */
import { api } from "../../api/client";
import { getElectronAPI } from "../../lib/desktop";
import { guessContentType } from "../helpers/messageHelpers";
import type { AppStoreSlice } from "./sliceTypes";

export const createMediaSlice: AppStoreSlice = (_set, get) => ({
  uploadFile: async (file) => {
    const contentType =
      file.type || guessContentType(file.name) || "application/octet-stream";
    const isImage = contentType.toLowerCase().startsWith("image/");

    // Images: direct file on Catbox from this PC. If that fails, send the
    // bytes to the API, which uploads to ImgBB with its own key — the key
    // never leaves the server.
    if (isImage) {
      const payload =
        file.type === contentType
          ? file
          : new File([file], file.name || "image.bin", { type: contentType });
      const desktop = getElectronAPI();
      if (desktop?.uploadImage) {
        try {
          const temp = await desktop.uploadImage({
            filename: payload.name || "image.png",
            contentType,
            data: await payload.arrayBuffer(),
          });
          return api<{ id: string; url: string }>("/api/media/remote", {
            method: "POST",
            body: {
              url: temp.url,
              filename: temp.filename || payload.name,
              content_type: temp.contentType || contentType,
              size: temp.size ?? payload.size,
            },
          });
        } catch {
          /* fall through to the server-side upload */
        }
      }
      const fd = new FormData();
      fd.append("file", payload);
      return api<{ id: string; url: string }>("/api/media/upload", {
        method: "POST",
        formData: fd,
      });
    }

    // Message files go through uploadAttachment (encrypted); this path is for
    // public images only (avatars, banners, server icons, emojis).
    throw new Error("Only images can be uploaded here.");
  },

  uploadAttachment: async (file) => {
    const desktop = getElectronAPI();
    // Outside the desktop app (no uploader without CORS issues): plain upload.
    if (!desktop?.uploadEncrypted) return get().uploadFile(file);
    const contentType =
      file.type || guessContentType(file.name) || "application/octet-stream";
    const isImage = contentType.toLowerCase().startsWith("image/");
    const { data, key } = await encryptAttachment(await file.arrayBuffer());
    // Everything goes to Catbox (permanent): encrypted, any file is just an
    // opaque .bin there.
    const up = await desktop.uploadEncrypted({ data });
    const res = await api<{ id: string; url: string }>("/api/media/remote", {
      method: "POST",
      body: {
        url: up.url,
        filename: file.name || (isImage ? "image" : "file"),
        content_type: contentType,
        size: file.size,
        enc_key: key,
      },
    });
    return { id: res.id, url: URL.createObjectURL(file) };
  },

  attachRemoteMedia: async (body) => {
    return api<{ id: string; url: string }>("/api/media/remote", {
      method: "POST",
      body,
    });
  },
});
