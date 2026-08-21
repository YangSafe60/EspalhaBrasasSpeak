import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/appStore";

export function JoinInviteModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const joinInvite = useAppStore((s) => s.joinInvite);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (modal !== "join-invite") return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinInvite(code.trim());
      setCode("");
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Join with invite</h3>
          <button type="button" className="icon-btn" onClick={() => setModal(null)}>
            ✕
          </button>
        </header>
        <form className="stack" onSubmit={(e) => void onSubmit(e)}>
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
            {busy ? "Joining…" : "Join server"}
          </button>
        </form>
      </div>
    </div>
  );
}
