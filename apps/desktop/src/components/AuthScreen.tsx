import { useState, type FormEvent } from "react";
import { getApiBase } from "../api/client";
import { useAppStore } from "../store/appStore";
import logoFull from "../assets/logo-full.png";

export function AuthScreen() {
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginId, setLoginId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(loginId.trim(), password);
      } else {
        await register(username.trim(), email.trim(), password, displayName.trim() || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden />
      <form className="auth-card" onSubmit={onSubmit}>
        <img
          className="brand-logo-full"
          src={logoFull}
          alt="Espalha Brasas"
        />
        <h1>{mode === "login" ? "Welcome back" : "Create your space"}</h1>
        <p className="auth-sub">
          Voice-first communities with atmosphere you can feel.
        </p>

        {mode === "login" ? (
          <label>
            Username or email
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
        ) : (
          <>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                minLength={2}
              />
            </label>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
              />
            </label>
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
          </>
        )}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
          />
        </label>

        {error && <p className="form-error">{error}</p>}
        <p className="muted tiny">Server: {getApiBase()}</p>

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Register"}
        </button>

        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
