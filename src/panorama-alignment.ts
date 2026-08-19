export const PANOCAM_ALIGNMENT_FEATURE_WIDTH = 512;
export const PANOCAM_ALIGNMENT_FEATURE_HEIGHT = 96;
export const PANOCAM_ALIGNMENT_TILE_COUNT = 8;
export const PANOCAM_ALIGNMENT_MIN_INLIER_TILES = 4;
export const PANOCAM_ALIGNMENT_MIN_TILE_SCORE = 0.05;
export const PANOCAM_ALIGNMENT_MIN_SCORE = 0.2;
export const PANOCAM_ALIGNMENT_MIN_MARGIN = 0.01;
export const PANOCAM_ALIGNMENT_MAX_BAND_DISAGREEMENT = 8;
const ALIGNMENT_BANDS = [
 { start: 0.22, end: 0.55 },
 { start: 0.42, end: 0.78 },
 { start: 0.65, end: 0.96 },
] as const;

export interface RgbaImageBuffer {
 pixels: Uint8Array;
 width: number;
 height: number;
}

export interface PanoramaSignature {
 width: number;
 bands: readonly Float32Array[];
}

export interface PanoramaAlignment {
 accepted: boolean;
 shiftFeaturePx: number;
 appliedShiftPx?: number;
 score: number;
 margin: number;
 bandDisagreementPx: number;
 inlierTileCount: number;
 confidence: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
 return Math.max(minimum, Math.min(maximum, value));
}

function wrappedIndex(value: number, width: number): number {
 const remainder = value % width;
 return remainder < 0 ? remainder + width : remainder;
}


function circularDistance(first: number, second: number, width: number): number {
 const difference = Math.abs(first - second);
 return Math.min(difference, width - difference);
}

function normalizeProfile(profile: Float32Array): void {
 let sum = 0;
 for (const value of profile) sum += value;
 const mean = sum / profile.length;
 let variance = 0;
 for (const value of profile) {
  const difference = value - mean;
  variance += difference * difference;
 }
 const standardDeviation = Math.sqrt(variance / profile.length);
 if (standardDeviation < 1e-6) {
  profile.fill(0);
  return;
 }
 for (let index = 0; index < profile.length; index += 1) {
  profile[index] = (profile[index] - mean) / standardDeviation;
 }
}

function sampleLuminance(source: RgbaImageBuffer): Float32Array {
 const pixels = new Float32Array(PANOCAM_ALIGNMENT_FEATURE_WIDTH * PANOCAM_ALIGNMENT_FEATURE_HEIGHT);
 for (let y = 0; y < PANOCAM_ALIGNMENT_FEATURE_HEIGHT; y += 1) {
  const sourceY = Math.min(
   source.height - 1,
   Math.floor((y + 0.5) * source.height / PANOCAM_ALIGNMENT_FEATURE_HEIGHT),
  );
  for (let x = 0; x < PANOCAM_ALIGNMENT_FEATURE_WIDTH; x += 1) {
   const sourceX = Math.min(
    source.width - 1,
    Math.floor((x + 0.5) * source.width / PANOCAM_ALIGNMENT_FEATURE_WIDTH),
   );
   const offset = (sourceY * source.width + sourceX) * 4;
   pixels[y * PANOCAM_ALIGNMENT_FEATURE_WIDTH + x] =
    source.pixels[offset] * 0.299 +
    source.pixels[offset + 1] * 0.587 +
    source.pixels[offset + 2] * 0.114;
  }
 }
 return pixels;
}

export function buildPanoramaSignature(source: RgbaImageBuffer): PanoramaSignature {
 if (!Number.isInteger(source.width) || source.width <= 0) throw new RangeError("Signature width must be positive");
 if (!Number.isInteger(source.height) || source.height <= 0) throw new RangeError("Signature height must be positive");
 if (source.pixels.length < source.width * source.height * 4) {
  throw new RangeError("RGBA buffer is smaller than its declared dimensions");
 }

 const luminance = sampleLuminance(source);
 const bands = ALIGNMENT_BANDS.map(({ start, end }) => {
  const profile = new Float32Array(PANOCAM_ALIGNMENT_FEATURE_WIDTH);
  const startY = Math.max(1, Math.floor(start * PANOCAM_ALIGNMENT_FEATURE_HEIGHT));
  const endY = Math.min(PANOCAM_ALIGNMENT_FEATURE_HEIGHT, Math.ceil(end * PANOCAM_ALIGNMENT_FEATURE_HEIGHT));
  for (let y = startY; y < endY; y += 1) {
   const row = y * PANOCAM_ALIGNMENT_FEATURE_WIDTH;
   const previousRow = row - PANOCAM_ALIGNMENT_FEATURE_WIDTH;
   for (let x = 0; x < PANOCAM_ALIGNMENT_FEATURE_WIDTH; x += 1) {
    const current = luminance[row + x];
    const previousX = x === 0 ? PANOCAM_ALIGNMENT_FEATURE_WIDTH - 1 : x - 1;
    const horizontal = Math.abs(current - luminance[row + previousX]);
    const vertical = Math.abs(current - luminance[previousRow + x]);
    profile[x] += horizontal + vertical * 0.5;
   }
  }
  normalizeProfile(profile);
  return profile;
 });
 return { width: PANOCAM_ALIGNMENT_FEATURE_WIDTH, bands };
}

