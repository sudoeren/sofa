/** The Sofra mark: a round table with four seats. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="var(--accent-text)" strokeWidth="2.5" />
      <circle cx="16" cy="5.75" r="2" fill="var(--accent-text)" />
      <circle cx="16" cy="26.25" r="2" fill="var(--accent-text)" />
      <circle cx="5.75" cy="16" r="2" fill="var(--accent-text)" />
      <circle cx="26.25" cy="16" r="2" fill="var(--accent-text)" />
    </svg>
  );
}
