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
  it("uses the documented OpenAI Responses image input shape", () => {
    const input = buildVisionInput(image, "Return strict JSON.");
    expect(input).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(JSON.stringify(input)).toContain("input_image");
    expect(JSON.stringify(input)).toContain("data:image/jpeg;base64,");
  });
  it("adds ordered full-resolution reference images after the target", () => {
    const input = buildVisionInput(image, "Return strict JSON.", {}, [image], ["morning-visible"]);
    const body = input as { input: Array<{ content: Array<{ type: string; image_url?: string }> }> };
    expect(body.input[0].content).toHaveLength(3);
    expect(body.input[0].content[1].type).toBe("input_image");
    expect(body.input[0].content[2].image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(JSON.stringify(input)).toContain("morning-visible");
  });

  it("turns a strict OpenAI response into explicit, bounded alt text", async () => {
    const result = await classifyImage(
      {
        MODEL_ID: "gpt-5.6-luna",
        OPENAI_API_KEY: "test-key",
        OPENAI_API_URL: "https://api.openai.test/v1",
        CLASSIFIER_REASONING_EFFORT: "medium",
      },
      image,
      {
        timestamp: new Date("2026-08-17T23:00:00.000Z"),
        fetcher: async (_input, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.model).toBe("gpt-5.6-luna");
          expect(body.reasoning.effort).toBe("medium");
          return Response.json({
            output: [{
              type: "message",
              content: [{
                type: "output_text",
                text: '{"visible":true,"confidence":0.94,"sceneDescription":"Golden-hour skyline with Mount Rainier on the horizon"}',
              }],
            }],
          });
        },
      },
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
    const explicit = buildAltText("Mount Rainier is visible above the skyline. Clear sky.", true, "Aug 17, 2026 4:00 pm");
    expect(explicit.match(/Mount Rainier is visible/gi)).toHaveLength(1);
  });
});