function correlation(
 reference: Float32Array,
 current: Float32Array,
 rollShift: number,
): number {
 let score = 0;
 for (let x = 0; x < reference.length; x += 1) {
  score += reference[x] * current[wrappedIndex(x - rollShift, reference.length)];
 }
 return score / reference.length;
}
function correlationRange(
 reference: Float32Array,
 current: Float32Array,
 start: number,
 end: number,
 rollShift: number,
): number {
 let score = 0;
 const length = Math.max(1, end - start);
 for (let x = start; x < end; x += 1) {
  score += reference[x] * current[wrappedIndex(x - rollShift, reference.length)];
 }
 return score / length;
}

function bestBandShift(reference: Float32Array, current: Float32Array): { shift: number; score: number } {
 let bestShift = 0;
 let bestScore = -Infinity;
 const half = Math.floor(reference.length / 2);
 for (let shift = -half; shift <= half; shift += 1) {
  const score = correlation(reference, current, shift);
  if (score > bestScore || (score === bestScore && Math.abs(shift) < Math.abs(bestShift))) {
   bestShift = shift;
   bestScore = score;
  }
 }
 return { shift: bestShift, score: bestScore };
}

export function findPanoramaAlignment(
 reference: PanoramaSignature,
 current: PanoramaSignature,
 options: {
  minScore?: number;
  minMargin?: number;
  maxBandDisagreement?: number;
 } = {},
): PanoramaAlignment {
 if (reference.width !== current.width) throw new RangeError("Alignment signatures must have equal widths");
 if (reference.bands.length !== current.bands.length || reference.bands.length === 0) {
  throw new RangeError("Alignment signatures must contain equal non-empty band sets");
 }
 for (const band of [...reference.bands, ...current.bands]) {
  if (band.length !== reference.width) throw new RangeError("Alignment bands must match signature width");
 }

 const minScore = options.minScore ?? PANOCAM_ALIGNMENT_MIN_SCORE;
 const minMargin = options.minMargin ?? PANOCAM_ALIGNMENT_MIN_MARGIN;
 const maxBandDisagreement = options.maxBandDisagreement ?? PANOCAM_ALIGNMENT_MAX_BAND_DISAGREEMENT;
 const half = Math.floor(reference.width / 2);
 const candidateShifts: number[] = [];
 const candidateScores: number[] = [];
 let bestShift = 0;
 let bestScore = -Infinity;
 for (let shift = -half; shift <= half; shift += 1) {
  let score = 0;
  for (let band = 0; band < reference.bands.length; band += 1) {
   score += correlation(reference.bands[band], current.bands[band], shift);
  }
  score /= reference.bands.length;
  candidateShifts.push(shift);
  candidateScores.push(score);
  if (score > bestScore || (score === bestScore && Math.abs(shift) < Math.abs(bestShift))) {
   bestShift = shift;
   bestScore = score;
  }
 }

 let secondScore = -Infinity;
 for (let index = 0; index < candidateScores.length; index += 1) {
  if (circularDistance(candidateShifts[index], bestShift, reference.width) <= 2) continue;
  secondScore = Math.max(secondScore, candidateScores[index]);
 }
 if (!Number.isFinite(secondScore)) secondScore = bestScore;
 const bandResults = reference.bands.map((band, index) => bestBandShift(band, current.bands[index]));
 const bandDisagreementPx = Math.max(
  ...bandResults.map((result) => circularDistance(result.shift, bestShift, reference.width)),
 );
 const tileScores: number[] = [];
 for (let tile = 0; tile < PANOCAM_ALIGNMENT_TILE_COUNT; tile += 1) {
  const start = Math.floor(tile * reference.width / PANOCAM_ALIGNMENT_TILE_COUNT);
  const end = Math.floor((tile + 1) * reference.width / PANOCAM_ALIGNMENT_TILE_COUNT);
  let score = 0;
  for (let band = 0; band < reference.bands.length; band += 1) {
   score += correlationRange(reference.bands[band], current.bands[band], start, end, bestShift);
  }
  tileScores.push(score / reference.bands.length);
 }
 const inlierTileCount = tileScores.filter((score) => score >= PANOCAM_ALIGNMENT_MIN_TILE_SCORE).length;
 const margin = bestScore - secondScore;
 const accepted =
  bestScore >= minScore &&
  margin >= minMargin &&
  bandDisagreementPx <= maxBandDisagreement &&
  inlierTileCount >= PANOCAM_ALIGNMENT_MIN_INLIER_TILES;
 const scoreConfidence = clamp((bestScore - minScore) / Math.max(1e-6, 1 - minScore), 0, 1);
 const marginConfidence = clamp(margin / Math.max(minMargin, 1e-6), 0, 1);
 const agreementConfidence = clamp(1 - bandDisagreementPx / Math.max(1, maxBandDisagreement), 0, 1);
 const tileConfidence = inlierTileCount / PANOCAM_ALIGNMENT_TILE_COUNT;
 const confidence = accepted
  ? scoreConfidence * 0.45 + marginConfidence * 0.2 + agreementConfidence * 0.15 + tileConfidence * 0.2
  : 0;
 return {
  accepted,
  shiftFeaturePx: bestShift,
  score: bestScore,
  margin,
  bandDisagreementPx,
  inlierTileCount,
  confidence,
 };
}

