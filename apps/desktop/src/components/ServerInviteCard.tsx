import { mediaUrl } from "../lib/mediaUrl";

export type ServerInviteCardProps = {
  name: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  accentColor?: string | null;
  memberCount: number;
  onlineCount: number;
  createdAt: string;
  ctaLabel?: string;
  onCta?: () => void;
  ctaBusy?: boolean;
  ctaDisabled?: boolean;
  hideCta?: boolean;
  footer?: string | null;
};

function formatEstablished(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Est. ${month} ${d.getFullYear()}`;
}

export function ServerInviteCard({
  name,
  iconUrl,
  bannerUrl,
  accentColor,
  memberCount,
  onlineCount,
  createdAt,
  ctaLabel,
  onCta,
  ctaBusy,
  ctaDisabled,
  hideCta,
  footer,
}: ServerInviteCardProps) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const banner = bannerUrl || null;
  const accent = accentColor || "#5865f2";
  const est = formatEstablished(createdAt);

  return (
    <div className="server-invite-card">
      <div
        className={`server-invite-banner${banner ? "" : " is-empty"}`}
        style={
          banner
            ? { backgroundImage: `url(${mediaUrl(banner)})` }
            : {
                background: `linear-gradient(180deg, ${accent} 0%, #0a0a0a 100%)`,
              }
        }
      />
      <div className="server-invite-icon-row">
        {iconUrl ? (
          <img
            className="server-invite-icon"
            src={mediaUrl(iconUrl)}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="server-invite-icon placeholder"
            style={{ background: accent }}
          >
            {initial}
          </span>
        )}
      </div>
      <div className="server-invite-body">
        <h3 className="server-invite-name">{name}</h3>
        <div className="server-invite-counts">
          <span className="server-invite-stat">
            <i className="server-invite-dot online" aria-hidden />
            {onlineCount} Online
          </span>
          <span className="server-invite-stat">
            <i className="server-invite-dot members" aria-hidden />
            {memberCount} Members
          </span>
        </div>
        {est ? <p className="server-invite-est">{est}</p> : null}
        {footer ? <p className="server-invite-footer">{footer}</p> : null}
        {!hideCta && ctaLabel ? (
          <button
            type="button"
            className="btn server-invite-cta"
            disabled={ctaDisabled || ctaBusy || !onCta}
            onClick={() => onCta?.()}
          >
            {ctaBusy ? "…" : ctaLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
