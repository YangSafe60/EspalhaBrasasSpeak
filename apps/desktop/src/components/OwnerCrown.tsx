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
      <path
        fill="currentColor"
        d="M2.5 12.5h11v1.25a.75.75 0 0 1-.75.75h-9.5a.75.75 0 0 1-.75-.75V12.5Zm.4-1.5 1.85-5.1a.4.4 0 0 1 .74-.04L7 9.2l1.51-3.34a.4.4 0 0 1 .74 0L10.76 6l1.85-5.1a.4.4 0 0 1 .76.22l1.1 6.88H1.04L2.14 1.12a.4.4 0 0 1 .76-.22Z"
      />
    </svg>
  );
}
