import type {
  CreateSpaceBody,
  FileInfo,
  GenerateBody,
  GenerateResponse,
  LinkPreview,
  ServerConfig,
  SpaceInfo,
  UnlockResponse,
  UserRef,
  UseTemplateResponse,
} from "@sofra/shared";
import { getSpaceToken } from "./storage";

/** An error response from the server, or a failed request (status 0). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const FALLBACK: Record<number, string> = {
  400: "The server did not accept that request.",
  401: "This space is locked. Unlock it again to continue.",
  403: "That is not allowed. If the space is locked, the password may be wrong.",
  404: "Not found.",
  413: "That is too large.",
  429: "Too many requests. Wait a moment and try again.",
};

type Options = {
  method?: "GET" | "POST";
  /** JSON body */
  json?: unknown;
  /** multipart body */
  form?: FormData;
  /** adds the stored bearer token of this space, when there is one */
  spaceId?: string;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  if (options.spaceId) {
    const token = getSpaceToken(options.spaceId);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }

  let payload: unknown = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const fromServer =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "";
    throw new ApiError(
      fromServer || FALLBACK[response.status] || `Something went wrong (${response.status}).`,
      response.status,
    );
  }
  return payload as T;
}

const enc = encodeURIComponent;

export function getConfig(signal?: AbortSignal): Promise<ServerConfig> {
  return request<ServerConfig>("/config", { signal });
}

export function createSpace(body: CreateSpaceBody): Promise<SpaceInfo> {
  return request<SpaceInfo>("/spaces", { json: body });
}

export function getSpace(spaceId: string, signal?: AbortSignal): Promise<SpaceInfo> {
  return request<SpaceInfo>(`/spaces/${enc(spaceId)}`, { signal });
}

export function unlockSpace(spaceId: string, password: string): Promise<UnlockResponse> {
  return request<UnlockResponse>(`/spaces/${enc(spaceId)}/unlock`, { json: { password } });
}

export function generate(spaceId: string, body: GenerateBody): Promise<GenerateResponse> {
  return request<GenerateResponse>(`/spaces/${enc(spaceId)}/generate`, { json: body, spaceId });
}

export function applyTemplate(
  spaceId: string,
  templateId: string,
  user: UserRef,
): Promise<UseTemplateResponse> {
  return request<UseTemplateResponse>(`/spaces/${enc(spaceId)}/templates/${enc(templateId)}`, {
    json: { user },
    spaceId,
  });
}

export function uploadFile(spaceId: string, file: File): Promise<FileInfo> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request<FileInfo>(`/spaces/${enc(spaceId)}/files`, { form, spaceId });
}

export function previewLink(spaceId: string, url: string): Promise<LinkPreview> {
  return request<LinkPreview>(`/spaces/${enc(spaceId)}/links`, { json: { url }, spaceId });
}

/** Download or thumbnail URL of an uploaded file; locked spaces need the token in the query. */
export function fileUrl(fileId: string, spaceId: string): string {
  const token = getSpaceToken(spaceId);
  const base = `/api/files/${enc(fileId)}`;
  return token ? `${base}?t=${enc(token)}` : base;
}
