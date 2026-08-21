import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAppStore } from "../store/appStore";
import {
  ATMOSPHERE_PRESETS,
  Perm,
  type Atmosphere,
  type PermissionOverwrite,
  type Role,
} from "../types";

type Tab = "overview" | "permissions" | "integrations" | "danger";

type Tri = "allow" | "deny" | "inherit";

const CHANNEL_PERMS: { bit: number; label: string; voice?: boolean; text?: boolean }[] = [
  { bit: Perm.VIEW_CHANNEL, label: "View Channel" },
  { bit: Perm.MANAGE_CHANNELS, label: "Manage Channel" },
  { bit: Perm.MANAGE_ROLES, label: "Manage Permissions" },
  { bit: Perm.CREATE_INVITE, label: "Create Invite" },
  { bit: Perm.SEND_MESSAGES, label: "Send Messages", text: true },
  { bit: Perm.MANAGE_MESSAGES, label: "Manage Messages", text: true },
  { bit: Perm.ATTACH_FILES, label: "Attach Files", text: true },
  { bit: Perm.ADD_REACTIONS, label: "Add Reactions", text: true },
  { bit: Perm.MENTION_EVERYONE, label: "Mention @everyone", text: true },
  { bit: Perm.CONNECT, label: "Connect (join & listen)", voice: true },
  { bit: Perm.SPEAK, label: "Speak", voice: true },
  { bit: Perm.STREAM, label: "Video / Screen Share", voice: true },
  { bit: Perm.MUTE_MEMBERS, label: "Mute Members", voice: true },
  { bit: Perm.MOVE_MEMBERS, label: "Move Members", voice: true },
];

function triState(allow: number, deny: number, bit: number): Tri {
  if (allow & bit) return "allow";
  if (deny & bit) return "deny";
  return "inherit";
}

function applyTri(allow: number, deny: number, bit: number, next: Tri) {
  let a = allow & ~bit;
  let d = deny & ~bit;
  if (next === "allow") a |= bit;
  if (next === "deny") d |= bit;
  return { allow: a, deny: d };
}

