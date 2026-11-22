import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/appStore";

/** Server templates (keys match crates/server/src/templates.rs). */
const TEMPLATES = [
  { key: "gaming", label: "Gaming", icon: "🎮", small: "Voice rooms, clips and a stream room for your squad.", big: "Squads, duo rooms, streamers, moderators and rules." },
  { key: "friends", label: "Friends", icon: "💖", small: "Hang out, make plans, share photos.", big: "Introductions, events, movie nights and moderators." },
  { key: "study", label: "Study Group", icon: "📚", small: "Homework help, notes and a quiet focus room.", big: "Subjects, study rooms, a lecture hall and tutors." },
  { key: "school_club", label: "School Club", icon: "🏫", small: "Announcements, meeting notes and events.", big: "Officers, members-only chat, workshops and rules." },
  { key: "creators", label: "Artists & Creators", icon: "🎨", small: "Show your work, get feedback, go live.", big: "Showcase, collabs, commissions and critique circles." },
  { key: "local_community", label: "Local Community", icon: "🌿", small: "Neighborhood news, events and a marketplace.", big: "Introductions, local news, organizers and moderators." },
] as const;

type TemplateKey = (typeof TEMPLATES)[number]["key"];
type Step = "pick" | "size" | "name";

function Chevron() {
  return (
    <svg className="create-server-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.42 1.41l4.59-4.58a1 1 0 0 0 0-1.42L10.71 6.7a1 1 0 0 0-1.42.01z" />
    </svg>
  );
}

/**
 * Create a server: pick a template (or start blank), say whether it's for a
 * small group or a community (the community version adds info channels, staff
 * roles, private staff rooms and rules), then name it.
 */
export function CreateServerModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const createServer = useAppStore((s) => s.createServer);
  const me = useAppStore((s) => s.user);
  const [step, setStep] = useState<Step>("pick");
  const [template, setTemplate] = useState<TemplateKey | null>(null);
  const [community, setCommunity] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (modal !== "create-server") return null;

  const chosen = TEMPLATES.find((t) => t.key === template);

  function close() {
    setModal(null);
    setStep("pick");
    setTemplate(null);
    setCommunity(false);
    setName("");
    setError(null);
  }

  function goName() {
    if (!name.trim() && me) setName(`${me.display_name || me.username}'s server`);
    setStep("name");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createServer(name.trim(), { template, community });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal create-server-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>
            {step === "pick"
              ? "Create your server"
              : step === "size"
                ? "Tell us more about your server"
                : "Customize your server"}
          </h3>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>

        {step === "pick" && (
          <div className="create-server-step">
            <p className="muted create-server-lead">
              Your server is where you and your friends hang out. Start blank or from a template
              with channels, roles and permissions already set up.
            </p>
            <button
              type="button"
              className="create-server-option"
              onClick={() => {
                setTemplate(null);
                setCommunity(false);
                goName();
              }}
            >
              <span className="create-server-icon" aria-hidden>✨</span>
              <span className="create-server-label">Create My Own</span>
              <Chevron />
            </button>
            <p className="create-server-section">Start from a template</p>
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                className="create-server-option"
                onClick={() => {
                  setTemplate(t.key);
                  setStep("size");
                }}
              >
                <span className="create-server-icon" aria-hidden>{t.icon}</span>
                <span className="create-server-label">{t.label}</span>
                <Chevron />
              </button>
            ))}
          </div>
        )}

        {step === "size" && chosen && (
          <div className="create-server-step">
            <p className="muted create-server-lead">
              Is your new {chosen.label} server for just a few friends or a larger community?
            </p>
            <button
              type="button"
              className="create-server-option tall"
              onClick={() => {
                setCommunity(false);
                goName();
              }}
            >
              <span className="create-server-icon" aria-hidden>👥</span>
              <span className="create-server-text">
                <span className="create-server-label">For me and my friends</span>
                <span className="muted tiny">{chosen.small}</span>
              </span>
              <Chevron />
            </button>
            <button
              type="button"
              className="create-server-option tall"
              onClick={() => {
                setCommunity(true);
                goName();
              }}
            >
              <span className="create-server-icon" aria-hidden>🌍</span>
              <span className="create-server-text">
                <span className="create-server-label">For a club or community</span>
                <span className="muted tiny">{chosen.big}</span>
              </span>
              <Chevron />
            </button>
            <p className="muted tiny create-server-skip">
              Not sure?{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setCommunity(false);
                  goName();
                }}
              >
                Skip this question
              </button>{" "}
              and start small. You can always add channels and roles later.
            </p>
            <footer className="create-server-footer">
              <button type="button" className="btn ghost" onClick={() => setStep("pick")}>
                Back
              </button>
            </footer>
          </div>
        )}

        {step === "name" && (
          <form className="stack create-server-step" onSubmit={(e) => void onSubmit(e)}>
            <p className="muted create-server-lead">
              {chosen
                ? `${chosen.icon} ${chosen.label} · ${community ? "community" : "small group"}. Give it a name; you can change it later.`
                : "Give your new server a name. You can always change it later."}
            </p>
            <label>
              Server name
              <input
                autoFocus
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Night Ops"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <footer className="create-server-footer">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setStep(template ? "size" : "pick")}
              >
                Back
              </button>
              <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
