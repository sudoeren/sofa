/** The Sofa logo is the name itself, set in lower case. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      sofa
    </span>
  );
}
