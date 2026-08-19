import type { PanoramaAlignment } from "./panorama-alignment";

export const PANORAMA_ALIGNMENT_PROBLEM_TYPE =
 "urn:bsky-mountain-out:problem:panorama-alignment-rejected";

export interface ProblemDetails {
 type: string;
 title: string;
 status: number;
 detail: string;
 instance?: string;
 [key: string]: unknown;
}

export interface ProblemFallback {
 status: number;
 title: string;
 type?: string;
}

export class PanoramaAlignmentRejectedError extends Error {
 readonly alignment: PanoramaAlignment;

 constructor(alignment: PanoramaAlignment) {
  const detail =
   `PanoCam panorama alignment rejected: score=${alignment.score.toFixed(3)} ` +
   `margin=${alignment.margin.toFixed(3)} ` +
   `bandDisagreement=${alignment.bandDisagreementPx.toFixed(1)} ` +
   `inlierTiles=${alignment.inlierTileCount}`;
  super(detail);
  this.name = "PanoramaAlignmentRejectedError";
  this.alignment = alignment;
 }
}

export function problemDetailsForError(
 error: unknown,
 fallback: ProblemFallback,
): ProblemDetails {
 if (error instanceof PanoramaAlignmentRejectedError) {
  return {
   type: PANORAMA_ALIGNMENT_PROBLEM_TYPE,
   title: "Panorama alignment rejected",
   status: 502,
   detail: error.message,
   alignment: error.alignment,
  };
 }
 return {
  type: fallback.type ?? "about:blank",
  title: fallback.title,
  status: fallback.status,
  detail: error instanceof Error ? error.message : String(error),
 };

}

export function problemResponse(problem: ProblemDetails): Response {
 return new Response(JSON.stringify(problem, null, 2), {
  status: problem.status,
  headers: {
   "Content-Type": "application/problem+json",
   "Cache-Control": "no-store",
  },
 });
}
