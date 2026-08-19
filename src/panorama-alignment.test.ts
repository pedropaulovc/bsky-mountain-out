import { describe, expect, it } from "vitest";
import {
 assembleRgbaSlices,
 buildPanoramaSignature,
 circularShiftRgba,
 findPanoramaAlignment,
} from "./panorama-alignment";

function pattern(width: number, height: number): Uint8Array {
 const pixels = new Uint8Array(width * height * 4);
 for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
   const value = Math.round(
    120 +
    70 * Math.sin(x * 0.073) +
    35 * Math.sin(x * 0.191) +
    18 * Math.cos(x * 0.017 + y * 0.31),
   );
   const clamped = Math.max(0, Math.min(255, value));
   const offset = (y * width + x) * 4;
   pixels[offset] = clamped;
   pixels[offset + 1] = clamped;
   pixels[offset + 2] = clamped;
   pixels[offset + 3] = 255;
  }
 }
 return pixels;
}

describe("Panocam panorama alignment", () => {
 it("returns the inverse of a known circular image shift", () => {
  const referencePixels = pattern(512, 96);
  const currentPixels = circularShiftRgba(
   { pixels: referencePixels, width: 512, height: 96 },
   37,
  );
  const result = findPanoramaAlignment(
   buildPanoramaSignature({ pixels: referencePixels, width: 512, height: 96 }),
   buildPanoramaSignature({ pixels: currentPixels, width: 512, height: 96 }),
  );

  expect(result.accepted).toBe(true);
  expect(result.shiftFeaturePx).toBe(-37);
  expect(result.score).toBeGreaterThan(0.9);
 });

 it("rejects a structurally empty panorama", () => {
  const pixels = new Uint8Array(512 * 96 * 4);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
  const signature = buildPanoramaSignature({ pixels, width: 512, height: 96 });
  const result = findPanoramaAlignment(signature, signature);

  expect(result.accepted).toBe(false);
  expect(result.confidence).toBe(0);
 });

 it("wraps RGBA pixels without changing their dimensions", () => {
  const pixels = new Uint8Array([
   1, 0, 0, 255,
   2, 0, 0, 255,
   3, 0, 0, 255,
  ]);
  const shifted = circularShiftRgba({ pixels, width: 3, height: 1 }, 1);

  expect([...shifted]).toEqual([
   3, 0, 0, 255,
   1, 0, 0, 255,
   2, 0, 0, 255,
  ]);
 });

 it("concatenates slices using their decoded widths", () => {
  const first = new Uint8Array([
   10, 0, 0, 255,
   11, 0, 0, 255,
  ]);
  const second = new Uint8Array([12, 0, 0, 255]);
  const assembled = assembleRgbaSlices([
   { pixels: first, width: 2, height: 1 },
   { pixels: second, width: 1, height: 1 },
  ]);

  expect(assembled.width).toBe(3);
  expect(assembled.height).toBe(1);
  expect([...assembled.pixels]).toEqual([
   10, 0, 0, 255,
   11, 0, 0, 255,
   12, 0, 0, 255,
  ]);
 });
});
