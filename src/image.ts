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
 PANOCAM_ALIGNMENT_REFERENCE_URL,
 PANOCAM_CAMERA_URL,
 PANOCAM_OUTPUT_HEIGHT,
 PANOCAM_OUTPUT_WIDTH,
 PANOCAM_RAINIER_POSTCARD_HEIGHT,
 PANOCAM_RAINIER_POSTCARD_TOP,
 PANOCAM_RAINIER_POSTCARD_WIDTH,
 PANOCAM_RAINIER_VIEW_POSITION,
 PANOCAM_RAW_SLICE_INDEX,
 PANOCAM_SLICE_HEIGHT,
 PANOCAM_SLICE_WIDTH,
 PANOCAM_SLICE_INDICES,
 sliceAssetUrl,
 thumbnailAssetUrl,
} from "./frames";
import {
 PANOCAM_ALIGNMENT_FEATURE_HEIGHT,
 PANOCAM_ALIGNMENT_FEATURE_WIDTH,
 buildPanoramaSignature,
 circularShiftRgba,
 copyRgbaSliceIntoPanorama,
 findPanoramaAlignment,
 type PanoramaAlignment,
 type PanoramaSignature,
} from "./panorama-alignment";
import { PanoramaAlignmentRejectedError } from "./problems";

/** Output and source geometry are deliberately fixed for predictable bot posts. */
export const PANOCAM_JPEG_QUALITY = 90;
export const PANOCAM_CREDIT_STRIP_HEIGHT = 24;
export const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 10_000;
export const POSTCARD_CROP_TOP = PANOCAM_RAINIER_POSTCARD_TOP;
export const POSTCARD_CROP_HEIGHT = PANOCAM_RAINIER_POSTCARD_HEIGHT;

export interface BuildImageOptions {
 /** Injectable image fetch implementation for tests and development routes. */
 fetch?: typeof fetch;
 /** Alias accepted by callers that prefer to name the network boundary. */
 fetcher?: typeof fetch;
 /** Maximum milliseconds spent downloading one slice. */
 timeoutMs?: number;
 /** Optional thumbnail used as the canonical panorama alignment reference. */
 alignmentReferenceUrl?: string | null;
 /** Maximum reference tiles in a classifier contact sheet. */
 maxReferences?: number;
}

interface DecodedSlice {
 image: PhotonImage;
 width: number;
 height: number;
}

function responseSucceeded(response: Response): boolean {
 return response.ok || (response.status >= 200 && response.status < 400);
}

async function fetchAssetBytes(
 fetchImpl: typeof fetch,
 url: string,
 timeoutMs: number,
 label: string,
): Promise<Uint8Array> {
 const response = await fetchImpl(url, {
  method: "GET",
  signal: AbortSignal.timeout(timeoutMs),
 });
 if (!responseSucceeded(response)) {
  throw new Error(`PanoCam ${label} returned HTTP ${response.status}`);
 }
 const bytes = new Uint8Array(await response.arrayBuffer());
 if (bytes.byteLength === 0) throw new Error(`PanoCam ${label} was empty`);
 return bytes;
}

async function fetchSliceBytes(
 fetchImpl: typeof fetch,
 frame: Frame,
 index: number,
 timeoutMs: number,
): Promise<Uint8Array> {
 return fetchAssetBytes(fetchImpl, sliceAssetUrl(frame, index), timeoutMs, `slice ${index}`);
}

