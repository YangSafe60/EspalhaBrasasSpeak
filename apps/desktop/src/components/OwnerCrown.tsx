/** Discord-style server owner crown. */
export function OwnerCrown({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `owner-crown ${className}` : "owner-crown"}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
    >
      <title>Server Owner</title>
      {/* Solid three-peak crown — reads cleanly at 14px */}
      <path
        fill="currentColor"
        d="M2 12.25 3.6 4.5 6.25 8 8 3.25 9.75 8l2.65-3.5L14 12.25H2Zm0 .75h12v1.1a.9.9 0 0 1-.9.9H2.9a.9.9 0 0 1-.9-.9V13Z"
      />
    </svg>
  );
}
