import {
 crop,
 draw_text_with_color,
 PhotonImage,
 Rgba,
 resize,
 SamplingFilter,
} from "@cf-wasm/photon/workerd";
import type { Frame, ImageArtifact, ImageMode } from "./types";
import {
 PANOCAM_CAMERA_URL,
 PANOCAM_CENTER_X,
 PANOCAM_OUTPUT_HEIGHT,
 PANOCAM_OUTPUT_WIDTH,
 PANOCAM_RAW_SLICE_INDEX,
 PANOCAM_SLICE_HEIGHT,
 PANOCAM_SLICE_WIDTH,
 PANOCAM_STITCH_SLICES,
 sliceAssetUrl,
} from "./frames";

/** Output and source geometry are deliberately fixed for predictable bot posts. */
export const PANOCAM_JPEG_QUALITY = 90;
export const PANOCAM_CREDIT_STRIP_HEIGHT = 64;
export const PANOCAM_STITCHED_WIDTH = PANOCAM_STITCH_SLICES.length * PANOCAM_SLICE_WIDTH;
export const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 10_000;

export interface BuildImageOptions {
 /** Injectable image fetch implementation for tests and development routes. */
 fetch?: typeof fetch;
 /** Alias accepted by callers that prefer to name the network boundary. */
 fetcher?: typeof fetch;
 /** Maximum milliseconds spent downloading one slice. */
 timeoutMs?: number;
}

interface DecodedSlice {
 image: PhotonImage;
 width: number;
 height: number;
}

function responseSucceeded(response: Response): boolean {
 return response.ok || (response.status >= 200 && response.status < 400);
}

async function fetchSlice(
 fetchImpl: typeof fetch,
 frame: Frame,
 index: number,
 timeoutMs: number,
): Promise<PhotonImage> {
 const response = await fetchImpl(sliceAssetUrl(frame, index), {
  method: "GET",
  signal: AbortSignal.timeout(timeoutMs),
 });
 if (!responseSucceeded(response)) {
  throw new Error(`PanoCam slice ${index} returned HTTP ${response.status}`);
 }
 const bytes = new Uint8Array(await response.arrayBuffer());
 if (bytes.byteLength === 0) throw new Error(`PanoCam slice ${index} was empty`);
 return PhotonImage.new_from_byteslice(bytes);
}

function normalizeSlice(source: PhotonImage): DecodedSlice {
 const width = source.get_width();
 const height = source.get_height();
 if (width === PANOCAM_SLICE_WIDTH && height === PANOCAM_SLICE_HEIGHT) {
  return { image: source, width, height };
 }
 const normalized = resize(source, PANOCAM_SLICE_WIDTH, PANOCAM_SLICE_HEIGHT, SamplingFilter.Triangle);
 source.free();
 return {
  image: normalized,
  width: PANOCAM_SLICE_WIDTH,
  height: PANOCAM_SLICE_HEIGHT,
 };
}

function copySliceIntoPanorama(target: Uint8Array, slice: PhotonImage, targetX: number): void {
 const source = slice.get_raw_pixels();
 const sourceWidth = slice.get_width();
 const sourceHeight = slice.get_height();
 const targetWidth = PANOCAM_STITCHED_WIDTH;
 for (let y = 0; y < sourceHeight; y += 1) {
  const sourceStart = y * sourceWidth * 4;
  const targetStart = (y * targetWidth + targetX) * 4;
  target.set(source.subarray(sourceStart, sourceStart + PANOCAM_SLICE_WIDTH * 4), targetStart);
 }
}

function composeStitched(slices: DecodedSlice[]): PhotonImage {
 const pixels = new Uint8Array(PANOCAM_STITCHED_WIDTH * PANOCAM_SLICE_HEIGHT * 4);
 for (let index = 0; index < slices.length; index += 1) {
  copySliceIntoPanorama(pixels, slices[index].image, index * PANOCAM_SLICE_WIDTH);
 }
 return new PhotonImage(pixels, PANOCAM_STITCHED_WIDTH, PANOCAM_SLICE_HEIGHT);
}

