import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAppStore } from "../store/appStore";
import { Perm, ROLE_PERM_GROUPS } from "../types";

type Tab = "branding" | "roles" | "invites";

const DEFAULT_NEW_ROLE_PERMS =
  Perm.VIEW_CHANNEL |
  Perm.SEND_MESSAGES |
  Perm.CONNECT |
  Perm.SPEAK |
  Perm.STREAM |
  Perm.CREATE_INVITE |
  Perm.ATTACH_FILES |
  Perm.ADD_REACTIONS;

export function ServerSettingsModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const servers = useAppStore((s) => s.servers);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const updateServer = useAppStore((s) => s.updateServer);
  const createRole = useAppStore((s) => s.createRole);
  const updateRole = useAppStore((s) => s.updateRole);
  const deleteRole = useAppStore((s) => s.deleteRole);
  const createInvite = useAppStore((s) => s.createInvite);
  const loadRoles = useAppStore((s) => s.loadRoles);
  const uploadFile = useAppStore((s) => s.uploadFile);

  const [tab, setTab] = useState<Tab>("branding");
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("#d4a017");
  const [iconUrl, setIconUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleColor, setRoleColor] = useState("#e8c547");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draftPerms, setDraftPerms] = useState(0);
  const [draftRoleName, setDraftRoleName] = useState("");
  const [draftRoleColor, setDraftRoleColor] = useState("#99a1b3");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingRoleDelete, setPendingRoleDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletingRole, setDeletingRole] = useState(false);

  const server = servers.find((s) => s.id === activeServerId);
  const roles = useMemo(() => {
    const list = activeServerId ? rolesByServer[activeServerId] || [] : [];
    return list.slice().sort((a, b) => b.position - a.position);
  }, [activeServerId, rolesByServer]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  useEffect(() => {
    if (modal !== "server-settings" || !server || !activeServerId) return;
    setName(server.name);
    setAccent(server.accent_color || "#d4a017");
    setIconUrl(server.icon_url || "");
    setBannerUrl(server.banner_url || "");
    setInviteCode(null);
    setMsg(null);
    setErr(null);
    setSelectedRoleId(null);
    setRoleName("");
    void (async () => {
      await loadRoles(activeServerId);
      const loaded = useAppStore.getState().rolesByServer[activeServerId] || [];
      const everyone = loaded.find((r) => r.is_everyone) || loaded[0];
      if (everyone) {
        setSelectedRoleId(everyone.id);
        setDraftPerms(everyone.permissions);
        setDraftRoleName(everyone.name);
        setDraftRoleColor(everyone.color);
      }
    })();
  }, [modal, server, activeServerId, loadRoles]);

  useEffect(() => {
    if (!selectedRole) return;
    setDraftPerms(selectedRole.permissions);
    setDraftRoleName(selectedRole.name);
    setDraftRoleColor(selectedRole.color);
    setMsg(null);
    setErr(null);
  }, [selectedRole?.id, selectedRole?.permissions, selectedRole?.name, selectedRole?.color]);

  if (modal !== "server-settings" || !server || !activeServerId) return null;

  function togglePerm(bit: number) {
    setDraftPerms((prev) => (prev & bit ? prev & ~bit : prev | bit));
  }

  async function saveRole() {
    if (!selectedRole || !activeServerId) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const body: { name?: string; color?: string; permissions: number } = {
        permissions: draftPerms,
        color: draftRoleColor,
      };
      if (!selectedRole.is_everyone && draftRoleName.trim()) {
        body.name = draftRoleName.trim();
      }
      await updateRole(activeServerId, selectedRole.id, body);
      setMsg("Role saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateRole() {
    if (!activeServerId || !roleName.trim() || creatingRole) return;
    setCreatingRole(true);
    setMsg(null);
    setErr(null);
    try {
      const created = await createRole(activeServerId, {
        name: roleName.trim(),
        color: roleColor,
        permissions: DEFAULT_NEW_ROLE_PERMS,
      });
      setRoleName("");
      setSelectedRoleId(created.id);
      setMsg(`Created role “${created.name}”.`);
      setTab("roles");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to create role");
    } finally {
      setCreatingRole(false);
    }
  }

  async function saveBranding(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await updateServer(server!.id, {
        name: name.trim(),
        accent_color: accent,
        icon_url: iconUrl || null,
        banner_url: bannerUrl || null,
      });
      setMsg("Branding saved");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(file: File | null, kind: "icon" | "banner") {
    if (!file) return;
    const up = await uploadFile(file);
    if (kind === "icon") setIconUrl(up.url);
    else setBannerUrl(up.url);
  }

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div
        className={`modal wide${tab === "roles" ? " roles-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>Server settings</h3>
          <button type="button" className="icon-btn" onClick={() => setModal(null)}>
            ✕
          </button>
        </header>

        <div className="tabs">
          {(["branding", "roles", "invites"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setMsg(null);
                setErr(null);
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "branding" && (
          <form className="stack" onSubmit={(e) => void saveBranding(e)}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Accent color
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
            </label>
            <label>
              Icon URL
              <input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} />
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => void onUpload(e.target.files?.[0] || null, "icon")}
            />
            <label>
              Banner URL
              <input value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} />
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => void onUpload(e.target.files?.[0] || null, "banner")}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              Save branding
            </button>
          </form>
        )}

        {tab === "roles" && (
          <div className="roles-layout">
            <aside className="perm-roles">
              <p className="settings-nav-label">Roles</p>
              <div className="perm-roles-list">
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
              </div>
              <div className="role-create">
                <p className="settings-nav-label">Create role</p>
                <input
                  placeholder="Role name"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onCreateRole();
                    }
                  }}
                />
                <div className="row">
                  <input
                    type="color"
                    value={roleColor}
                    onChange={(e) => setRoleColor(e.target.value)}
                    title="Role color"
                  />
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={creatingRole || !roleName.trim()}
                    onClick={() => void onCreateRole()}
                  >
                    {creatingRole ? "Creating…" : "Create Role"}
                  </button>
                </div>
              </div>
            </aside>

            <div className="perm-editor stack">
              {!selectedRole ? (
                <p className="muted">Select a role to edit its permissions, or create one.</p>
              ) : (
                <>
                  <div className="role-identity row">
                    <input
                      type="color"
                      value={draftRoleColor}
                      onChange={(e) => setDraftRoleColor(e.target.value)}
                      title="Role color"
                    />
                    <input
                      value={draftRoleName}
                      disabled={selectedRole.is_everyone}
                      onChange={(e) => setDraftRoleName(e.target.value)}
                      placeholder="Role name"
                    />
                    {!selectedRole.is_everyone && (
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={() =>
                          setPendingRoleDelete({
                            id: selectedRole.id,
                            name: selectedRole.name,
                          })
                        }
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="muted tiny">
                    {selectedRole.is_everyone
                      ? "Permissions for @everyone apply to every member unless a higher role grants more."
                      : "Members with this role get these abilities server-wide. Channel settings can still override per channel."}
                  </p>

                  {ROLE_PERM_GROUPS.map((group) => (
                    <section key={group.title} className="role-perm-group">
                      <h4>{group.title}</h4>
                      <div className="perm-table">
                        {group.perms.map((p) => {
                          const on = (draftPerms & p.bit) !== 0;
                          return (
                            <label key={p.bit} className="perm-toggle-row">
                              <div>
                                <strong>{p.label}</strong>
                                <span className="muted tiny">{p.description}</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => togglePerm(p.bit)}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  <div className="row">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void saveRole()}
                    >
                      {busy ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "invites" && (
          <div className="stack">
            <p className="muted">Generate an invite code for this server.</p>
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void createInvite(activeServerId).then((inv) => setInviteCode(inv.code))
              }
            >
              Create invite
            </button>
            {inviteCode && (
              <p className="invite-code">
                Code: <code>{inviteCode}</code>
              </p>
            )}
          </div>
        )}

        {msg && <p className="form-hint">{msg}</p>}
        {err && <p className="form-error">{err}</p>}
      </div>

      <ConfirmDialog
        open={!!pendingRoleDelete}
        title="Delete role?"
        description={
          pendingRoleDelete
            ? `“${pendingRoleDelete.name}” will be removed from this server. Members keep other roles they already have.`
            : undefined
        }
        confirmLabel="Delete Role"
        cancelLabel="Cancel"
        danger
        busy={deletingRole}
        onConfirm={() => {
          if (!activeServerId || !pendingRoleDelete) return;
          setDeletingRole(true);
          const deletedId = pendingRoleDelete.id;
          void deleteRole(activeServerId, deletedId)
            .then(() => {
              setPendingRoleDelete(null);
              if (selectedRoleId === deletedId) {
                const next =
                  useAppStore.getState().rolesByServer[activeServerId] || [];
                const everyone = next.find((r) => r.is_everyone) || next[0];
                setSelectedRoleId(everyone?.id ?? null);
              }
            })
            .catch((error) => {
              setErr(error instanceof Error ? error.message : "Delete failed");
            })
            .finally(() => setDeletingRole(false));
        }}
        onCancel={() => {
          if (!deletingRole) setPendingRoleDelete(null);
        }}
      />
    </div>
  );
}
