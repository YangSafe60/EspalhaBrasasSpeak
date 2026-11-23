/**
 * Server rail layout: the order of servers and folders (drag a server onto
 * another to group them). Saved on this device only, like Discord.
 */
export type RailFolder = { type: "folder"; id: string; name: string; color: string; servers: string[]; open: boolean };
export type RailEntry = { type: "server"; id: string } | RailFolder;

const KEY = "serverRailLayout";
export const FOLDER_COLORS = ["#e31b23", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#64748b"];

export function loadLayout(): RailEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveLayout(layout: RailEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

/** Keep only servers I'm in, add new ones at the end, drop empty folders. */
export function reconcile(layout: RailEntry[], serverIds: string[]): RailEntry[] {
  const have = new Set(serverIds);
  const seen = new Set<string>();
  const out: RailEntry[] = [];
  for (const e of layout) {
    if (e.type === "server") {
      if (have.has(e.id) && !seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
      }
    } else {
      const servers = e.servers.filter((id) => have.has(id) && !seen.has(id));
      servers.forEach((id) => seen.add(id));
      if (servers.length > 1) out.push({ ...e, servers });
      else if (servers.length === 1) out.push({ type: "server", id: servers[0] });
    }
  }
  for (const id of serverIds) if (!seen.has(id)) out.push({ type: "server", id });
  return out;
}

/** Take a server out of wherever it is (top level or a folder). */
function without(layout: RailEntry[], serverId: string): RailEntry[] {
  return layout
    .filter((e) => !(e.type === "server" && e.id === serverId))
    .map((e) => (e.type === "folder" ? { ...e, servers: e.servers.filter((s) => s !== serverId) } : e));
}

/** Where a dragged server can land. */
export type DropTarget =
  | { kind: "merge"; serverId: string } // onto another server: new folder (or join its folder)
  | { kind: "folder"; folderId: string } // onto a folder: add to it
  | { kind: "before" | "after"; serverId: string } // next to a server (inside its folder if it's in one)
  | { kind: "before-folder" | "after-folder"; folderId: string };

export function folderOf(layout: RailEntry[], serverId: string): RailFolder | undefined {
  return layout.find((e): e is RailFolder => e.type === "folder" && e.servers.includes(serverId));
}

export function moveServer(layout: RailEntry[], dragged: string, target: DropTarget): RailEntry[] {
  if ("serverId" in target && target.serverId === dragged) return layout;
  const base = without(layout, dragged);
  switch (target.kind) {
    case "merge": {
      const inFolder = folderOf(base, target.serverId);
      if (inFolder) {
        return base.map((e) => (e === inFolder ? { ...inFolder, servers: [...inFolder.servers, dragged] } : e));
      }
      const folder: RailFolder = {
        type: "folder",
        id: `f${Date.now().toString(36)}`,
        name: "",
        color: FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)],
        servers: [target.serverId, dragged],
        open: false,
      };
      return base.map((e) => (e.type === "server" && e.id === target.serverId ? folder : e));
    }
    case "folder":
      return base.map((e) => (e.type === "folder" && e.id === target.folderId ? { ...e, servers: [...e.servers, dragged] } : e));
    case "before":
    case "after": {
      const inFolder = folderOf(base, target.serverId);
      if (inFolder) {
        const servers = [...inFolder.servers];
        const i = servers.indexOf(target.serverId) + (target.kind === "after" ? 1 : 0);
        servers.splice(i, 0, dragged);
        return base.map((e) => (e === inFolder ? { ...inFolder, servers } : e));
      }
      const i = base.findIndex((e) => e.type === "server" && e.id === target.serverId);
      const out = [...base];
      out.splice(i + (target.kind === "after" ? 1 : 0), 0, { type: "server", id: dragged });
      return out;
    }
    case "before-folder":
    case "after-folder": {
      const i = base.findIndex((e) => e.type === "folder" && e.id === target.folderId);
      const out = [...base];
      out.splice(i + (target.kind === "after-folder" ? 1 : 0), 0, { type: "server", id: dragged });
      return out;
    }
  }
}

export function updateFolder(layout: RailEntry[], folderId: string, patch: Partial<RailFolder>): RailEntry[] {
  return layout.map((e) => (e.type === "folder" && e.id === folderId ? { ...e, ...patch } : e));
}

/** Put the folder's servers back on the rail where the folder was. */
export function ungroup(layout: RailEntry[], folderId: string): RailEntry[] {
  return layout.flatMap((e) =>
    e.type === "folder" && e.id === folderId ? e.servers.map((id) => ({ type: "server" as const, id })) : [e],
  );
}
