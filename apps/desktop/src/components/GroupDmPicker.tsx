import { useMemo, useState } from "react";
import { MAX_GROUP_MEMBERS } from "../lib/dmDisplay";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { DmChannel, UserPublic } from "../types";

function PickAvatar({ user }: { user: UserPublic }) {
  const initial = (user.display_name || user.username || "?").charAt(0).toUpperCase();
  return user.avatar_url ? (
    <img className="friends-avatar" src={mediaUrl(user.avatar_url)} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="friends-avatar placeholder">{initial}</span>
  );
}

/**
 * Pick friends for a new group DM, or to add to an existing group (`group`).
 * Starting from a 1:1 DM (`fromDm`), its peer is pre-selected, like Discord.
 */
export function GroupDmPicker({
  group,
  fromDm,
  onClose,
}: {
  group?: DmChannel;
  fromDm?: DmChannel;
  onClose: () => void;
}) {
  const friends = useAppStore((s) => s.friends);
  const createGroupDm = useAppStore((s) => s.createGroupDm);
  const addGroupDmMember = useAppStore((s) => s.addGroupDmMember);
  const selectDm = useAppStore((s) => s.selectDm);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(fromDm && !fromDm.is_group ? [fromDm.peer.id] : []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const already = useMemo(() => new Set((group?.members || []).map((m) => m.id)), [group]);
  // Room left: the group's current size (or just me) plus the picks.
  const room = MAX_GROUP_MEMBERS - (group ? already.size : 1);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends
      .filter((f) => f.status === "accepted" && !already.has(f.peer.id))
      .map((f) => f.peer)
      .filter(
        (u) =>
          !q ||
          u.display_name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q),
      )
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [friends, already, query]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < room) next.add(id);
      return next;
    });
  }

  async function submit() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (group) {
        for (const id of picked) await addGroupDmMember(group.id, id);
      } else {
        const id = await createGroupDm([...picked], name);
        void selectDm(id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal group-dm-picker"
        role="dialog"
        aria-label={group ? "Add friends to the group" : "Create a group DM"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>{group ? "Add friends" : "Create group DM"}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted tiny">
          {picked.size > 0
            ? `${picked.size} selected · up to ${room} more can join`
            : `Pick up to ${room} friends. Messages stay end-to-end encrypted.`}
        </p>
        {!group && (
          <input
            className="group-dm-name"
            placeholder="Group name (optional)"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          type="search"
          placeholder="Search friends"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className="group-dm-list">
          {list.length === 0 && (
            <li className="muted tiny group-dm-empty">
              {friends.length === 0 ? "Add some friends first." : "No friends to add."}
            </li>
          )}
          {list.map((u) => {
            const on = picked.has(u.id);
            const full = !on && picked.size >= room;
            return (
              <li key={u.id}>
                <label className={`group-dm-row${full ? " is-full" : ""}`}>
                  <span className="friends-avatar-wrap sm">
                    <PickAvatar user={u} />
                  </span>
                  <span className="group-dm-who">
                    <strong>{u.display_name}</strong>
                    <span className="muted">@{u.username}</span>
                  </span>
                  <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(u.id)} />
                </label>
              </li>
            );
          })}
        </ul>
        {error && <p className="form-error tiny">{error}</p>}
        <footer className="group-dm-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={picked.size === 0 || busy}
            onClick={() => void submit()}
          >
            {group ? "Add" : "Create group"}
          </button>
        </footer>
      </div>
    </div>
  );
}
