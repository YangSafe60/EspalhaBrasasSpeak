import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useAppStore } from "../store/appStore";
import type { Invite, Server } from "../types";
import { ServerInviteCard } from "./ServerInviteCard";

type InvitePreview = {
  invite: Invite;
  server: Server;
  member_count: number;
  online_count: number;
};

export function JoinInviteModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const joinInvite = useAppStore((s) => s.joinInvite);
  const selectServer = useAppStore((s) => s.selectServer);
  const servers = useAppStore((s) => s.servers);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (modal !== "join-invite") return;
    setCode("");
    setPreview(null);
    setError(null);
    setBusy(false);
  }, [modal]);

  if (modal !== "join-invite") return null;

  const alreadyMember = preview
    ? servers.some((s) => s.id === preview.server.id)
    : false;

  function resetAndClose() {
    setCode("");
    setPreview(null);
    setError(null);
    setModal(null);
  }

  async function onLookUp(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const data = await api<InvitePreview>(
        `/api/invites/${encodeURIComponent(trimmed)}`,
      );
      setPreview(data);
      setCode(data.invite.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid invite");
    } finally {
      setBusy(false);
    }
  }

  async function onJoinOrGo() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (alreadyMember) {
        await selectServer(preview.server.id);
      } else {
        await joinInvite(preview.invite.code);
      }
      resetAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={resetAndClose}>
      <div
        className={`modal${preview ? " join-invite-modal" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>{preview ? "Server invite" : "Join with invite"}</h3>
          <button type="button" className="icon-btn" onClick={resetAndClose}>
            ✕
          </button>
        </header>

        {!preview ? (
          <form className="stack" onSubmit={(e) => void onLookUp(e)}>
            <label>
              Invite code
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="Paste code"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Looking up…" : "Continue"}
            </button>
          </form>
        ) : (
          <div className="stack join-invite-preview">
            <ServerInviteCard
              name={preview.server.name}
              iconUrl={preview.server.icon_url}
              bannerUrl={
                preview.server.banner_url || preview.server.invite_splash_url
              }
              accentColor={preview.server.accent_color}
              memberCount={preview.member_count}
              onlineCount={preview.online_count}
              createdAt={preview.server.created_at}
              ctaLabel={alreadyMember ? "Go to Server" : "Join Server"}
              onCta={() => void onJoinOrGo()}
              ctaBusy={busy}
            />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setPreview(null);
                setError(null);
              }}
            >
              Use a different code
            </button>
            {error && <p className="form-error">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
