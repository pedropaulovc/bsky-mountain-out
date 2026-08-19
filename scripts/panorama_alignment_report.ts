import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
 crop,
 draw_text_with_color,
 PhotonImage,
 Rgba,
 resize,
 SamplingFilter,
} from "@cf-wasm/photon/node";
import {
 PANOCAM_CAMERA_URL,
 PANOCAM_OUTPUT_HEIGHT,
 PANOCAM_OUTPUT_WIDTH,
 PANOCAM_RAINIER_CROP_HEIGHT,
 PANOCAM_RAINIER_CROP_LEFT,
 PANOCAM_RAINIER_CROP_TOP,
 PANOCAM_RAINIER_CROP_WIDTH,
 PANOCAM_SLICE_HEIGHT,
 PANOCAM_SLICE_INDICES,
 PANOCAM_SLICE_WIDTH,
 frameFromId,
 sliceAssetUrl,
 thumbnailAssetUrl,
} from "../src/frames";
import {
 PANOCAM_ALIGNMENT_FEATURE_HEIGHT,
 PANOCAM_ALIGNMENT_FEATURE_WIDTH,
 assembleRgbaSlices,
 buildPanoramaSignature,
 circularShiftRgba,
 findPanoramaAlignment,
} from "../src/panorama-alignment";
import type { PanoramaAlignment, PanoramaSignature, RgbaImageBuffer } from "../src/panorama-alignment";
import type { Frame } from "../src/types";

const DEFAULT_SAMPLE = "reports/panorama-alignment-2026-08-18/sample-input.json";
const DEFAULT_CACHE = "reports/panorama-clusters-2026-08-18-final";
const DEFAULT_OUTPUT = "reports/panorama-alignment-2026-08-18";
const DEFAULT_REFERENCE = "assets/panocam-alignment-reference.jpg";
const MAX_CONCURRENT_THUMBNAILS = 4;
const REQUEST_TIMEOUT_MS = 30_000;
const JPEG_QUALITY = 90;
const CREDIT_STRIP_HEIGHT = 24;
interface Sample {
 frameId: string;
 capturedAt: string;
}

interface AlignmentRow {
 frameId: string;
 capturedAt: string;
 sourceWidth: number;
 alignment: PanoramaAlignment | undefined;
 status: "accepted" | "rejected" | "error";
 cropPath: string;
 error?: string;
}

function argumentValue(args: readonly string[], name: string, fallback: string): string {
 const index = args.indexOf(name);
 return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
 const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
 if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
 const bytes = new Uint8Array(await response.arrayBuffer());
 if (bytes.byteLength === 0) throw new Error(`${url} returned an empty body`);
 return bytes;
}

async function readOptional(path: string): Promise<Uint8Array | undefined> {
 try {
  return new Uint8Array(await readFile(path));
 } catch {
  return undefined;
 }
}

function normalizePanoramaSlice(source: PhotonImage): PhotonImage {
 const width = source.get_width();
 const height = source.get_height();
 if (height === PANOCAM_SLICE_HEIGHT && width <= PANOCAM_SLICE_WIDTH) return source;
 const normalized = resize(
  source,
  Math.min(width, PANOCAM_SLICE_WIDTH),
  PANOCAM_SLICE_HEIGHT,
  SamplingFilter.Triangle,
 );
 source.free();
 return normalized;
}

async function ensurePanoramaCache(
 frame: Frame,
 cacheRoot: string,
): Promise<{ panoramaPath: string; slice16Path: string }> {
 const rawDir = join(cacheRoot, "raw", frame.id);
 const panoramaDir = join(cacheRoot, "panoramas");
 const panoramaPath = join(panoramaDir, `${frame.id}.jpg`);
 const slicePaths = PANOCAM_SLICE_INDICES.map((index) => join(rawDir, `slice${index}.jpg`));
 await mkdir(rawDir, { recursive: true });
 await mkdir(panoramaDir, { recursive: true });
 const encodedSlices = await Promise.all(slicePaths.map(async (path, index) => {
  const cached = await readOptional(path);
  if (cached) return cached;
  const downloaded = await fetchBytes(sliceAssetUrl(frame, index));
  await writeFile(path, downloaded);
  return downloaded;
 }));

 if (!(await readOptional(panoramaPath))) {
  const buffers: RgbaImageBuffer[] = [];
  for (const encoded of encodedSlices) {
   const source = normalizePanoramaSlice(PhotonImage.new_from_byteslice(encoded));
   buffers.push({
    pixels: new Uint8Array(source.get_raw_pixels()),
    width: source.get_width(),
    height: source.get_height(),
   });
   source.free();
  }
  const assembled = assembleRgbaSlices(buffers);
  const panorama = new PhotonImage(assembled.pixels, assembled.width, assembled.height);
  await writeFile(panoramaPath, panorama.get_bytes_jpeg(78));
  panorama.free();
 }
 return { panoramaPath, slice16Path: slicePaths[slicePaths.length - 1] };
}