function creditTimestamp(frame: Frame): string {
 const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
 }).formatToParts(frame.capturedAt);
 const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
 const dayPeriod = (values.dayPeriod ?? "").toLowerCase();
 return `${values.month} ${values.day} ${values.year} ${values.hour}:${values.minute}${dayPeriod ? ` ${dayPeriod}` : ""} PT`;
}

function addCredit(image: PhotonImage, frame: Frame, botHandle: string): PhotonImage {
 const width = image.get_width();
 const height = image.get_height();
 const sourcePixels = image.get_raw_pixels();
 const pixels = new Uint8Array(sourcePixels);
 const stripTop = Math.max(0, height - PANOCAM_CREDIT_STRIP_HEIGHT);
 for (let y = stripTop; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
   const offset = (y * width + x) * 4;
   pixels[offset] = 8;
   pixels[offset + 1] = 15;
   pixels[offset + 2] = 24;
   pixels[offset + 3] = 225;
  }
 }
 const credited = new PhotonImage(pixels, width, height);
 const firstLine = `Space Needle PanoCam | ${PANOCAM_CAMERA_URL}`;
 const secondLine = `${creditTimestamp(frame)} | ${botHandle}`;
 draw_text_with_color(credited, firstLine, 18, Math.max(0, height - 53), 16, new Rgba(255, 255, 255, 255));
 draw_text_with_color(credited, secondLine, 18, Math.max(0, height - 29), 16, new Rgba(255, 255, 255, 255));
 return credited;
}

/**
 * Fetch and render a camera frame. Stitched output is a 1440x1080 crop whose
 * center is global panorama x≈4970; raw output is the camera's slice 9.
 */
export async function buildImage(
 frame: Frame,
 mode: ImageMode,
 botHandle: string,
 options: BuildImageOptions = {},
): Promise<ImageArtifact> {
 const fetchImpl = options.fetcher ?? options.fetch ?? fetch;
 const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new RangeError("Image request timeout must be a positive number");
 }
 if (mode !== "stitched" && mode !== "raw-slice" && mode !== "raw-slice-unwatermarked") {
  throw new Error(`Unsupported image mode: ${mode}`);
 }

 if (mode === "stitched") {
  const slices: DecodedSlice[] = [];
  let joined: PhotonImage | undefined;
  let cropped: PhotonImage | undefined;
  let output: PhotonImage | undefined;
  try {
   for (const index of PANOCAM_STITCH_SLICES) {
    slices.push(normalizeSlice(await fetchSlice(fetchImpl, frame, index, timeoutMs)));
   }
   joined = composeStitched(slices);
   const cropLeft = PANOCAM_CENTER_X - PANOCAM_STITCH_SLICES[0] * PANOCAM_SLICE_WIDTH - PANOCAM_OUTPUT_WIDTH / 2;
   cropped = crop(joined, cropLeft, 0, cropLeft + PANOCAM_OUTPUT_WIDTH, PANOCAM_OUTPUT_HEIGHT);
   output = addCredit(cropped, frame, botHandle);
   const bytes = output.get_bytes_jpeg(PANOCAM_JPEG_QUALITY);
   return {
    bytes: new Uint8Array(bytes),
    contentType: "image/jpeg",
    width: PANOCAM_OUTPUT_WIDTH,
    height: PANOCAM_OUTPUT_HEIGHT,
   };
  } finally {
   output?.free();
   cropped?.free();
   joined?.free();
   for (const slice of slices) slice.image.free();
  }
 }

 const source = await fetchSlice(fetchImpl, frame, PANOCAM_RAW_SLICE_INDEX, timeoutMs);
 const normalized = normalizeSlice(source);
 let output: PhotonImage | undefined;
 try {
  output = mode === "raw-slice-unwatermarked"
   ? normalized.image
   : addCredit(normalized.image, frame, botHandle);
  const bytes = output.get_bytes_jpeg(PANOCAM_JPEG_QUALITY);
  return {
   bytes: new Uint8Array(bytes),
   contentType: "image/jpeg",
   width: output.get_width(),
   height: output.get_height(),
  };
 } finally {
  output?.free();
  if (output !== normalized.image) normalized.image.free();
 }
}

