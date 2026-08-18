import { describe, expect, it } from "vitest";
import { createBlueskyClient } from "./bsky";
import type { ImageArtifact } from "./types";

const image: ImageArtifact = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "image/jpeg",
  width: 1,
  height: 1,
};

describe("Bluesky XRPC client", () => {
  it("authenticates lazily, uploads JPEG, and creates an alt-text image post", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("com.atproto.server.createSession")) {
        return Response.json({ accessJwt: "access", did: "did:plc:test", handle: "bot.test" });
      }
      if (url.endsWith("com.atproto.repo.uploadBlob")) {
        return Response.json({ blob: { $type: "blob", ref: { $link: "cid" }, mimeType: "image/jpeg", size: 3 } });
      }
      return Response.json({ uri: "at://did:plc:test/app.bsky.feed.post/1", cid: "postcid" });
    };

    const client = createBlueskyClient({
      identifier: "bot.test",
      appPassword: "app-password",
      fetcher,
    });
    expect(requests).toHaveLength(0);
    const created = await client.createPost({
      image,
      altText: "Seattle skyline. Mount Rainier is visible. Image: Space Needle PanoCam, Aug 17, 2026 4:00 pm PT",
      text: "Yes! 🏔️",
      createdAt: new Date("2026-08-17T23:00:00.000Z"),
    });

    expect(created).toEqual({ uri: "at://did:plc:test/app.bsky.feed.post/1", cid: "postcid" });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://bsky.social/xrpc/com.atproto.server.createSession",
      "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
      "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    ]);
    const recordRequest = requests[2];
    const recordBody = JSON.parse(String(recordRequest.init.body));
    expect(recordBody.record.embed.images[0].alt).toContain("Mount Rainier is visible.");
    expect(recordBody.record.createdAt).toBe("2026-08-17T23:00:00.000Z");
  });

  it("rejects an image post without alt text", async () => {
    const client = createBlueskyClient({
      identifier: "bot.test",
      appPassword: "app-password",
      fetcher: async () => Response.json({}),
    });
    await expect(client.createPost({ image, altText: " " })).rejects.toThrow("alt text is required");
  });
  it("surfaces non-ok XRPC authentication errors", async () => {
    const client = createBlueskyClient({
      identifier: "bot.test",
      appPassword: "app-password",
      fetcher: async () =>
        new Response(JSON.stringify({ error: "AuthenticationRequired", message: "invalid app password" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(client.getSession()).rejects.toThrow(
      "Bluesky com.atproto.server.createSession failed (401): AuthenticationRequired: invalid app password",
    );
  });

});
