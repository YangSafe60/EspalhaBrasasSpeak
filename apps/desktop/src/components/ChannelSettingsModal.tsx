import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAppStore } from "../store/appStore";
import {
  effectiveChannelPerms,
  hasPerm,
  permBits,
  sameId,
  isEveryoneRole,
  channelAccessBits,
  hasAnyAccessBit,
  Perm,
} from "../lib/serverPerms";
import {
  ATMOSPHERE_PRESETS,
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

function normalizeOverwrite(o: PermissionOverwrite): PermissionOverwrite {
  const raw = o as PermissionOverwrite & {
    allow_bits?: unknown;
    deny_bits?: unknown;
  };
  return {
    ...o,
    id: String(o.id),
    channel_id: String(o.channel_id),
    target_id: String(o.target_id),
    target_type:
      String(o.target_type).toLowerCase() === "member" ? "member" : "role",
    allow: permBits(raw.allow ?? raw.allow_bits),
    deny: permBits(raw.deny ?? raw.deny_bits),
  };
}

function findEveryoneRole(roles: Role[]): Role | undefined {
  return roles.find((r) => isEveryoneRole(r));
}

function isRoleOverwrite(o: PermissionOverwrite): boolean {
  return String(o.target_type).toLowerCase() === "role";
}

function rolesForServer(
  rolesByServer: Record<string, Role[]>,
  serverId: string,
): Role[] {
  const key = Object.keys(rolesByServer).find((id) => sameId(id, serverId));
  return key ? rolesByServer[key] || [] : [];
}

function applyLockUi(
  ows: PermissionOverwrite[],
  roles: Role[],
  channelType: string | undefined,
  setPrivateLocked: (v: boolean) => void,
  setAccessRoleIds: (ids: string[]) => void,
) {
  const { locked, accessRoleIds } = lockStateFromOverwrites(
    ows,
    roles,
    channelType,
  );
  setPrivateLocked(locked);
  setAccessRoleIds(accessRoleIds);
  return { locked, accessRoleIds };
}

/** Derive private-lock UI state from saved overwrites. */
function lockStateFromOverwrites(
  ows: PermissionOverwrite[],
  roles: Role[],
  channelType: string | undefined,
): { locked: boolean; accessRoleIds: string[]; everyoneId: string | null } {
  const accessBits = channelAccessBits(channelType);
  const everyone = findEveryoneRole(roles);
  const roleOws = ows.filter(
    (o) => String(o.target_type).toLowerCase() === "role",
  );

  let everyoneOw = everyone
    ? roleOws.find((o) => sameId(o.target_id, everyone.id))
    : undefined;

  // If @everyone wasn't matched by id, treat any role overwrite that denies
  // access bits and isn't an allow-only grant as the lock row.
  if (!everyoneOw) {
    everyoneOw = roleOws.find((o) => {
      const deny = permBits(o.deny);
      const allow = permBits(o.allow);
      return hasAnyAccessBit(deny, accessBits) && !hasAnyAccessBit(allow, accessBits);
    });
  }

  const everyoneId = everyone?.id ?? everyoneOw?.target_id ?? null;
  const locked = Boolean(
    everyoneOw && hasAnyAccessBit(permBits(everyoneOw.deny), accessBits),
  );

  if (!locked) {
    return { locked: false, accessRoleIds: [], everyoneId };
  }

  const accessRoleIds = roleOws
    .filter((o) => {
      if (everyoneId && sameId(o.target_id, everyoneId)) return false;
      // Skip the everyone role even if ids mismatched.
      const role = roles.find((r) => sameId(r.id, o.target_id));
      if (isEveryoneRole(role)) return false;
      return hasAnyAccessBit(permBits(o.allow), accessBits);
    })
    .map((o) => o.target_id);

  return { locked: true, accessRoleIds, everyoneId };
}

export function ChannelSettingsModal() {
  const modal = useAppStore((s) => s.modal);
  const settingsChannelId = useAppStore((s) => s.settingsChannelId);
  const setModal = useAppStore((s) => s.setModal);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const overwritesByChannel = useAppStore((s) => s.overwritesByChannel);
  const loadRoles = useAppStore((s) => s.loadRoles);
  const updateChannel = useAppStore((s) => s.updateChannel);
  const deleteChannel = useAppStore((s) => s.deleteChannel);
  const loadChannelOverwrites = useAppStore((s) => s.loadChannelOverwrites);
  const saveChannelOverwrites = useAppStore((s) => s.saveChannelOverwrites);

  const channel = Object.values(channelsByServer)
    .flat()
    .find((c) => sameId(c.id, settingsChannelId));

  const user = useAppStore((s) => s.user);
  const servers = useAppStore((s) => s.servers);
  const membersByServer = useAppStore((s) => s.membersByServer);

  const roles = useMemo(() => {
    if (!channel) return [] as Role[];
    return rolesForServer(rolesByServer, channel.server_id)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [channel, rolesByServer]);

  const server = channel
    ? servers.find((s) => sameId(s.id, channel.server_id))
    : undefined;
  const membersKey = channel
    ? Object.keys(membersByServer).find((id) =>
        sameId(id, channel.server_id),
      )
    : undefined;
  const members = membersKey ? membersByServer[membersKey] || [] : [];
  const me = members.find((m) => sameId(m.user.id, user?.id));
  const overwritesForChannel = useMemo(() => {
    if (!settingsChannelId) return [];
    const key = Object.keys(overwritesByChannel).find((id) =>
      sameId(id, settingsChannelId),
    );
    return key ? overwritesByChannel[key] || [] : [];
  }, [settingsChannelId, overwritesByChannel]);
  const canManageThisChannel = useMemo(
    () =>
      hasPerm(
        effectiveChannelPerms(
          server,
          roles,
          me,
          user?.id,
          overwritesForChannel,
        ),
        Perm.MANAGE_CHANNELS,
      ),
    [server, roles, me, user?.id, overwritesForChannel],
  );

  const [tab, setTab] = useState<Tab>("overview");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
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
  const [privateLocked, setPrivateLocked] = useState(false);
  const [accessRoleIds, setAccessRoleIds] = useState<string[]>([]);

  useEffect(() => {
    if (modal !== "channel-settings" || !channel) return;

    setTab("overview");
    setName(channel.name);
    setTopic(channel.topic || "");
    setTextColor(channel.text_color || "#e8eef2");
    setAtmosphere((channel.atmosphere as Atmosphere) || "");
    setUserLimit(channel.user_limit ?? 0);
    setBusy(false);
    setMsg(null);
    setErr(null);
    setSelectedRoleId(null);

    let cancelled = false;
    const serverId = channel.server_id;
    const channelId = channel.id;
    const channelType = channel.channel_type;

    const hydrateFrom = (
      raw: PermissionOverwrite[],
      rolesNow: Role[],
    ) => {
      const ows = raw.map(normalizeOverwrite);
      setOverwrites(ows);
      const { accessRoleIds: accessIds } = applyLockUi(
        ows,
        rolesNow,
        channelType,
        setPrivateLocked,
        setAccessRoleIds,
      );
      const everyone = findEveryoneRole(rolesNow);
      const preferred =
        accessIds[0] ||
        ows.find(
          (o) =>
            isRoleOverwrite(o) && !sameId(o.target_id, everyone?.id),
        )?.target_id ||
        everyone?.id ||
        rolesNow[0]?.id ||
        null;
      setSelectedRoleId((prev) => {
        if (prev && rolesNow.some((r) => sameId(r.id, prev))) return prev;
        // Map overwrite target id onto the canonical role id from roles list.
        if (preferred) {
          const match = rolesNow.find((r) => sameId(r.id, preferred));
          return match?.id ?? preferred;
        }
        return null;
      });
    };

    // Instant paint from store (sidebar lock data) so UI isn't empty while fetching.
    {
      const store = useAppStore.getState();
      const rolesNow = rolesForServer(store.rolesByServer, serverId);
      const cachedKey = Object.keys(store.overwritesByChannel).find((id) =>
        sameId(id, channelId),
      );
      const cached = cachedKey
        ? store.overwritesByChannel[cachedKey] || []
        : [];
      if (cached.length > 0) {
        hydrateFrom(cached, rolesNow);
      } else {
        setPrivateLocked(false);
        setAccessRoleIds([]);
        setOverwrites([]);
      }
    }

    void (async () => {
      await loadRoles(serverId);
      if (cancelled) return;

      const store = useAppStore.getState();
      const rolesNow = rolesForServer(store.rolesByServer, serverId);
      const serverNow = store.servers.find((s) => sameId(s.id, serverId));
      const membersKey = Object.keys(store.membersByServer).find((id) =>
        sameId(id, serverId),
      );
      const membersNow = membersKey
        ? store.membersByServer[membersKey] || []
        : [];
      const meNow = membersNow.find((m) =>
        sameId(m.user.id, store.user?.id),
      );

      let raw: PermissionOverwrite[] = [];
      try {
        raw = await loadChannelOverwrites(channelId);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load permissions");
        }
        return;
      }
      if (cancelled) return;

      const ows = raw.map(normalizeOverwrite);
      const permsNow = effectiveChannelPerms(
        serverNow,
        rolesNow,
        meNow,
        store.user?.id,
        ows,
      );
      if (!hasPerm(permsNow, Perm.MANAGE_CHANNELS)) {
        setModal(null);
        return;
      }

      hydrateFrom(ows, rolesNow);
    })();

    return () => {
      cancelled = true;
    };
  }, [modal, channel?.id, loadRoles, loadChannelOverwrites, setModal]);

  useEffect(() => {
    if (!selectedRoleId) {
      setDraftAllow(0);
      setDraftDeny(0);
      return;
    }
    const ow = overwrites.find(
      (o) => isRoleOverwrite(o) && sameId(o.target_id, selectedRoleId),
    );
    setDraftAllow(permBits(ow?.allow));
    setDraftDeny(permBits(ow?.deny));
  }, [selectedRoleId, overwrites]);

  if (modal !== "channel-settings" || !channel || !canManageThisChannel) {
    return null;
  }

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
    setAtmosphere(key);
    const text =
      key === "focus"
        ? "#f4f7fb"
        : key === "chill"
          ? "#e8fff6"
          : "#ffe8f0";
    setTextColor(text);
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
        // Background images removed from UI — clear any legacy image.
        background_url: isText ? null : undefined,
        background_blur: isText ? 0 : undefined,
        background_dim: isText ? 0 : undefined,
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
      // Prefer local editor state; fall back to store so we never PUT an empty
      // list and wipe a lock that failed to hydrate into local state.
      const base =
        overwrites.length > 0
          ? overwrites
          : overwritesForChannel.map(normalizeOverwrite);
      const next = base.filter(
        (o) =>
          !(isRoleOverwrite(o) && sameId(o.target_id, selectedRoleId)),
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
      const saved = (
        await saveChannelOverwrites(
          channel.id,
          next.map((o) => ({
            target_type: o.target_type,
            target_id: o.target_id,
            allow: permBits(o.allow),
            deny: permBits(o.deny),
          })),
        )
      ).map(normalizeOverwrite);
      setOverwrites(saved);
      applyLockUi(
        saved,
        roles,
        channel.channel_type,
        setPrivateLocked,
        setAccessRoleIds,
      );
      setMsg("Permissions saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to save permissions");
    } finally {
      setBusy(false);
    }
  }

  async function onSavePrivateLock() {
    if (!channel) return;
    const everyone = findEveryoneRole(roles);
    if (!everyone) {
      setErr("Missing @everyone role.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const accessBits = channelAccessBits(channel.channel_type);
      const base =
        overwrites.length > 0
          ? overwrites
          : overwritesForChannel.map(normalizeOverwrite);

      let next: PermissionOverwrite[];

      if (privateLocked) {
        next = base.filter((o) => {
          if (!isRoleOverwrite(o)) return true;
          if (sameId(o.target_id, everyone.id)) return false;
          if (accessRoleIds.some((id) => sameId(id, o.target_id))) return false;
          return true;
        });
        next.push({
          id: "everyone-lock",
          channel_id: channel.id,
          target_type: "role",
          target_id: everyone.id,
          allow: 0,
          deny: accessBits,
        });
        for (const roleId of accessRoleIds) {
          const prev = base.find(
            (o) => isRoleOverwrite(o) && sameId(o.target_id, roleId),
          );
          const allow =
            ((permBits(prev?.allow) & ~accessBits) | accessBits) >>> 0;
          const deny = (permBits(prev?.deny) & ~accessBits) >>> 0;
          next.push({
            id: `access-${roleId}`,
            channel_id: channel.id,
            target_type: "role",
            target_id: roleId,
            allow,
            deny,
          });
        }
      } else {
        // Unlock: clear access bits from all role overwrites.
        next = base
          .map((o) => {
            if (!isRoleOverwrite(o)) return o;
            return {
              ...o,
              allow: (permBits(o.allow) & ~accessBits) >>> 0,
              deny: (permBits(o.deny) & ~accessBits) >>> 0,
            };
          })
          .filter((o) => permBits(o.allow) !== 0 || permBits(o.deny) !== 0);
      }

      const saved = (
        await saveChannelOverwrites(
          channel.id,
          next.map((o) => ({
            target_type: o.target_type,
            target_id: o.target_id,
            allow: permBits(o.allow),
            deny: permBits(o.deny),
          })),
        )
      ).map(normalizeOverwrite);
      setOverwrites(saved);
      const restored = applyLockUi(
        saved,
        roles,
        channel.channel_type,
        setPrivateLocked,
        setAccessRoleIds,
      );
      setMsg(
        restored.locked
          ? "Channel locked — only selected roles can see it."
          : "Channel unlocked for @everyone.",
      );
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to update lock");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!channel) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteChannel(channel.id);
      setBusy(false);
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
                    <h4>Color scheme</h4>
                    <p className="muted tiny">
                      Pick a preset look for this channel, or set a custom text color.
                    </p>
                    <label>
                      Text color
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => {
                          setTextColor(e.target.value);
                          setAtmosphere("");
                        }}
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
                        className={`btn sm ${!atmosphere ? "primary" : "ghost"}`}
                        onClick={() => {
                          setAtmosphere("");
                          setTextColor("#e8eef2");
                        }}
                      >
                        Default
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
                  <label className="number-field">
                    User Limit
                    <div className="number-stepper">
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={userLimit}
                        onChange={(e) =>
                          setUserLimit(
                            Math.min(99, Math.max(0, Number(e.target.value) || 0)),
                          )
                        }
                      />
                      <div className="number-stepper-btns">
                        <button
                          type="button"
                          className="number-step"
                          aria-label="Increase user limit"
                          disabled={busy || userLimit >= 99}
                          onClick={() =>
                            setUserLimit((v) => Math.min(99, v + 1))
                          }
                        >
                          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                            <path
                              d="M2 8l4-4 4 4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="number-step"
                          aria-label="Decrease user limit"
                          disabled={busy || userLimit <= 0}
                          onClick={() =>
                            setUserLimit((v) => Math.max(0, v - 1))
                          }
                        >
                          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                            <path
                              d="M2 4l4 4 4-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
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
                    className={sameId(selectedRoleId, role.id) ? "active" : ""}
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <span className="role-dot" style={{ background: role.color }} />
                    {role.name}
                  </button>
                ))}
              </aside>
              <div className="perm-editor stack">
                {!isCategory && (
                  <div className="settings-section private-lock-card">
                    <h4>Private channel</h4>
                    <p className="muted tiny">
                      Lock this channel so only chosen roles can see and open it.
                      Server owners always retain access.
                    </p>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={privateLocked}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setPrivateLocked(checked);
                          if (!checked) {
                            setAccessRoleIds([]);
                            return;
                          }
                          setAccessRoleIds((ids) => {
                            if (ids.length > 0) return ids;
                            const myRole = roles.find(
                              (r) =>
                                !isEveryoneRole(r) &&
                                me?.role_ids.some((id) => sameId(id, r.id)),
                            );
                            return myRole ? [myRole.id] : ids;
                          });
                        }}
                      />
                      <span>Make private / locked</span>
                    </label>
                    {privateLocked && (
                      <div className="private-role-list">
                        <p className="muted tiny">Who can access:</p>
                        {roles
                          .filter((r) => !isEveryoneRole(r))
                          .map((role) => (
                            <label key={role.id} className="check-row">
                              <input
                                type="checkbox"
                                checked={accessRoleIds.some((id) =>
                                  sameId(id, role.id),
                                )}
                                onChange={(e) => {
                                  setAccessRoleIds((ids) =>
                                    e.target.checked
                                      ? ids.some((id) => sameId(id, role.id))
                                        ? ids
                                        : [...ids, role.id]
                                      : ids.filter((id) => !sameId(id, role.id)),
                                  );
                                }}
                              />
                              <span
                                className="role-dot"
                                style={{ background: role.color }}
                              />
                              <span>{role.name}</span>
                            </label>
                          ))}
                        {roles.filter((r) => !isEveryoneRole(r)).length === 0 && (
                          <p className="muted tiny">
                            Create a role first, then grant it access here.
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={busy || (privateLocked && accessRoleIds.length === 0)}
                      onClick={() => void onSavePrivateLock()}
                    >
                      {busy ? "Saving…" : "Save lock settings"}
                    </button>
                  </div>
                )}
                {!selectedRoleId ? (
                  <p className="muted">Select a role to edit overwrites.</p>
                ) : (
                  <>
                    <p className="muted tiny">
                      Allow / Deny / Inherit for{" "}
                      <strong>
                        {roles.find((r) => sameId(r.id, selectedRoleId))?.name ||
                          "role"}
                      </strong>
                      . Role allows can restore what @everyone denied.
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
                {err && <p className="form-error">{err}</p>}
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy}
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
