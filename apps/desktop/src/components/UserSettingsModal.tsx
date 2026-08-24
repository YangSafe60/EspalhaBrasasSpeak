import { useEffect, useRef, useState, type FormEvent } from "react";
import { CATBOX_UPLOAD_HINT } from "../lib/uploadHints";
import { mediaCssUrl, mediaUrl } from "../lib/mediaUrl";
import { getElectronAPI } from "../lib/desktop";
import { useAppStore } from "../store/appStore";
import { VoiceVideoSettingsPanel } from "./VoiceVideoSettingsPanel";

type Tab = "account" | "voice" | "appearance";

const STORAGE_COMPACT = "eb_compact_messages";
const STORAGE_NOTIFY = "eb_notify_sound";
const IMAGE_ACCEPT = "image/*,image/gif,.gif";

function readBool(key: string, fallback: boolean) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "1";
}

export function UserSettingsModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const user = useAppStore((s) => s.user);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const logout = useAppStore((s) => s.logout);

  const [tab, setTab] = useState<Tab>("account");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => readBool(STORAGE_COMPACT, false));
  const [notifySound, setNotifySound] = useState(() =>
    readBool(STORAGE_NOTIFY, true),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("dev");
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getElectronAPI()
      ?.getInfo()
      .then((info) => {
        if (info.appVersion) setAppVersion(info.appVersion);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (modal !== "user-settings" || !user) return;
    setDisplayName(user.display_name || "");
    setAvatarUrl(user.avatar_url || null);
    setBannerUrl(user.banner_url || null);
    setTab("account");
    setMsg(null);
    setErr(null);
  }, [modal, user]);

  useEffect(() => {
    document.documentElement.dataset.compact = compact ? "1" : "0";
    localStorage.setItem(STORAGE_COMPACT, compact ? "1" : "0");
  }, [compact]);

  useEffect(() => {
    localStorage.setItem(STORAGE_NOTIFY, notifySound ? "1" : "0");
  }, [notifySound]);

  if (modal !== "user-settings" || !user) return null;

  async function saveAccount(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await updateProfile({
        display_name: displayName.trim() || user.display_name,
      });
      setMsg("Profile saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function onAvatarFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const up = await uploadFile(file);
      setAvatarUrl(up.url);
      await updateProfile({ avatar_url: up.url });
      setMsg("Avatar updated.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      if (avatarRef.current) avatarRef.current.value = "";
    }
  }

  async function onBannerFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const up = await uploadFile(file);
      setBannerUrl(up.url);
      await updateProfile({ banner_url: up.url });
      setMsg("Banner updated.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      if (bannerRef.current) bannerRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setBusy(true);
    setErr(null);
    try {
      await updateProfile({ avatar_url: null });
      setAvatarUrl(null);
      setMsg("Avatar removed.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to remove avatar");
    } finally {
      setBusy(false);
    }
  }

  async function removeBanner() {
    setBusy(true);
    setErr(null);
    try {
      await updateProfile({ banner_url: null });
      setBannerUrl(null);
      setMsg("Banner removed.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to remove banner");
    } finally {
      setBusy(false);
    }
  }

  function doLogout() {
    setModal(null);
    logout();
  }

  const initial = (
    displayName.charAt(0) ||
    user.username.charAt(0) ||
    "?"
  ).toUpperCase();

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div
        className="modal user-settings"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="User settings"
      >
        <aside className="user-settings-nav">
          <p className="settings-nav-label">User settings</p>
          {(
            [
              ["account", "My Account"],
              ["voice", "Voice & Video"],
              ["appearance", "Appearance"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setMsg(null);
                setErr(null);
              }}
            >
              {label}
            </button>
          ))}
          <div className="settings-nav-spacer" />
          <p className="muted tiny settings-app-version">
            App v{appVersion}
          </p>
          <button type="button" className="danger-link" onClick={doLogout}>
            Log Out
          </button>
        </aside>

        <section className="user-settings-main">
          <header className="modal-header">
            <h3>
              {tab === "account" && "My Account"}
              {tab === "voice" && "Voice & Video"}
              {tab === "appearance" && "Appearance"}
            </h3>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setModal(null)}
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          {tab === "account" && (
            <form className="stack" onSubmit={saveAccount}>
              <div className="user-profile-editor">
                <button
                  type="button"
                  className={`user-profile-banner-edit${bannerUrl ? "" : " is-empty"}`}
                  style={
                    bannerUrl
                      ? { backgroundImage: mediaCssUrl(bannerUrl) }
                      : undefined
                  }
                  onClick={() => bannerRef.current?.click()}
                  title="Change banner"
                  disabled={busy}
                >
                  {!bannerUrl && <span>Change banner</span>}
                </button>
                <div className="user-profile-avatar-edit-wrap">
                  <button
                    type="button"
                    className="user-profile-avatar-edit"
                    onClick={() => avatarRef.current?.click()}
                    title="Change avatar"
                    disabled={busy}
                  >
                    {avatarUrl ? (
                      <img
                        src={mediaUrl(avatarUrl)}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </button>
                </div>
                <div className="user-profile-edit-actions">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    onClick={() => bannerRef.current?.click()}
                  >
                    Change banner
                  </button>
                  {bannerUrl && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => void removeBanner()}
                    >
                      Remove banner
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    onClick={() => avatarRef.current?.click()}
                  >
                    Change avatar
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => void removeAvatar()}
                    >
                      Remove avatar
                    </button>
                  )}
                </div>
                <p className="muted tiny">{CATBOX_UPLOAD_HINT} GIFs allowed.</p>
                <input
                  ref={bannerRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  hidden
                  onChange={(e) =>
                    void onBannerFile(e.target.files?.[0] ?? null)
                  }
                />
                <input
                  ref={avatarRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  hidden
                  onChange={(e) =>
                    void onAvatarFile(e.target.files?.[0] ?? null)
                  }
                />
              </div>

              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={64}
                  required
                />
              </label>
              <p className="muted tiny">Username can’t be changed yet.</p>
              {msg && <p className="form-ok">{msg}</p>}
              {err && <p className="form-error">{err}</p>}
              <div className="row">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          )}

          {tab === "voice" && <VoiceVideoSettingsPanel />}

          {tab === "appearance" && (
            <div className="stack">
              <label className="toggle-row">
                <span>Compact message list</span>
                <input
                  type="checkbox"
                  checked={compact}
                  onChange={(e) => setCompact(e.target.checked)}
                />
              </label>
              <label className="toggle-row">
                <span>Message notification sound</span>
                <input
                  type="checkbox"
                  checked={notifySound}
                  onChange={(e) => setNotifySound(e.target.checked)}
                />
              </label>
              <p className="muted tiny">
                Theme follows Espalha Brasas branding (dark + ember red).
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
