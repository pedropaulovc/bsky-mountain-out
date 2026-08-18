import type { ImageArtifact } from "./types";

const DEFAULT_SERVICE = "https://bsky.social";
const SESSION_ENDPOINT = "com.atproto.server.createSession";
const UPLOAD_ENDPOINT = "com.atproto.repo.uploadBlob";
const CREATE_RECORD_ENDPOINT = "com.atproto.repo.createRecord";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface BlueskySession {
 accessJwt: string;
 did: string;
 handle?: string;
 refreshJwt?: string;
}

export interface BlueskyClientOptions {
 identifier: string;
 appPassword: string;
 serviceUrl?: string;
 fetcher?: typeof fetch;
 timeoutMs?: number;
}

export interface CreateImagePostInput {
 image: ImageArtifact | Uint8Array;
 altText: string;
 text?: string;
 createdAt?: string | Date;
}

export interface CreatedPost {
 uri: string;
 cid: string;
}

interface UploadBlobResponse {
 blob?: Record<string, unknown>;
}

interface CreateRecordResponse {
 uri?: unknown;
 cid?: unknown;
}

interface XrpcErrorBody {
 error?: unknown;
 message?: unknown;
}

export interface BlueskyClient {
 /** Login once, lazily, and retain the session only for this client/invocation. */
 getSession(): Promise<BlueskySession>;
 uploadBlob(image: ImageArtifact | Uint8Array): Promise<Record<string, unknown>>;
 createPost(input: CreateImagePostInput): Promise<CreatedPost>;
}

/**
 * Create a small XRPC client. No session request is made until an operation
 * requiring authentication is performed.
 */
export function createBlueskyClient(options: BlueskyClientOptions): BlueskyClient {
 const identifier = options.identifier.trim();
 const appPassword = options.appPassword;
 if (!identifier) throw new Error("Bluesky identifier is required");
 if (!appPassword) throw new Error("Bluesky app password is required");

 const serviceUrl = (options.serviceUrl ?? DEFAULT_SERVICE).replace(/\/$/, "");
 const fetcher = options.fetcher ?? fetch;
 const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new RangeError("Bluesky request timeout must be a positive number");
 }
 let sessionPromise: Promise<BlueskySession> | undefined;

 const getSession = (): Promise<BlueskySession> => {
  sessionPromise ??= requestSession(fetcher, serviceUrl, identifier, appPassword, timeoutMs);
  return sessionPromise;
 };

 const uploadBlob = async (image: ImageArtifact | Uint8Array): Promise<Record<string, unknown>> => {
  const bytes = image instanceof Uint8Array ? image : image.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
   throw new Error("Bluesky image must contain JPEG bytes");
  }
  if (!(image instanceof Uint8Array) && image.contentType !== "image/jpeg") {
   throw new Error("Bluesky image must have content type image/jpeg");
  }

  const session = await getSession();
  const response = await fetcher(`${serviceUrl}/xrpc/${UPLOAD_ENDPOINT}`, {
   method: "POST",
   headers: {
    Authorization: `Bearer ${session.accessJwt}`,
    "Content-Type": "image/jpeg",
   },
   body: bytes as unknown as BodyInit,
   signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await readXrpcResponse<UploadBlobResponse>(response, UPLOAD_ENDPOINT);
  if (!data.blob || typeof data.blob !== "object") {
   throw new Error(`Bluesky ${UPLOAD_ENDPOINT} response did not include a blob`);
  }
  return data.blob;
 };

 const createPost = async (input: CreateImagePostInput): Promise<CreatedPost> => {
  const altText = typeof input.altText === "string" ? input.altText.trim() : "";
  if (!altText) throw new Error("Bluesky image alt text is required");

  const session = await getSession();
  const blob = await uploadBlob(input.image);
  const createdAt = normalizeCreatedAt(input.createdAt);
  const record = {
   $type: "app.bsky.feed.post",
   text: input.text ?? "",
   createdAt,
   embed: {
    $type: "app.bsky.embed.images",
    images: [{ alt: altText, image: blob }],
   },
  };

  const response = await fetcher(`${serviceUrl}/xrpc/${CREATE_RECORD_ENDPOINT}`, {
   method: "POST",
   headers: {
    Authorization: `Bearer ${session.accessJwt}`,
    "Content-Type": "application/json",
   },
   body: JSON.stringify({
    repo: session.did,
    collection: "app.bsky.feed.post",
    record,
   }),
   signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await readXrpcResponse<CreateRecordResponse>(response, CREATE_RECORD_ENDPOINT);
  if (typeof data.uri !== "string" || typeof data.cid !== "string" || !data.uri || !data.cid) {
   throw new Error(`Bluesky ${CREATE_RECORD_ENDPOINT} response did not include uri and cid`);
  }
  return { uri: data.uri, cid: data.cid };
 };

 return { getSession, uploadBlob, createPost };
}


/** Convenience one-shot helper for a single Worker invocation. */
export async function postImageToBluesky(
 options: BlueskyClientOptions,
 input: CreateImagePostInput,
): Promise<CreatedPost> {
 return createBlueskyClient(options).createPost(input);
}


async function requestSession(
 fetcher: typeof fetch,
 serviceUrl: string,
 identifier: string,
 appPassword: string,
 timeoutMs: number,
): Promise<BlueskySession> {
 const response = await fetcher(`${serviceUrl}/xrpc/${SESSION_ENDPOINT}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier, password: appPassword }),
  signal: AbortSignal.timeout(timeoutMs),
 });
 const data = await readXrpcResponse<Partial<BlueskySession>>(response, SESSION_ENDPOINT);
 if (typeof data.accessJwt !== "string" || typeof data.did !== "string" || !data.accessJwt || !data.did) {
  throw new Error(`Bluesky ${SESSION_ENDPOINT} response did not include accessJwt and did`);
 }
 return {
  accessJwt: data.accessJwt,
  did: data.did,
  ...(typeof data.handle === "string" ? { handle: data.handle } : {}),
  ...(typeof data.refreshJwt === "string" ? { refreshJwt: data.refreshJwt } : {}),
 };
}

function normalizeCreatedAt(value: string | Date | undefined): string {
 const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
 if (Number.isNaN(date.getTime())) throw new Error("Bluesky createdAt must be a valid date");
 return date.toISOString();
}

async function readXrpcResponse<T>(response: Response, operation: string): Promise<T> {
 const body = await response.text();
 let data: unknown;
 if (body) {
  try {
   data = JSON.parse(body);
  } catch {
   data = undefined;
  }
 }

 if (!response.ok) {
  const api = data && typeof data === "object" ? (data as XrpcErrorBody) : undefined;
  const apiError = typeof api?.error === "string" ? api.error : undefined;
  const apiMessage = typeof api?.message === "string" ? api.message : undefined;
  const context = [
   `Bluesky ${operation} failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`,
   apiError,
   apiMessage,
   !apiError && !apiMessage && body ? body.slice(0, 500) : undefined,
  ].filter(Boolean).join(": ");
  throw new Error(context);
 }
 if (data === undefined) {
  throw new Error(`Bluesky ${operation} returned an invalid JSON response`);
 }
 return data as T;
}
