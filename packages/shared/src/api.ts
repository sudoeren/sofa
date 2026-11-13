import { z } from "zod";

/** REST contract. All routes are under /api. Errors are { error: string } with a 4xx/5xx status. */

export const SPACE_ID_LENGTH = 21;
export const LIMITS = {
  titleLength: 120,
  promptLength: 4000,
  noteLength: 8000,
  fileBytes: 10 * 1024 * 1024,
  filesPerSpace: 50,
} as const;

export const userSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
});
export type UserRef = z.infer<typeof userSchema>;

/** POST /api/spaces */
export const createSpaceBody = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleLength),
  /** optional password; when set the space is locked */
  password: z.string().min(4).max(200).optional(),
});
export type CreateSpaceBody = z.infer<typeof createSpaceBody>;
/** token is only present in the POST /api/spaces response of a locked space */
export type SpaceInfo = {
  id: string;
  title: string;
  createdAt: number;
  locked: boolean;
  token?: string;
};

/** GET /api/spaces/:id -> SpaceInfo (404 when missing). Never requires a token. */

/**
 * Locked spaces. POST /api/spaces/:id/unlock { password } -> 200 { token } or 403.
 * The token is an HMAC over the space id signed with a server secret kept in the data dir.
 * Every other route of a locked space, the collab socket and its files require it:
 *   REST:    Authorization: Bearer <token>
 *   collab:  the Hocuspocus `token`
 *   files:   GET /api/files/:fileId?t=<token>
 * Unlocked spaces ignore tokens.
 */
export const unlockBody = z.object({ password: z.string().min(1).max(200) });
export type UnlockResponse = { token: string };

/** GET /api/config */
export type TemplateInfo = { id: string; title: string; description: string };
export type ServerConfig = {
  /** true when the host configured a provider; members can still bring their own key */
  aiEnabled: boolean;
  provider: string | null;
  model: string | null;
  templates: TemplateInfo[];
};

/**
 * POST /api/spaces/:id/generate -> 202 { messageId }
 * Appends the user message and a pending assistant message to chat, then works in the
 * background: creates or updates a tool in the doc and marks the assistant message done/error.
 * toolId present means "change this tool".
 */
/**
 * A member's own key, kept in their browser and sent with each request. The server uses
 * it for that request only and never stores or logs it. Only hosted providers are allowed
 * here; custom base URLs can only be set by the host through the environment.
 */
export const userAiSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  apiKey: z.string().min(8).max(400),
  model: z.string().min(1).max(100).optional(),
});
export type UserAi = z.infer<typeof userAiSchema>;

export const generateBody = z.object({
  prompt: z.string().trim().min(1).max(LIMITS.promptLength),
  toolId: z.string().min(1).max(64).optional(),
  user: userSchema,
  /** used instead of the server's provider when present */
  ai: userAiSchema.optional(),
});
export type GenerateBody = z.infer<typeof generateBody>;
export type GenerateResponse = { messageId: string };

/** POST /api/spaces/:id/templates/:templateId  body { user } -> 201 { toolId } */
export const useTemplateBody = z.object({ user: userSchema });
export type UseTemplateResponse = { toolId: string };

/** POST /api/spaces/:id/files (multipart, field "file") -> 201 FileInfo */
export type FileInfo = { fileId: string; name: string; mime: string; size: number; url: string };
/** GET /api/files/:fileId -> the file, served as an attachment unless it is an image */

/** POST /api/spaces/:id/links  body { url } -> 200 LinkPreview */
export const linkBody = z.object({ url: z.string().url().max(2000) });
export type LinkPreview = { url: string; title: string; description: string };

/** WebSocket: /collab, Hocuspocus protocol, document name = space id. */
export const COLLAB_PATH = "/collab";