async function readReferenceBytes(reference: string): Promise<Uint8Array> {
 if (/^https?:\/\//.test(reference)) return fetchBytes(reference);
 return new Uint8Array(await readFile(resolve(reference)));
}

function signatureFor(source: PhotonImage): PanoramaSignature {
 const feature = resize(
  source,
  PANOCAM_ALIGNMENT_FEATURE_WIDTH,
  PANOCAM_ALIGNMENT_FEATURE_HEIGHT,
  SamplingFilter.Triangle,
 );
 try {
  return buildPanoramaSignature({
   pixels: feature.get_raw_pixels(),
   width: feature.get_width(),
   height: feature.get_height(),
  });
 } finally {
  feature.free();
 }
}

function creditTimestamp(capturedAt: Date): string {
 const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
 }).formatToParts(capturedAt);
 const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
 const dayPeriod = (values.dayPeriod ?? "").toLowerCase();
 return `${values.month} ${values.day} ${values.year} ${values.hour}:${values.minute}${dayPeriod ? ` ${dayPeriod}` : ""} PT`;
}

function addCredit(image: PhotonImage, frame: Frame): PhotonImage {
 const width = image.get_width();
 const height = image.get_height();
 const pixels = new Uint8Array(image.get_raw_pixels());
 const stripTop = Math.max(0, height - CREDIT_STRIP_HEIGHT);
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
 const watermark = `Image (c) Space Needle LLC | Extracted from Space Needle PanoCam | ${PANOCAM_CAMERA_URL} | ${creditTimestamp(frame.capturedAt)}`;
 draw_text_with_color(credited, watermark, width < 800 ? 4 : 18, Math.max(20, height - 20), width < 800 ? 8 : 16, new Rgba(255, 255, 255, 255));
 return credited;
}

async function imageWidth(path: string): Promise<number> {
 const image = PhotonImage.new_from_byteslice(new Uint8Array(await readFile(path)));
 try {
  return image.get_width();
 } finally {
  image.free();
 }
}

