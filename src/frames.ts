import type { Frame } from "./types";

/** Public camera constants used by the worker and the diagnostic check route. */
export const PANOCAM_ASSET_BASE_URL = "https://d3omclagh7m7mg.cloudfront.net/assets";
export const PANOCAM_SHARE_FILENAME = "share.jpg";
export const PANOCAM_SLICE_FILENAME = "slice";
export const PANOCAM_CAMERA_URL = "https://www.spaceneedle.com/webcam";
export const PANOCAM_PROBE_COUNT = 12;
export const PANOCAM_SLICE_WIDTH = 512;
export const PANOCAM_SLICE_HEIGHT = 1080;
export const PANOCAM_STITCH_SLICES = [6, 7, 8, 9] as const;
export const PANOCAM_RAW_SLICE_INDEX = 9;
export const PANOCAM_DEFAULT_VIEW_POSITION = 3400;
export const PANOCAM_OUTPUT_WIDTH = 1440;
export const PANOCAM_OUTPUT_HEIGHT = 1080;
export const PANOCAM_INTERVAL_MINUTES = 10;
export const DEFAULT_FRAME_REQUEST_TIMEOUT_MS = 10_000;

export interface DiscoverLatestFrameOptions {
 /** Time used as the upper bound. Defaults to the current instant. */
 now?: Date | number;
 /** Frame id to ignore, even when its share image exists. */
 lastFrame?: string;
 /** Injectable fetch implementation for tests and development routes. */
 fetch?: typeof fetch;
 /** Alias accepted by callers that prefer to name the network boundary. */
 fetcher?: typeof fetch;
 /** HEAD is cheap; GET is useful with origins that do not support HEAD. */
 method?: "HEAD" | "GET";
 /** Maximum number of ten-minute marks to probe. Never exceeds 12. */
 maxProbes?: number;
 /** Maximum milliseconds spent on one CDN probe. */
 timeoutMs?: number;
}

interface PacificParts {
 year: number;
 month: number;
 day: number;
 hour: number;
 minute: number;
 second: number;
}

/** Parse the camera's YYYY_MMDD_HHmmss frame identifier. */
export function parseFrameId(id: string): PacificParts | null {
 const match = /^(\d{4})[_-](\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})$/.exec(id);
 if (!match) return null;
 const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
 const year = Number(yearText);
 const month = Number(monthText);
 const day = Number(dayText);
 const hour = Number(hourText);
 const minute = Number(minuteText);
 const second = Number(secondText);
 const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
 if (
  check.getUTCFullYear() !== year ||
  check.getUTCMonth() !== month - 1 ||
  check.getUTCDate() !== day ||
  check.getUTCHours() !== hour ||
  check.getUTCMinutes() !== minute ||
  check.getUTCSeconds() !== second
 ) {
  return null;
 }
 return { year, month, day, hour, minute, second };
}

function pacificParts(instant: Date): PacificParts {
 const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
 }).formatToParts(instant);
 const get = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
 return {
  year: get("year"),
  month: get("month"),
  day: get("day"),
  hour: get("hour"),
  minute: get("minute"),
  second: get("second"),
 };
}

/** Turn a Pacific wall-clock value into its real instant, including DST. */
function pacificToInstant(parts: PacificParts): Date {
 // Treat the wall clock as UTC first, then repeatedly correct by the timezone
 // difference observed at that guess. Two passes handle DST transitions.
 let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
 for (let pass = 0; pass < 3; pass += 1) {
  const observed = pacificParts(new Date(guess));
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
  guess += desiredAsUtc - observedAsUtc;
 }
 return new Date(guess);
}

