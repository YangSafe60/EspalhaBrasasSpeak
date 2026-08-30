type Props = {
  name: string;
  onJoin: () => void;
};

/** Opt-in card shown when someone is sharing but the viewer has not joined yet. */
export function LobbyScreenInvite({ name, onJoin }: Props) {
  return (
    <div className="lobby-screen-tile lobby-screen-invite">
      <div className="lobby-screen-invite-body">
        <p className="lobby-screen-invite-label">{name} is sharing</p>
        <p className="muted tiny">Join the stream to watch</p>
        <button type="button" className="btn primary sm" onClick={onJoin}>
          Join stream
        </button>
      </div>
    </div>
  );
}
