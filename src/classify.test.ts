import { describe, expect, it } from "vitest";
import {
  buildAltText,
  buildVisionInput,
  classifyImage,
} from "./classify";
import type { ImageArtifact } from "./types";

const image: ImageArtifact = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  contentType: "image/jpeg",
  width: 1,
  height: 1,
};

describe("vision classification", () => {
  it("uses the documented Moondream query input shape", () => {
    const input = buildVisionInput(image, "Return strict JSON.");
    expect(input).toMatchObject({
      task: "query",
      question: "Return strict JSON.",
      stream: false,
      reasoning: false,
    });
    expect(input.image).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("turns a strict model response into explicit, bounded alt text", async () => {
    const result = await classifyImage(
      {
        MODEL_ID: "test-model",
        AI: {
          run: async () => ({
            response: '```json\n{"visible":true,"confidence":0.94,"sceneDescription":"Golden-hour skyline with Mount Rainier on the horizon"}\n```',
          }),
        },
      },
      image,
      new Date("2026-08-17T23:00:00.000Z"),
    );
    expect(result.verdict).toBe("visible");
    expect(result.altText).toContain("Mount Rainier is visible.");
    expect(result.altText).toContain("Image: Space Needle PanoCam,");
    expect(result.altText).not.toMatch(/^(Image|Photo) of/i);
    expect(result.altText.length).toBeLessThanOrEqual(2000);
  });

  it("adds an explicit not-visible statement to a scene description", () => {
    const alt = buildAltText("Photo of a hazy Seattle skyline that appears empty", false, "Aug 17, 2026 4:00 pm");
    expect(alt).toContain("Mount Rainier is not visible.");
    expect(alt).not.toMatch(/appears|Photo of/i);
  });
});