async function fetchSlice(
 fetchImpl: typeof fetch,
 frame: Frame,
 index: number,
 timeoutMs: number,
): Promise<PhotonImage> {
 return PhotonImage.new_from_byteslice(await fetchSliceBytes(fetchImpl, frame, index, timeoutMs));
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

function normalizePanoramaSlice(source: PhotonImage): DecodedSlice {
 const width = source.get_width();
 const height = source.get_height();
 if (height === PANOCAM_SLICE_HEIGHT && width <= PANOCAM_SLICE_WIDTH) {
  return { image: source, width, height };
 }
 const normalized = resize(
  source,
  Math.min(width, PANOCAM_SLICE_WIDTH),
  PANOCAM_SLICE_HEIGHT,
  SamplingFilter.Triangle,
 );
 source.free();
 return {
  image: normalized,
  width: normalized.get_width(),
  height: normalized.get_height(),
 };
}


async function composeStitched(
 fetchImpl: typeof fetch,
 frame: Frame,
 timeoutMs: number,
): Promise<PhotonImage> {
 const encodedSlices = await Promise.all(
  PANOCAM_SLICE_INDICES.map((index) => fetchSliceBytes(fetchImpl, frame, index, timeoutMs)),
 );
 const widths: number[] = [];
 let panoramaWidth = 0;
 for (const bytes of encodedSlices) {
  const source = normalizePanoramaSlice(PhotonImage.new_from_byteslice(bytes));
  widths.push(source.width);
  panoramaWidth += source.width;
  source.image.free();
 }

 const pixels = new Uint8Array(panoramaWidth * PANOCAM_SLICE_HEIGHT * 4);
 let targetX = 0;
 for (const [index, bytes] of encodedSlices.entries()) {
  const source = normalizePanoramaSlice(PhotonImage.new_from_byteslice(bytes));
  if (source.width !== widths[index]) {
   source.image.free();
   throw new Error(`PanoCam slice ${index} changed dimensions between decode passes`);
  }
  copyRgbaSliceIntoPanorama(
   pixels,
   panoramaWidth,
   {
    pixels: source.image.get_raw_pixels(),
    width: source.width,
    height: source.height,
   },
   targetX,
  );
  targetX += source.width;
  source.image.free();
 }
 return new PhotonImage(pixels, panoramaWidth, PANOCAM_SLICE_HEIGHT);
}
async function fetchAlignmentImage(
 fetchImpl: typeof fetch,
 url: string,
 timeoutMs: number,
 label: string,
): Promise<PhotonImage> {
 return PhotonImage.new_from_byteslice(await fetchAssetBytes(fetchImpl, url, timeoutMs, label));
}

function signatureForAlignment(source: PhotonImage): PanoramaSignature {
 const featureImage = resize(
  source,
  PANOCAM_ALIGNMENT_FEATURE_WIDTH,
  PANOCAM_ALIGNMENT_FEATURE_HEIGHT,
  SamplingFilter.Triangle,
 );
 try {
  return buildPanoramaSignature({
   pixels: featureImage.get_raw_pixels(),
   width: featureImage.get_width(),
   height: featureImage.get_height(),
  });
 } finally {
  featureImage.free();
 }
}

async function alignStitchedPanorama(
 source: PhotonImage,
 fetchImpl: typeof fetch,
 frame: Frame,
 referenceUrl: string,
 timeoutMs: number,
): Promise<{ image: PhotonImage; alignment: PanoramaAlignment }> {
 const settled = await Promise.allSettled([
  fetchAlignmentImage(fetchImpl, referenceUrl, timeoutMs, "alignment reference"),
  fetchAlignmentImage(fetchImpl, thumbnailAssetUrl(frame), timeoutMs, "alignment thumbnail"),
 ]);
 const reference = settled[0].status === "fulfilled" ? settled[0].value : undefined;
 const current = settled[1].status === "fulfilled" ? settled[1].value : undefined;
 if (!reference || !current) {
  reference?.free();
  current?.free();
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  throw failure?.reason instanceof Error ? failure.reason : new Error("PanoCam alignment asset fetch failed");
 }
 try {
  const alignment = findPanoramaAlignment(
   signatureForAlignment(reference),
   signatureForAlignment(current),
  );
  if (!alignment.accepted) {
   throw new PanoramaAlignmentRejectedError(alignment);
  }
  const appliedShiftPx = Math.round(
   alignment.shiftFeaturePx * source.get_width() / PANOCAM_ALIGNMENT_FEATURE_WIDTH,
  );
  const shiftedPixels = circularShiftRgba(
   {
    pixels: source.get_raw_pixels(),
    width: source.get_width(),
    height: source.get_height(),
   },
   appliedShiftPx,
  );
  return {
   image: new PhotonImage(shiftedPixels, source.get_width(), source.get_height()),
   alignment: { ...alignment, appliedShiftPx },
  };
 } finally {
  reference.free();
  current.free();
 }
}
function buildReferencePanel(source: PhotonImage): PhotonImage {
 const width = source.get_width();
 const height = source.get_height();
 const cropHeight = Math.min(height, Math.max(1, Math.round(width * 0.75)));
 const top = Math.max(0, Math.min(height - cropHeight, Math.round(height * 0.33 - cropHeight / 2)));
 const cropped = crop(source, 0, top, width, top + cropHeight);
 const panel = resize(cropped, REFERENCE_PANEL_WIDTH, REFERENCE_PANEL_HEIGHT, SamplingFilter.Triangle);
 cropped.free();
 return panel;
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

function addCredit(image: PhotonImage, frame: Frame): PhotonImage {
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
 const watermark = `Image (c) Space Needle LLC | Extracted from Space Needle PanoCam | ${PANOCAM_CAMERA_URL} | ${creditTimestamp(frame)}`;
 const fontSize = width < 800 ? 8 : 16;
 const x = width < 800 ? 4 : 18;
 const y = Math.max(fontSize + 4, height - 20);
 draw_text_with_color(credited, watermark, x, y, fontSize, new Rgba(255, 255, 255, 255));
 return credited;
}

/**
 * Fetch and render a camera frame. Stitched output follows the
 * Rainier-facing production view and is a 1440x1080 crop.
 * Raw output remains the camera's diagnostic slice 9.
 */
export async function buildImage(
 frame: Frame,
 mode: ImageMode,
 options: BuildImageOptions = {},
): Promise<ImageArtifact> {
 const fetchImpl = options.fetcher ?? options.fetch ?? fetch;
 const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new RangeError("Image request timeout must be a positive number");
 }
 if (mode !== "stitched" && mode !== "postcard" && mode !== "raw-slice" && mode !== "raw-slice-unwatermarked") {
  throw new Error(`Unsupported image mode: ${mode}`);
 }
 if (mode === "stitched") {
  let joined: PhotonImage | undefined;
  let cropped: PhotonImage | undefined;
  let output: PhotonImage | undefined;
  let alignment: PanoramaAlignment | undefined;
  try {
   joined = await composeStitched(fetchImpl, frame, timeoutMs);
   const referenceUrl = options.alignmentReferenceUrl === undefined
    ? PANOCAM_ALIGNMENT_REFERENCE_URL
    : options.alignmentReferenceUrl;
   if (referenceUrl) {
    const realigned = await alignStitchedPanorama(joined, fetchImpl, frame, referenceUrl, timeoutMs);
    joined.free();
    joined = realigned.image;
    alignment = realigned.alignment;
   }
   const cropLeft = Math.max(
    0,
    Math.min(
     joined.get_width() - PANOCAM_OUTPUT_WIDTH,
     PANOCAM_RAINIER_VIEW_POSITION - PANOCAM_OUTPUT_WIDTH / 2,
    ),
   );
   cropped = crop(joined, cropLeft, 0, cropLeft + PANOCAM_OUTPUT_WIDTH, PANOCAM_OUTPUT_HEIGHT);
   output = addCredit(cropped, frame);
   const bytes = output.get_bytes_jpeg(PANOCAM_JPEG_QUALITY);
   return {
    bytes: new Uint8Array(bytes),
    contentType: "image/jpeg",
    width: PANOCAM_OUTPUT_WIDTH,
    height: PANOCAM_OUTPUT_HEIGHT,
    alignment,
   };
  } finally {
   output?.free();
   cropped?.free();
   joined?.free();
  }
 }

 const source = await fetchSlice(fetchImpl, frame, PANOCAM_RAW_SLICE_INDEX, timeoutMs);
 const normalized = normalizeSlice(source);
 if (mode === "postcard") {
  let cropped: PhotonImage | undefined;
  let output: PhotonImage | undefined;
  try {
   cropped = crop(
    normalized.image,
    0,
    POSTCARD_CROP_TOP,
    PANOCAM_RAINIER_POSTCARD_WIDTH,
    POSTCARD_CROP_TOP + POSTCARD_CROP_HEIGHT,
   );
   output = addCredit(cropped, frame);
   const bytes = output.get_bytes_jpeg(PANOCAM_JPEG_QUALITY);
   return {
    bytes: new Uint8Array(bytes),
    contentType: "image/jpeg",
    width: PANOCAM_RAINIER_POSTCARD_WIDTH,
    height: POSTCARD_CROP_HEIGHT,
   };
  } finally {
   output?.free();
   cropped?.free();
   normalized.image.free();
  }
 }

 let output: PhotonImage | undefined;
 try {
  output = mode === "raw-slice-unwatermarked"
   ? normalized.image
   : addCredit(normalized.image, frame);
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
export const REFERENCE_PANEL_WIDTH = 512;
export const REFERENCE_PANEL_HEIGHT = 384;
export const REFERENCE_SHEET_JPEG_QUALITY = 85;
export const DEFAULT_MAX_REFERENCE_IMAGES = 6;

/**
 * Fetch full-resolution reference captures for a multi-image OpenAI request.
 * Failed optional references are skipped; the target still remains classifiable.
 */
export async function loadReferenceImages(
 referenceUrls: readonly string[],
 options: BuildImageOptions = {},
): Promise<ImageArtifact[]> {
 const urls = [...new Set(referenceUrls.map((url) => url.trim()).filter(Boolean))].slice(
  0,
  options.maxReferences ?? DEFAULT_MAX_REFERENCE_IMAGES,
 );
 if (urls.length === 0) return [];
 const fetchImpl = options.fetcher ?? options.fetch ?? fetch;
 const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new RangeError("Reference image timeout must be a positive number");
 }
 const images: ImageArtifact[] = [];
 for (const url of urls) {
  try {
   const response = await fetchImpl(url, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
   });
   if (!responseSucceeded(response)) continue;
   const bytes = new Uint8Array(await response.arrayBuffer());
   if (bytes.byteLength === 0) continue;
   images.push({ bytes, contentType: "image/jpeg", width: PANOCAM_OUTPUT_WIDTH, height: PANOCAM_OUTPUT_HEIGHT });
  } catch {
   continue;
  }
 }
 return images;
}

/**
 * Compose the target and reference captures into one labeled image because
 * the OpenAI vision request uses one input image for this classifier. The
 * returned sheet is classifier-only; the original target remains the post image.
 */
export async function buildReferenceSheet(
 target: ImageArtifact,
 referenceUrls: readonly string[],
 options: BuildImageOptions = {},
): Promise<ImageArtifact | undefined> {
 const urls = [...new Set(referenceUrls.map((url) => url.trim()).filter(Boolean))].slice(
  0,
  options.maxReferences ?? DEFAULT_MAX_REFERENCE_IMAGES,
 );
 if (urls.length === 0) return undefined;

 const fetchImpl = options.fetcher ?? options.fetch ?? fetch;
 const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new RangeError("Reference image timeout must be a positive number");
 }

 const panels: PhotonImage[] = [];
 const labels: string[] = [];
 let sheet: PhotonImage | undefined;
 try {
  let targetSource: PhotonImage | undefined;
  try {
   targetSource = PhotonImage.new_from_byteslice(target.bytes);
   panels.push(resize(targetSource, REFERENCE_PANEL_WIDTH, REFERENCE_PANEL_HEIGHT, SamplingFilter.Triangle));
  } finally {
   targetSource?.free();
  }
  labels.push("TARGET");

  for (const [index, url] of urls.entries()) {
   let source: PhotonImage | undefined;
   try {
    const response = await fetchImpl(url, {
     method: "GET",
     signal: AbortSignal.timeout(timeoutMs),
    });
    if (!responseSucceeded(response)) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) continue;
    source = PhotonImage.new_from_byteslice(bytes);
    panels.push(buildReferencePanel(source));
    labels.push(`REFERENCE ${index + 1}`);
   } catch {
    continue;
   } finally {
    source?.free();
   }
  }

  if (panels.length === 1) return undefined;

  const columns = 2;
  const rows = Math.ceil(panels.length / columns);
  const sheetWidth = columns * REFERENCE_PANEL_WIDTH;
  const sheetHeight = rows * REFERENCE_PANEL_HEIGHT;
  const pixels = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (const [index, panel] of panels.entries()) {
   const panelPixels = panel.get_raw_pixels();
   const column = index % columns;
   const row = Math.floor(index / columns);
   const left = column * REFERENCE_PANEL_WIDTH;
   const top = row * REFERENCE_PANEL_HEIGHT;
   for (let y = 0; y < REFERENCE_PANEL_HEIGHT; y += 1) {
    const sourceStart = y * REFERENCE_PANEL_WIDTH * 4;
    const targetStart = ((top + y) * sheetWidth + left) * 4;
    pixels.set(
     panelPixels.subarray(sourceStart, sourceStart + REFERENCE_PANEL_WIDTH * 4),
     targetStart,
    );
   }
   for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < REFERENCE_PANEL_WIDTH; x += 1) {
     const offset = ((top + y) * sheetWidth + left + x) * 4;
     pixels[offset] = 8;
     pixels[offset + 1] = 15;
     pixels[offset + 2] = 24;
     pixels[offset + 3] = 255;
    }
   }
  }

  sheet = new PhotonImage(pixels, sheetWidth, sheetHeight);
  for (const [index, label] of labels.entries()) {
   const column = index % columns;
   const row = Math.floor(index / columns);
   draw_text_with_color(
    sheet,
    label,
    column * REFERENCE_PANEL_WIDTH + 16,
    row * REFERENCE_PANEL_HEIGHT + 23,
    18,
    new Rgba(255, 255, 255, 255),
   );
  }
  const bytes = sheet.get_bytes_jpeg(REFERENCE_SHEET_JPEG_QUALITY);
  return {
   bytes: new Uint8Array(bytes),
   contentType: "image/jpeg",
   width: sheetWidth,
   height: sheetHeight,
  };
 } finally {
  sheet?.free();
  for (const panel of panels) panel.free();
 }
}