function frameIdFromPacific(parts: PacificParts): string {
 const pad = (value: number) => String(value).padStart(2, "0");
 return `${String(parts.year).padStart(4, "0")}_${pad(parts.month)}${pad(parts.day)}_${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
}

export function frameAssetBaseUrl(id: string): string {
 const parts = parseFrameId(id);
 if (!parts) throw new Error(`Invalid PanoCam frame id: ${id}`);
 return `${PANOCAM_ASSET_BASE_URL}/${parts.year}/${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}/${id}`;
}

export function frameFromId(id: string): Frame {
 const parts = parseFrameId(id);
 if (!parts) throw new Error(`Invalid PanoCam frame id: ${id}`);
 const capturedAt = pacificToInstant(parts);
 const assetBaseUrl = frameAssetBaseUrl(id);
 return {
  id,
  timestamp: capturedAt.toISOString(),
  capturedAt,
  assetBaseUrl,
  shareUrl: `${assetBaseUrl}/${PANOCAM_SHARE_FILENAME}`,
 };
}

function optionValue(
 lastFrameOrOptions: string | DiscoverLatestFrameOptions | undefined,
 maybeOptions: DiscoverLatestFrameOptions | undefined,
): DiscoverLatestFrameOptions {
 if (typeof lastFrameOrOptions === "string") return { ...maybeOptions, lastFrame: lastFrameOrOptions };
 return lastFrameOrOptions ?? maybeOptions ?? {};
}

/**
 * Find the newest available camera frame without downloading the 7.9MB data
 * index. The origin stores images on ten-minute Pacific marks.
 */
export async function discoverLatestFrame(
 options?: DiscoverLatestFrameOptions,
): Promise<Frame | null>;
export async function discoverLatestFrame(
 lastFrame: string | undefined,
 options?: DiscoverLatestFrameOptions,
): Promise<Frame | null>;
export async function discoverLatestFrame(
 lastFrameOrOptions: string | DiscoverLatestFrameOptions | undefined = undefined,
 maybeOptions?: DiscoverLatestFrameOptions,
): Promise<Frame | null> {
 const options = optionValue(lastFrameOrOptions, maybeOptions);
 const instant = options.now === undefined ? new Date() : new Date(options.now);
 if (Number.isNaN(instant.getTime())) throw new Error("Invalid discovery time");
 const now = pacificParts(instant);
 now.minute = Math.floor(now.minute / PANOCAM_INTERVAL_MINUTES) * PANOCAM_INTERVAL_MINUTES;
 now.second = 0;
 const markInstant = pacificToInstant(now);
 const probes = Math.min(PANOCAM_PROBE_COUNT, Math.max(1, Math.floor(options.maxProbes ?? PANOCAM_PROBE_COUNT)));
 const fetchImpl = options.fetcher ?? options.fetch ?? fetch;
 const method = options.method ?? "HEAD";
 const timeoutMs = options.timeoutMs ?? DEFAULT_FRAME_REQUEST_TIMEOUT_MS;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new RangeError("Frame request timeout must be a positive number");
 }

 for (let probe = 0; probe < probes; probe += 1) {
  const markParts = pacificParts(new Date(markInstant.getTime() - probe * PANOCAM_INTERVAL_MINUTES * 60_000));
  const id = frameIdFromPacific({ ...markParts, second: 0 });
  if (id === options.lastFrame) return null;
  const frame = frameFromId(id);
  let response: Response;
  try {
   response = await fetchImpl(frame.shareUrl, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
   });
   // A few static origins reject HEAD while serving GET normally. This is a
   // fallback for that case and does not consume another candidate probe.
   if (method === "HEAD" && (response.status === 405 || response.status === 501)) {
    response = await fetchImpl(frame.shareUrl, {
     method: "GET",
     signal: AbortSignal.timeout(timeoutMs),
    });
   }
  } catch {
   continue;
  }
  if (response.ok || (response.status >= 200 && response.status < 400)) return frame;
 }
 return null;
}

export function sliceAssetUrl(frame: Frame, index: number): string {
 if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid PanoCam slice index: ${index}`);
 return `${frame.assetBaseUrl}/${PANOCAM_SLICE_FILENAME}${index}.jpg`;
}