export function circularShiftRgba(source: RgbaImageBuffer, shiftPx: number): Uint8Array {
 if (!Number.isInteger(source.width) || source.width <= 0) throw new RangeError("Shift width must be positive");
 if (!Number.isInteger(source.height) || source.height <= 0) throw new RangeError("Shift height must be positive");
 if (source.pixels.length < source.width * source.height * 4) {
  throw new RangeError("RGBA buffer is smaller than its declared dimensions");
 }
 const target = new Uint8Array(source.width * source.height * 4);
 const normalizedShift = wrappedIndex(shiftPx, source.width);
 for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
   const targetX = wrappedIndex(x + normalizedShift, source.width);
   const sourceOffset = (y * source.width + x) * 4;
   const targetOffset = (y * source.width + targetX) * 4;
   target[targetOffset] = source.pixels[sourceOffset];
   target[targetOffset + 1] = source.pixels[sourceOffset + 1];
   target[targetOffset + 2] = source.pixels[sourceOffset + 2];
   target[targetOffset + 3] = source.pixels[sourceOffset + 3];
  }
 }
 return target;
}

export function copyRgbaSliceIntoPanorama(
 target: Uint8Array,
 targetWidth: number,
 slice: RgbaImageBuffer,
 targetX: number,
): void {
 if (!Number.isInteger(targetWidth) || targetWidth <= 0) throw new RangeError("Target width must be positive");
 if (!Number.isInteger(targetX) || targetX < 0 || targetX + slice.width > targetWidth) {
  throw new RangeError("Slice does not fit in the target panorama");
 }
 if (slice.pixels.length < slice.width * slice.height * 4) throw new RangeError("Slice buffer is too small");
 if (target.length < targetWidth * slice.height * 4) throw new RangeError("Target buffer is too small");
 for (let y = 0; y < slice.height; y += 1) {
  const sourceStart = y * slice.width * 4;
  const targetStart = (y * targetWidth + targetX) * 4;
  target.set(slice.pixels.subarray(sourceStart, sourceStart + slice.width * 4), targetStart);
 }
}

export function assembleRgbaSlices(slices: readonly RgbaImageBuffer[]): RgbaImageBuffer {
 if (slices.length === 0) throw new RangeError("At least one slice is required");
 const height = slices[0].height;
 let width = 0;
 for (const slice of slices) {
  if (slice.height !== height) throw new RangeError("All slices must have equal heights");
  if (slice.width <= 0 || slice.height <= 0) throw new RangeError("Slice dimensions must be positive");
  if (slice.pixels.length < slice.width * slice.height * 4) throw new RangeError("Slice buffer is too small");
  width += slice.width;
 }
 const pixels = new Uint8Array(width * height * 4);
 let targetX = 0;
 for (const slice of slices) {
  copyRgbaSliceIntoPanorama(pixels, width, slice, targetX);
  targetX += slice.width;
 }
 return { pixels, width, height };
}
