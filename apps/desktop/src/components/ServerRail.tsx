import { useAppStore } from "../store/appStore";
import logoMark from "../assets/logo-mark-square.png";

export function ServerRail() {
  const servers = useAppStore((s) => s.servers);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const selectServer = useAppStore((s) => s.selectServer);
  const setModal = useAppStore((s) => s.setModal);

  return (
    <aside className="server-rail">
      <div className="rail-top">
        <div className="rail-brand" title="Espalha Brasas">
          <img src={logoMark} alt="" />
        </div>
        <div className="rail-divider" />
        {servers.map((server) => {
          const initial = server.name.trim().charAt(0).toUpperCase() || "?";
          const active = server.id === activeServerId;
          return (
            <button
              key={server.id}
              type="button"
              className={`server-orb ${active ? "active" : ""}`}
              style={
                server.icon_url
                  ? { backgroundImage: `url(${server.icon_url})` }
                  : { backgroundColor: server.accent_color || "var(--accent)" }
              }
              title={server.name}
              onClick={() => void selectServer(server.id)}
            >
              {!server.icon_url && <span>{initial}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className="server-orb action"
          title="Create server"
          onClick={() => setModal("create-server")}
        >
          +
        </button>
        <button
          type="button"
          className="server-orb action"
          title="Join with invite"
          onClick={() => setModal("join-invite")}
        >
          ↪
        </button>
      </div>
    </aside>
  );
}