export function ChannelSettingsModal() {
  const modal = useAppStore((s) => s.modal);
  const settingsChannelId = useAppStore((s) => s.settingsChannelId);
  const setModal = useAppStore((s) => s.setModal);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const loadRoles = useAppStore((s) => s.loadRoles);
  const updateChannel = useAppStore((s) => s.updateChannel);
  const deleteChannel = useAppStore((s) => s.deleteChannel);
  const uploadFile = useAppStore((s) => s.uploadFile);
  const loadChannelOverwrites = useAppStore((s) => s.loadChannelOverwrites);
  const saveChannelOverwrites = useAppStore((s) => s.saveChannelOverwrites);

  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => c.id === settingsChannelId);

  const roles = useMemo(() => {
    if (!channel) return [] as Role[];
    return (rolesByServer[channel.server_id] || [])
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [channel, rolesByServer]);

  const [tab, setTab] = useState<Tab>("overview");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [blur, setBlur] = useState(0);
  const [dim, setDim] = useState(0.45);
  const [textColor, setTextColor] = useState("#e8eef2");
  const [atmosphere, setAtmosphere] = useState<Atmosphere | "">("");
  const [userLimit, setUserLimit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [overwrites, setOverwrites] = useState<PermissionOverwrite[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draftAllow, setDraftAllow] = useState(0);
  const [draftDeny, setDraftDeny] = useState(0);
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (modal !== "channel-settings" || !channel) return;
    setTab("overview");
    setName(channel.name);
    setTopic(channel.topic || "");
    setBackgroundUrl(channel.background_url || "");
    setBlur(channel.background_blur ?? 0);
    setDim(channel.background_dim ?? 0.45);
    setTextColor(channel.text_color || "#e8eef2");
    setAtmosphere((channel.atmosphere as Atmosphere) || "");
    setUserLimit(channel.user_limit ?? 0);
    setMsg(null);
    setErr(null);
    setConfirmName("");
    void loadRoles(channel.server_id);
    void loadChannelOverwrites(channel.id).then((ows) => {
      setOverwrites(ows);
      const everyone = rolesByServer[channel.server_id]?.find((r) => r.is_everyone);
      const first =
        ows.find((o) => o.target_type === "role")?.target_id ||
        everyone?.id ||
        null;
      setSelectedRoleId(first);
    });
  }, [modal, channel?.id]);

  useEffect(() => {
    if (!selectedRoleId) {
      setDraftAllow(0);
      setDraftDeny(0);
      return;
    }
    const ow = overwrites.find(
      (o) => o.target_type === "role" && o.target_id === selectedRoleId,
    );
    setDraftAllow(ow?.allow ?? 0);
    setDraftDeny(ow?.deny ?? 0);
  }, [selectedRoleId, overwrites]);

  if (modal !== "channel-settings" || !channel) return null;

  const isVoice = channel.channel_type === "voice";
  const isText = channel.channel_type === "text";
  const isCategory = channel.channel_type === "category";
  const kindLabel = isCategory ? "Category" : isVoice ? "Voice channel" : "Text channel";
  const namePrefix = isCategory ? "" : "#";
  const permRows = CHANNEL_PERMS.filter((p) => {
    if (isCategory) {
      return (
        p.bit === Perm.VIEW_CHANNEL ||
        p.bit === Perm.MANAGE_CHANNELS ||
        p.bit === Perm.MANAGE_ROLES ||
        p.bit === Perm.CREATE_INVITE
      );
    }
    if (p.text && !isText) return false;
    if (p.voice && !isVoice) return false;
    return true;
  });

  function applyPreset(key: Atmosphere) {
    const p = ATMOSPHERE_PRESETS[key];
    setAtmosphere(key);
    setBlur(p.blur);
    setDim(p.dim);
  }

  async function onSaveOverview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await updateChannel(channel!.id, {
        name: name.trim(),
        topic: isText ? topic || null : undefined,
        background_url: isText ? backgroundUrl || null : undefined,
        background_blur: isText ? blur : undefined,
        background_dim: isText ? dim : undefined,
        text_color: isText ? textColor || null : undefined,
        atmosphere: isText ? atmosphere || null : undefined,
        user_limit: isVoice ? Math.max(0, Math.floor(userLimit)) : undefined,
      });
      setMsg("Changes saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSavePermissions() {
    if (!selectedRoleId || !channel) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const next = overwrites.filter(
        (o) => !(o.target_type === "role" && o.target_id === selectedRoleId),
      );
      if (draftAllow !== 0 || draftDeny !== 0) {
        next.push({
          id: "draft",
          channel_id: channel.id,
          target_type: "role",
          target_id: selectedRoleId,
          allow: draftAllow,
          deny: draftDeny,
        });
      }
      const saved = await saveChannelOverwrites(
        channel.id,
        next.map((o) => ({
          target_type: o.target_type,
          target_id: o.target_id,
          allow: o.allow,
          deny: o.deny,
        })),
      );
      setOverwrites(saved);
      setMsg("Permissions saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to save permissions");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!channel) return;
    if (confirmName !== channel.name) {
      setErr(`Type the ${channel.channel_type === "category" ? "category" : "channel"} name to confirm.`);
      return;
    }
    setBusy(true);
    try {
      await deleteChannel(channel.id);
      setModal(null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop settings-backdrop" onClick={() => setModal(null)}>
      <div
        className="modal channel-settings-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isCategory ? "Category settings" : "Channel settings"}
      >
        <aside className="channel-settings-nav">
          <p className="settings-nav-label">{kindLabel}</p>
          <p className="settings-nav-title">
            {namePrefix}
            {channel.name}
          </p>
          {(
            [
              ["overview", "Overview"],
              ["permissions", "Permissions"],
              ...(isCategory
                ? []
                : ([["integrations", "Integrations"]] as [Tab, string][])),
            ] as [Tab, string][]
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
          <button
            type="button"
            className={`danger-link ${tab === "danger" ? "active" : ""}`}
            onClick={() => {
              setTab("danger");
              setMsg(null);
              setErr(null);
            }}
          >
            Delete {isCategory ? "Category" : "Channel"}
          </button>
        </aside>

        <section className="channel-settings-main">
          <header className="modal-header">
            <h3>
              {tab === "overview" && "Overview"}
              {tab === "permissions" && "Permissions"}
              {tab === "integrations" && "Integrations"}
              {tab === "danger" && `Delete ${isCategory ? "Category" : "Channel"}`}
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

          {tab === "overview" && (
            <form className="stack settings-form" onSubmit={(e) => void onSaveOverview(e)}>
              <label>
                {isCategory ? "Category name" : "Channel name"}
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>

              {isCategory && (
                <p className="muted tiny">
                  Channels inside this category keep their own settings. Deleting the category
                  moves those channels to the top level.
                </p>
              )}

              {isText && (
                <>
                  <label>
                    Topic
                    <input
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="Let everyone know how to use this channel"
                    />
                  </label>
                  <div className="settings-section">
                    <h4>Atmosphere</h4>
                    <label>
                      Background image URL
                      <input
                        value={backgroundUrl}
                        onChange={(e) => setBackgroundUrl(e.target.value)}
                      />
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const up = await uploadFile(file);
                        setBackgroundUrl(up.url);
                      }}
                    />
                    <label>
                      Blur ({blur}px)
                      <input
                        type="range"
                        min={0}
                        max={24}
                        step={1}
                        value={blur}
                        onChange={(e) => setBlur(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Dim ({dim.toFixed(2)})
                      <input
                        type="range"
                        min={0}
                        max={0.9}
                        step={0.01}
                        value={dim}
                        onChange={(e) => setDim(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Text color
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                      />
                    </label>
                    <div className="preset-row">
                      {(Object.keys(ATMOSPHERE_PRESETS) as Atmosphere[]).map((key) => (
                        <button
                          key={key}
                          type="button"
                          className={`btn sm ${atmosphere === key ? "primary" : "ghost"}`}
                          onClick={() => applyPreset(key)}
                        >
                          {ATMOSPHERE_PRESETS[key].label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => setAtmosphere("")}
                      >
                        Custom
                      </button>
                    </div>
                  </div>
                </>
              )}

              {isVoice && (
                <div className="settings-section">
                  <h4>User limit</h4>
                  <p className="muted tiny">
                    Limit how many users can join this voice channel. 0 means unlimited.
                  </p>
                  <label>
                    User Limit
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={userLimit}
                      onChange={(e) => setUserLimit(Number(e.target.value) || 0)}
                    />
                  </label>
                </div>
              )}

              <div className="row">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              </div>
              {msg && <p className="form-ok">{msg}</p>}
              {err && <p className="form-error">{err}</p>}
            </form>
          )}

          {tab === "permissions" && (
            <div className="permissions-layout">
              <aside className="perm-roles">
                <p className="settings-nav-label">Roles</p>
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    className={selectedRoleId === role.id ? "active" : ""}
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <span className="role-dot" style={{ background: role.color }} />
                    {role.name}
                  </button>
                ))}
              </aside>
              <div className="perm-editor stack">
                {!selectedRoleId ? (
                  <p className="muted">Select a role to edit overwrites.</p>
                ) : (
                  <>
                    <p className="muted tiny">
                      Allow / Deny / Inherit for{" "}
                      <strong>
                        {roles.find((r) => r.id === selectedRoleId)?.name || "role"}
                      </strong>
                      . Deny wins over allow.
                    </p>
                    <div className="perm-table">
                      {permRows.map((p) => {
                        const state = triState(draftAllow, draftDeny, p.bit);
                        return (
                          <div key={p.bit} className="perm-row">
                            <span>{p.label}</span>
                            <div className="tri-group">
                              {(["allow", "inherit", "deny"] as Tri[]).map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  className={`tri ${t} ${state === t ? "on" : ""}`}
                                  onClick={() => {
                                    const next = applyTri(draftAllow, draftDeny, p.bit, t);
                                    setDraftAllow(next.allow);
                                    setDraftDeny(next.deny);
                                  }}
                                >
                                  {t === "allow" ? "✓" : t === "deny" ? "✕" : "/"}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy}
                        onClick={() => void onSavePermissions()}
                      >
                        {busy ? "Saving…" : "Save Permissions"}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          setDraftAllow(0);
                          setDraftDeny(0);
                        }}
                      >
                        Clear overwrites
                      </button>
                    </div>
                    {msg && <p className="form-ok">{msg}</p>}
                    {err && <p className="form-error">{err}</p>}
                  </>
                )}
              </div>
            </div>
          )}

          {tab === "integrations" && (
            <div className="stack settings-form">
              <div className="settings-section">
                <h4>Webhooks</h4>
                <p className="muted">
                  Webhooks and bots aren’t available in this build yet. This page is ready for
                  webhook management in a later update.
                </p>
                <button type="button" className="btn ghost" disabled>
                  Create Webhook (soon)
                </button>
              </div>
              <div className="settings-section">
                <h4>Apps</h4>
                <p className="muted">
                  Channel-linked integrations will show up here once the bot API ships.
                </p>
              </div>
            </div>
          )}

          {tab === "danger" && (
            <div className="stack settings-form danger-zone">
              <div className="danger-card">
                <div className="confirm-icon" aria-hidden>
                  !
                </div>
                <h4>Delete {isCategory ? "Category" : "Channel"}</h4>
                <p className="muted">
                  {isCategory ? (
                    <>
                      Are you sure you want to delete <strong>{channel.name}</strong>? Channels
                      inside it will move to the top level. The category itself will be
                      permanently removed.
                    </>
                  ) : (
                    <>
                      Are you sure you want to delete <strong>#{channel.name}</strong>? Messages,
                      permissions, and settings for this channel will be permanently removed.
                    </>
                  )}
                </p>
                <label>
                  Type <strong>{channel.name}</strong> to confirm
                  <input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={channel.name}
                  />
                </label>
                {err && <p className="form-error">{err}</p>}
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || confirmName !== channel.name}
                  onClick={() => void onDelete()}
                >
                  Delete {isCategory ? "Category" : "Channel"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
