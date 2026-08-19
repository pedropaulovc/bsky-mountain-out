import { describe, expect, it } from "vitest";
import type { PanoramaAlignment } from "./panorama-alignment";
import {
 PANORAMA_ALIGNMENT_PROBLEM_TYPE,
 PanoramaAlignmentRejectedError,
 problemDetailsForError,
 problemResponse,
} from "./problems";

const rejectedAlignment: PanoramaAlignment = {
 accepted: false,
 shiftFeaturePx: 17,
 score: 0.394,
 margin: 0.037,
 bandDisagreementPx: 222,
 inlierTileCount: 6,
 confidence: 0,
};

describe("RFC 9457 problem details", () => {
 it("maps rejected panorama alignment to an upstream processing problem", async () => {
  const error = new PanoramaAlignmentRejectedError(rejectedAlignment);
  const problem = problemDetailsForError(error, { status: 500, title: "Internal Server Error" });

  expect(problem).toMatchObject({
   type: PANORAMA_ALIGNMENT_PROBLEM_TYPE,
   title: "Panorama alignment rejected",
   status: 502,
   detail: "PanoCam panorama alignment rejected: score=0.394 margin=0.037 bandDisagreement=222.0 inlierTiles=6",
   alignment: rejectedAlignment,
  });

  const response = problemResponse(problem);
  expect(response.status).toBe(502);
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  await expect(response.json()).resolves.toMatchObject(problem);
 });

 it("preserves the fallback status for unknown errors", () => {
  expect(problemDetailsForError(new Error("upstream timeout"), {
   status: 504,
   title: "Gateway Timeout",
  })).toEqual({
   type: "about:blank",
   title: "Gateway Timeout",
   status: 504,
   detail: "upstream timeout",
  });
 });
});
