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
      <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="3.5" r="2.25" fill="currentColor" />
      <circle cx="16" cy="28.5" r="2.25" fill="currentColor" />
      <circle cx="3.5" cy="16" r="2.25" fill="currentColor" />
      <circle cx="28.5" cy="16" r="2.25" fill="currentColor" />
    </svg>
  );
}