async function processFrame(
 sample: Sample,
 referenceSignature: PanoramaSignature,
 cacheRoot: string,
 outputRoot: string,
): Promise<AlignmentRow> {
 const frame = frameFromId(sample.frameId);
 const thumbnail = PhotonImage.new_from_byteslice(await fetchBytes(thumbnailAssetUrl(frame)));
 let alignment: PanoramaAlignment | undefined;
 try {
  alignment = findPanoramaAlignment(referenceSignature, signatureFor(thumbnail));
 } finally {
  thumbnail.free();
 }

 const { panoramaPath, slice16Path } = await ensurePanoramaCache(frame, cacheRoot);
 const sourceWidth = (PANOCAM_SLICE_INDICES.length - 1) * PANOCAM_SLICE_WIDTH + await imageWidth(slice16Path);
 const cropPath = `adjusted-crops/${sample.frameId}.jpg`;
 if (!alignment.accepted) {
  return {
   frameId: sample.frameId,
   capturedAt: sample.capturedAt,
   sourceWidth,
   alignment,
   status: "rejected",
   cropPath: "",
  };
 }

 const panorama = PhotonImage.new_from_byteslice(new Uint8Array(await readFile(panoramaPath)));
 let exact: PhotonImage | undefined;
 let aligned: PhotonImage | undefined;
 let cropped: PhotonImage | undefined;
 let framed: PhotonImage | undefined;
 let credited: PhotonImage | undefined;
 try {
  exact = panorama.get_width() === sourceWidth
   ? panorama
   : crop(panorama, 0, 0, sourceWidth, panorama.get_height());
  const appliedShiftPx = Math.round(alignment.shiftFeaturePx * sourceWidth / PANOCAM_ALIGNMENT_FEATURE_WIDTH);
  const shiftedPixels = circularShiftRgba({
   pixels: exact.get_raw_pixels(),
   width: sourceWidth,
   height: exact.get_height(),
  }, appliedShiftPx);
  aligned = new PhotonImage(shiftedPixels, sourceWidth, exact.get_height());
  const cropLeft = Math.max(
   0,
   Math.min(sourceWidth - PANOCAM_RAINIER_CROP_WIDTH, PANOCAM_RAINIER_CROP_LEFT),
  );
  const cropTop = Math.max(
   0,
   Math.min(aligned.get_height() - PANOCAM_RAINIER_CROP_HEIGHT, PANOCAM_RAINIER_CROP_TOP),
  );
  cropped = crop(
   aligned,
   cropLeft,
   cropTop,
   cropLeft + PANOCAM_RAINIER_CROP_WIDTH,
   cropTop + PANOCAM_RAINIER_CROP_HEIGHT,
  );
  framed = resize(cropped, PANOCAM_OUTPUT_WIDTH, PANOCAM_OUTPUT_HEIGHT, SamplingFilter.Triangle);
  credited = addCredit(framed, frame);
  await writeFile(join(outputRoot, cropPath), credited.get_bytes_jpeg(JPEG_QUALITY));
  alignment.appliedShiftPx = appliedShiftPx;
  return {
   frameId: sample.frameId,
   capturedAt: sample.capturedAt,
   sourceWidth,
   alignment,
   status: "accepted",
   cropPath,
  };
 } finally {
  credited?.free();
  framed?.free();
  cropped?.free();
  aligned?.free();
  if (exact && exact !== panorama) exact.free();
  panorama.free();
 }
}

function csvEscape(value: string | number): string {
 const text = String(value);
 return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}


function writeCsv(rows: readonly AlignmentRow[]): string {
 const headers = [
  "frame_id",
  "captured_at",
  "source_width",
  "status",
  "shift_feature_px",
  "applied_shift_px",
  "score",
  "margin",
  "band_disagreement_px",
  "inlier_tile_count",
  "confidence",
  "crop_path",
  "error",
 ] as const;
 const lines = [headers.join(",")];
 for (const row of rows) {
  const values: Array<string | number> = [
   row.frameId,
   row.capturedAt,
   row.sourceWidth,
   row.status,
   row.alignment?.shiftFeaturePx ?? "",
   row.alignment?.appliedShiftPx ?? "",
   row.alignment?.score ?? "",
   row.alignment?.margin ?? "",
   row.alignment?.bandDisagreementPx ?? "",
   row.alignment?.inlierTileCount ?? "",
   row.alignment?.confidence ?? "",
   row.cropPath,
   row.error ?? "",
  ];
  lines.push(values.map(csvEscape).join(","));
 }
 return `${lines.join("\n")}\n`;
}

