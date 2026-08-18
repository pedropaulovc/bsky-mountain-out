import { describe, expect, it } from "vitest";
import { discoverLatestFrame, frameFromId, parseFrameId } from "./frames";

const response = (status: number) => new Response(null, { status });

describe("PanoCam frame discovery", () => {
  it("parses frame ids and converts Pacific capture time", () => {
    expect(parseFrameId("2025_0325_130000")).toEqual({
      year: 2025,
      month: 3,
      day: 25,
      hour: 13,
      minute: 0,
      second: 0,
    });
    expect(frameFromId("2025_0704_090000").capturedAt.toISOString()).toBe("2025-07-04T16:00:00.000Z");
    expect(parseFrameId("2025_0230_130000")).toBeNull();
  });

  it("probes backward and stops when the persisted frame is reached", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return url.includes("160000") ? response(200) : response(404);
    };
    const frame = await discoverLatestFrame({
      now: new Date("2026-08-17T23:01:00.000Z"),
      fetcher,
    });
    expect(frame?.id).toBe("2026_0817_160000");
    expect(calls).toHaveLength(1);

    calls.length = 0;
    const noNewFrame = await discoverLatestFrame({
      now: new Date("2026-08-17T23:01:00.000Z"),
      lastFrame: "2026_0817_160000",
      fetcher,
    });
    expect(noNewFrame).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("falls back from HEAD to GET when the CDN rejects HEAD", async () => {
    const methods: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      methods.push(init?.method ?? "GET");
      return response(init?.method === "HEAD" ? 405 : 200);
    };
    const frame = await discoverLatestFrame({
      now: new Date("2026-08-17T23:01:00.000Z"),
      fetcher,
      maxProbes: 1,
    });
    expect(frame?.id).toBe("2026_0817_160000");
    expect(methods).toEqual(["HEAD", "GET"]);
  });

  it("walks older ten-minute marks when newer assets are unavailable", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return url.includes("154000") ? response(200) : response(404);
    };
    const frame = await discoverLatestFrame({
      now: new Date("2026-08-17T23:01:00.000Z"),
      fetcher,
      maxProbes: 3,
    });
    expect(frame?.id).toBe("2026_0817_154000");
    expect(calls).toHaveLength(3);
  });
});
