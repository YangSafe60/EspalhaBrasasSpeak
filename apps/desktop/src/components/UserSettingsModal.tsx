import { useEffect, useRef, useState, type FormEvent } from "react";
import { IMAGE_UPLOAD_HINT } from "../lib/uploadHints";
import { mediaCssUrl, mediaUrl } from "../lib/mediaUrl";
import { getElectronAPI } from "../lib/desktop";
import { useAppStore } from "../store/appStore";
import { AccessibilitySettings } from "./AccessibilitySettings";
import { ThemeSettings } from "./ThemeSettings";
import { VoiceVideoSettingsPanel } from "./VoiceVideoSettingsPanel";

type Tab = "account" | "voice" | "appearance" | "accessibility";
type DangerAction = "disable" | "delete" | null;

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
  const changePassword = useAppStore((s) => s.changePassword);
  const disableAccount = useAppStore((s) => s.disableAccount);
  const deleteAccount = useAppStore((s) => s.deleteAccount);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const logout = useAppStore((s) => s.logout);

  const [tab, setTab] = useState<Tab>("account");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dangerPassword, setDangerPassword] = useState("");
  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
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
    setEmail(user.email || "");
    setAvatarUrl(user.avatar_url || null);
    setBannerUrl(user.banner_url || null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setDangerPassword("");
    setDangerAction(null);
    setTab("account");
    setMsg(null);
    setErr(null);
  }, [modal, user]);

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
        email: email.trim() || user.email,
      });
      setMsg("Profile saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (newPassword.length < 6) {
        throw new Error("New password must be at least 8 characters.");
      }
      if (newPassword !== confirmPassword) {
        throw new Error("New passwords do not match.");
      }
      await changePassword(currentPassword, newPassword);
      setModal(null);
      logout();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Password change failed");
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

  async function confirmDanger() {
    if (!dangerAction || !dangerPassword) return;
    setBusy(true);
    setErr(null);
    try {
      if (dangerAction === "disable") {
        await disableAccount(dangerPassword);
      } else {
        await deleteAccount(dangerPassword);
      }
      setDangerAction(null);
      setModal(null);
      logout();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Request failed");
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
              ["accessibility", "Accessibility"],
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
              {tab === "accessibility" && "Accessibility"}
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
            <div className="stack account-settings-sections">
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
                  <p className="muted tiny">{IMAGE_UPLOAD_HINT} GIFs allowed.</p>
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
                <label>
                  Username
                  <input value={`@${user.username}`} readOnly disabled />
                </label>
                <p className="muted tiny">
                  Your @username is permanent and shown to others.
                </p>
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>
                {msg && <p className="form-ok">{msg}</p>}
                {err && tab === "account" && !dangerAction && (
                  <p className="form-error">{err}</p>
                )}
                <div className="row">
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? "Saving…" : "Save profile"}
                  </button>
                </div>
              </form>

              <form className="stack settings-section" onSubmit={savePassword}>
                <h4>Password</h4>
                <label>
                  Current password
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
                <p className="muted tiny">
                  You will be signed out on all devices after changing your password.
                </p>
                {err && !dangerAction && currentPassword && (
                  <p className="form-error">{err}</p>
                )}
                <div className="row">
                  <button type="submit" className="btn" disabled={busy}>
                    {busy ? "Updating…" : "Change password"}
                  </button>
                </div>
              </form>

              <div className="stack settings-form danger-zone">
                <h4>Danger zone</h4>
                <div className="danger-card">
                  <div>
                    <strong>Disable account</strong>
                    <p className="muted tiny">
                      Temporarily lock your account. You can contact support to
                      re-enable it later.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => {
                      setErr(null);
                      setDangerPassword("");
                      setDangerAction("disable");
                    }}
                  >
                    Disable
                  </button>
                </div>
                <div className="danger-card">
                  <div>
                    <strong>Delete account</strong>
                    <p className="muted tiny">
                      Permanently delete your account, owned servers, and
                      messages. This cannot be undone.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => {
                      setErr(null);
                      setDangerPassword("");
                      setDangerAction("delete");
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "voice" && <VoiceVideoSettingsPanel />}

          {tab === "appearance" && (
            <div className="stack">
              <ThemeSettings />
              <label className="toggle-row">
                <span>Message notification sound</span>
                <input
                  type="checkbox"
                  checked={notifySound}
                  onChange={(e) => setNotifySound(e.target.checked)}
                />
              </label>
              <button
                type="button"
                className="a11y-related"
                onClick={() => setTab("accessibility")}
              >
                <span>
                  <strong>Accessibility</strong>
                  <em className="muted tiny">
                    Text size, density, contrast, and motion
                  </em>
                </span>
                <span aria-hidden>›</span>
              </button>
            </div>
          )}

          {tab === "accessibility" && (
            <AccessibilitySettings
              onOpenAppearance={() => setTab("appearance")}
            />
          )}
        </section>
      </div>

      {dangerAction && (
        <div
          className="modal-backdrop account-danger-backdrop"
          onClick={() => !busy && setDangerAction(null)}
        >
          <div
            className="modal account-danger-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Confirm account action"
          >
            <h3>
              {dangerAction === "disable"
                ? "Disable your account?"
                : "Delete your account?"}
            </h3>
            <p className="muted tiny">
              {dangerAction === "disable"
                ? "You will be signed out and unable to log in until the account is re-enabled."
                : "This permanently deletes your account, owned servers, and messages."}
            </p>
            <label>
              Password
              <input
                type="password"
                value={dangerPassword}
                onChange={(e) => setDangerPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </label>
            {err && <p className="form-error">{err}</p>}
            <div className="row">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setErr(null);
                  setDangerAction(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy || !dangerPassword}
                onClick={() => void confirmDanger()}
              >
                {busy
                  ? "Working…"
                  : dangerAction === "disable"
                    ? "Disable account"
                    : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
