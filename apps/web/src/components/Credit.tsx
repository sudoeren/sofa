export const AUTHOR_NAME = "Eren Çakar";
export const AUTHOR_URL = "https://erencakar.com";

/** "Made by Eren Çakar" with a link to the author's site. */
export function Credit({ className }: { className?: string }) {
  return (
    <span className={className}>
      Made by{" "}
      <a href={AUTHOR_URL} target="_blank" rel="noreferrer">
        {AUTHOR_NAME}
      </a>
    </span>
  );
}
