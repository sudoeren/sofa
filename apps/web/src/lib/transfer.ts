import {
  SPACE_EXPORT_FORMAT,
  SPACE_EXPORT_VERSION,
  type SpaceExport,
  spaceExportSchema,
} from "@sofa/shared";
import { exportSpace } from "./api";

/** Export files are JSON with the whole document in base64; anything far larger is not ours. */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

export function exportFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "space"}.sofa.json`;
}

/** Fetch the export of a space (with the token of a locked space) and save it as a file. */
export async function downloadSpace(spaceId: string, title: string): Promise<void> {
  const data = await exportSpace(spaceId);
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(data.title || title);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // give the browser a moment to start the download before the URL goes away
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read and check a picked .sofa.json file. Throws an Error with a message for the member. */
export async function readSpaceFile(file: File): Promise<SpaceExport> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too large to be a Sofa space.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a Sofa space. Pick a .sofa.json file downloaded from Sofa.");
  }
  const format = (parsed as { format?: unknown } | null)?.format;
  if (format !== SPACE_EXPORT_FORMAT) {
    throw new Error("That file is not a Sofa space. Pick a .sofa.json file downloaded from Sofa.");
  }
  const version = (parsed as { version?: unknown }).version;
  if (version !== SPACE_EXPORT_VERSION) {
    throw new Error("That file was made by a different version of Sofa and cannot be opened here.");
  }
  const result = spaceExportSchema.safeParse(parsed);
  if (!result.success) throw new Error("That file is damaged or incomplete.");
  return result.data;
}