function writeReport(
 outputRoot: string,
 samplePath: string,
 reference: string,
 rows: readonly AlignmentRow[],
): string {
 const accepted = rows.filter((row) => row.status === "accepted");
 const rejected = rows.filter((row) => row.status === "rejected");
 const errors = rows.filter((row) => row.status === "error");
 const shifts = accepted.map((row) => row.alignment?.appliedShiftPx ?? 0);
 const minShift = shifts.length ? Math.min(...shifts) : 0;
 const maxShift = shifts.length ? Math.max(...shifts) : 0;
 const medianShift = shifts.length
  ? [...shifts].sort((left, right) => left - right)[Math.floor(shifts.length / 2)]
  : 0;
 const table = rows.map((row) => {
  const alignment = row.alignment;
  return `| \`${row.frameId}\` | ${row.status} | ${alignment?.appliedShiftPx ?? ""} | ${alignment ? alignment.score.toFixed(3) : ""} | ${alignment ? alignment.confidence.toFixed(3) : ""} | ${alignment?.inlierTileCount ?? ""} | ${row.cropPath ? `[crop](${row.cropPath})` : ""} |`;
 }).join("\n");
 const report = [
  "# Panocam panorama alignment report",
  "",
  `Generated: \`${new Date().toISOString()}\``,
  `Sample manifest: \`${samplePath}\``,
  `Reference: \`${reference}\``,
  "Reference source frame: `2025_0325_130000` (clear, Rainier visible).",
  "",
  "## Summary",
  "",
  `- Sampled timestamps: **${rows.length}** (evenly spaced among available daily candidates from 2023-08-18 through 2026-08-18).`,
  `- Accepted alignments: **${accepted.length}**`,
  `- Rejected alignments: **${rejected.length}**`,
  `- Processing errors: **${errors.length}**`,
  `- Applied source shift range: **${minShift}..${maxShift} px**; median **${medianShift} px**.`,
  "- Source panoramas preserve the decoded terminal slice width; the report crops the old 8704px cache to the true source width before applying the shift.",
  "",
  "## Method",
  "",
  "1. Fetch each frame's full-width `thumbnail.jpg`.",
  "2. Resize to a 512×96 structural representation and compare three vertical edge bands over all circular horizontal shifts.",
  "3. Require a score/margin gate, agreement between vertical bands, and at least four of eight inlier horizontal tiles.",
  "4. Apply the measured shift to the true-width cached panorama, crop the canonical 512×384 Rainier window, resize it to 1440×1080, and add the production attribution strip.",
  "",
  "## Final adjusted crops",
  "",
  "The overview is generated after alignment. Individual final crops are in [`adjusted-crops/`](adjusted-crops/).",
  "",
  "![Final adjusted crops](final-crops-overview.jpg)",
  "",
  "## Per-frame results",
  "",
  "| Frame | Status | Applied shift (px) | Score | Confidence | Inlier tiles | Crop |",
  "|---|---:|---:|---:|---:|---:|---|",
  table,
  "",
 ].join("\n");
 return report;
}

async function main(): Promise<void> {
 const args = process.argv.slice(2);
 const samplePath = resolve(argumentValue(args, "--sample", DEFAULT_SAMPLE));
 const cacheRoot = resolve(argumentValue(args, "--cache", DEFAULT_CACHE));
 const outputRoot = resolve(argumentValue(args, "--output", DEFAULT_OUTPUT));
 const reference = argumentValue(args, "--reference", DEFAULT_REFERENCE);
 const samples = JSON.parse(await readFile(samplePath, "utf8")) as Sample[];
 if (samples.length !== 100) throw new Error(`Expected 100 samples, found ${samples.length}`);
 await mkdir(join(outputRoot, "adjusted-crops"), { recursive: true });

 const referenceImage = PhotonImage.new_from_byteslice(await readReferenceBytes(reference));
 let referenceSignature: PanoramaSignature;
 const displaySamplePath = relative(process.cwd(), samplePath) || samplePath;
 try {
  referenceSignature = signatureFor(referenceImage);
 } finally {
  referenceImage.free();
 }

 const rows: AlignmentRow[] = [];
 for (let start = 0; start < samples.length; start += MAX_CONCURRENT_THUMBNAILS) {
  const batch = samples.slice(start, start + MAX_CONCURRENT_THUMBNAILS);
  const results = await Promise.all(batch.map(async (sample) => {
   try {
    return await processFrame(sample, referenceSignature, cacheRoot, outputRoot);
   } catch (error) {
    return {
     frameId: sample.frameId,
     capturedAt: sample.capturedAt,
     sourceWidth: 0,
     alignment: undefined,
     status: "error" as const,
     cropPath: "",
     error: error instanceof Error ? error.message : String(error),
    };
   }
  }));
  rows.push(...results);
  console.log(`Processed ${rows.length}/${samples.length}`);
 }
 await writeFile(join(outputRoot, "alignment.csv"), writeCsv(rows), "utf8");
 await writeFile(join(outputRoot, "sample.json"), JSON.stringify(samples, null, 2) + "\n", "utf8");
 await writeFile(join(outputRoot, "REPORT.md"), writeReport(outputRoot, displaySamplePath, reference, rows), "utf8");
 console.log(`Report written to ${outputRoot}`);
}

main().catch((error) => {
 console.error(error);
 process.exitCode = 1;
});
