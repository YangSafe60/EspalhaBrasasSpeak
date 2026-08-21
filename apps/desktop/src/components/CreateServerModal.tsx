import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/appStore";

export function CreateServerModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const createServer = useAppStore((s) => s.createServer);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (modal !== "create-server") return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createServer(name.trim());
      setName("");
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Create a server</h3>
          <button type="button" className="icon-btn" onClick={() => setModal(null)}>
            ✕
          </button>
        </header>
        <form className="stack" onSubmit={(e) => void onSubmit(e)}>
          <label>
            Server name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Night Ops"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      </div>
    </div>
  );
}
