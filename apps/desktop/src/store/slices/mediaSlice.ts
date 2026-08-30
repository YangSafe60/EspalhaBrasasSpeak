/** File uploads and remote media attachment. */
import { api } from "../../api/client";
import { getElectronAPI } from "../../lib/desktop";
import { guessContentType } from "../helpers/messageHelpers";
import type { AppStoreSlice } from "./sliceTypes";

export const createMediaSlice: AppStoreSlice = () => ({
  uploadFile: async (file) => {
    const contentType =
      file.type || guessContentType(file.name) || "application/octet-stream";
    const isImage = contentType.toLowerCase().startsWith("image/");

    // Images in the desktop app: upload to ImgBB locally, register URL only on the VPS.
    if (isImage) {
      const desktop = getElectronAPI();
      if (desktop?.uploadImage) {
        const { key } = await api<{ key: string }>("/api/media/imgbb-key");
        const payload =
          file.type === contentType
            ? file
            : new File([file], file.name || "image.bin", { type: contentType });
        const temp = await desktop.uploadImage({
          filename: payload.name || "image.png",
          contentType,
          data: await payload.arrayBuffer(),
          apiKey: key,
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
      }

      // Browser / fallback: stream through API → ImgBB.
      const fd = new FormData();
      const payload =
        file.type === contentType
          ? file
          : new File([file], file.name || "image.bin", { type: contentType });
      fd.append("file", payload);
      return api<{ id: string; url: string }>("/api/media/upload", {
        method: "POST",
        formData: fd,
      });
    }

    // Other files: upload from the user's machine to Litterbox, then register URL only.
    const desktop = getElectronAPI();
    if (!desktop?.uploadTempMedia) {
      throw new Error(
        "Non-image files require the desktop app (Litterbox upload from your PC).",
      );
    }
    const temp = await desktop.uploadTempMedia({
      filename: file.name || "file.bin",
      contentType,
      data: await file.arrayBuffer(),
      expire: "72h",
    });
    return api<{ id: string; url: string }>("/api/media/remote", {
      method: "POST",
      body: {
        url: temp.url,
        filename: temp.filename || file.name,
        content_type: temp.contentType || contentType,
        size: temp.size ?? file.size,
      },
    });
  },

  attachRemoteMedia: async (body) => {
    return api<{ id: string; url: string }>("/api/media/remote", {
      method: "POST",
      body,
    });
  },
});
