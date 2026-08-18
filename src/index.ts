import { classifyImage, imageDataUri } from "./classify";
import { decide } from "./decide";
import { discoverLatestFrame, frameFromId } from "./frames";
import { buildImage, buildReferenceSheet } from "./image";
import { postImageToBluesky } from "./bsky";
import { createTickLogger, newTickId } from "./log";
import type {
  BotState,
  Classification,
  Decision,
  Env,
  Frame,
  ImageArtifact,
  ImageMode,
} from "./types";

const STATE_KEY = "bot-state";
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const DAYLIGHT_START_MINUTE = 6 * 60;
const DAYLIGHT_END_MINUTE = 21 * 60 + 30;
const DEFAULT_BOT_HANDLE = "@bsky-mountain-out";
interface TickOptions {
  now?: Date;
  allowPost?: boolean;
  persist?: boolean;
  ignoreLastFrame?: boolean;
  frameId?: string;
  rawOnly?: boolean;
  referenceOnly?: boolean;
  bypassDaylight?: boolean;
}

interface TickResult {
  status: "daylight-gated" | "no-new-frame" | "success";
  tickId: string;
  frame?: Frame;
  image?: ImageArtifact;
  classification?: Classification;
  decision?: Decision;
  posted?: { uri: string; cid: string };
  state: BotState;
}

const EMPTY_STATE: BotState = { pendingCount: 0 };

function cloneState(state: BotState): BotState {
  return {
    ...state,
    heartbeatWindow: state.heartbeatWindow ? { ...state.heartbeatWindow } : undefined,
  };
}

function normalizeState(value: unknown): BotState {
  if (!value || typeof value !== "object") return { ...EMPTY_STATE };
  const record = value as Record<string, unknown>;
  const pendingCount = typeof record.pendingCount === "number" && Number.isFinite(record.pendingCount)
    ? Math.max(0, Math.floor(record.pendingCount))
    : 0;
  const state: BotState = { pendingCount };
  if (record.lastVerdict === "visible" || record.lastVerdict === "not-visible") {
    state.lastVerdict = record.lastVerdict;
  }
  if (record.lastPostedVerdict === "visible" || record.lastPostedVerdict === "not-visible") {
    state.lastPostedVerdict = record.lastPostedVerdict;
  }
  if (typeof record.lastPostAt === "string" && record.lastPostAt.length > 0) state.lastPostAt = record.lastPostAt;
  if (typeof record.lastFrame === "string" && record.lastFrame.length > 0) state.lastFrame = record.lastFrame;
  if (typeof record.notVisibleSince === "string" && record.notVisibleSince.length > 0) {
    state.notVisibleSince = record.notVisibleSince;
  }
  const window = record.heartbeatWindow;
  if (window && typeof window === "object") {
    const candidate = window as Record<string, unknown>;
    if (
      typeof candidate.date === "string" &&
      typeof candidate.startMinute === "number" &&
      typeof candidate.endMinute === "number"
    ) {
      state.heartbeatWindow = {
        date: candidate.date,
        startMinute: candidate.startMinute,
        endMinute: candidate.endMinute,
      };
    }
  }
  return state;
}

async function readState(env: Env): Promise<BotState> {
  const value = await env.STATE.get(STATE_KEY, "json");
  return normalizeState(value);
}

async function writeState(env: Env, state: BotState): Promise<void> {
  await env.STATE.put(STATE_KEY, JSON.stringify(state));
}

function pacificClock(now: Date): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    minute: Number(value.hour) * 60 + Number(value.minute),
  };
}

export function isOperationalHour(now: Date): boolean {
  const minute = pacificClock(now).minute;
  return minute >= DAYLIGHT_START_MINUTE && minute <= DAYLIGHT_END_MINUTE;
}

function imageMode(env: Env): ImageMode {
  if (env.IMAGE_MODE === "raw-slice" || env.IMAGE_MODE === "raw-slice-unwatermarked") {
    return env.IMAGE_MODE;
  }
  return "stitched";
}
function classifierReferenceUrls(env: Env): string[] {
  return env.CLASSIFIER_REFERENCE_URLS.split(",").map((url) => url.trim()).filter(Boolean);
}
function classifierReferenceFetcher(env: Env): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/") && env.ASSETS) {
      return env.ASSETS.fetch(new Request(`https://bsky-mountain-out.assets${url}`, init));
    }
    return fetch(input, init);
  };
}

function botHandle(identifier: string | undefined): string {
  const trimmed = identifier?.trim();
  if (!trimmed) return DEFAULT_BOT_HANDLE;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function postingEnabled(env: Env): boolean {
  return env.POSTING_ENABLED?.trim().toLowerCase() === "true";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTick(env: Env, options: TickOptions = {}): Promise<TickResult> {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError("Tick time must be a valid Date");
  }
  const tickId = newTickId();
  const tick = createTickLogger(tickId);
  const state = await readState(env);
  if (!options.bypassDaylight && !isOperationalHour(now)) {
    tick.log("daylight-gated", { event: "daylight_gate", status: "skipped" });
    return { status: "daylight-gated", tickId, state };
  }

  const frame = options.frameId
    ? frameFromId(options.frameId)
    : await discoverLatestFrame({
      now,
      lastFrame: options.ignoreLastFrame ? undefined : state.lastFrame,
    });
  if (!frame) {
    tick.warn("no-new-frame", { event: "frame_probe", status: "no_new_frame" });
    return { status: "no-new-frame", tickId, state };
  }

  const startedAt = Date.now();
  const image = await buildImage(frame, imageMode(env), botHandle(env.BSKY_IDENTIFIER));
  const imageMs = Date.now() - startedAt;
  if (options.rawOnly) {
    const referenceUrls = options.referenceOnly ? classifierReferenceUrls(env) : [];
    const referenceSheet = options.referenceOnly
      ? await buildReferenceSheet(image, referenceUrls, { fetcher: classifierReferenceFetcher(env) })
      : undefined;
    const diagnosticImage = referenceSheet ?? image;
    tick.log("image-ready", {
      event: "image_ready",
      frame: frame.id,
      imageMode: imageMode(env),
      imageBytes: diagnosticImage.bytes.byteLength,
      referenceRequested: referenceUrls.length,
      imageMs,
    });
    return { status: "success", tickId, frame, image: diagnosticImage, state };
  }

  const referenceUrls = classifierReferenceUrls(env);
  const referenceStartedAt = Date.now();
  const referenceSheet = await buildReferenceSheet(image, referenceUrls, {
    fetcher: classifierReferenceFetcher(env),
  });
  const referenceMs = Date.now() - referenceStartedAt;
  const classifyStartedAt = Date.now();
  const classification = await classifyImage(env, image, {
    capturedAt: frame.capturedAt,
    referenceSheet,
  });
  const classifyMs = Date.now() - classifyStartedAt;
  const decision = decide({ classification, state, now });
  const observedState = { ...cloneState(decision.state), lastFrame: frame.id };
  let nextState: BotState = observedState;
  let posted: TickResult["posted"];
  const canPost = options.allowPost ?? postingEnabled(env);
  const shouldPost = decision.kind === "transition" || decision.kind === "heartbeat";

  if (shouldPost && canPost) {
    if (!decision.stateAfterPost || !decision.text) {
      throw new Error(`Decision ${decision.kind} did not include post state/text`);
    }
    try {
      const result = await postImageToBluesky(
        {
          identifier: env.BSKY_IDENTIFIER,
          appPassword: env.BSKY_APP_PASSWORD,
          serviceUrl: env.BSKY_SERVICE_URL,
        },
        {
          image,
          altText: classification.altText,
          text: decision.text,
          createdAt: now,
        },
      );
      posted = result;
      nextState = { ...cloneState(decision.stateAfterPost), lastFrame: frame.id };
      tick.log("post-created", {
        event: "post_created",
        frame: frame.id,
        verdict: classification.verdict,
        decision: decision.kind,
        postUri: result.uri,
      });
    } catch (error) {
      // Keep this frame eligible for retry. Persist the observation, but not the
      // frame id, so a failed transition cannot become a silent lost post.
      nextState = cloneState(decision.state);
      tick.error("post-failed", {
        event: "post_failed",
        frame: frame.id,
        decision: decision.kind,
        error: errorMessage(error),
      });
      if (options.persist !== false) await writeState(env, nextState);
      throw error;
    }
  }

  if (options.persist !== false) await writeState(env, nextState);
  tick.log("heartbeat", {
    event: "heartbeat",
    status: "success",
    frame: frame.id,
    verdict: classification.verdict,
    confidence: classification.confidence,
    decision: decision.kind,
    postingEnabled: canPost,
    posted: Boolean(posted),
    imageMs,
    referenceMs,
    referenceRequested: referenceUrls.length,
    referenceSheetBytes: referenceSheet?.bytes.byteLength ?? 0,
    classifyMs,
    ...(posted ? { postUri: posted.uri } : {}),
  });
  return { status: "success", tickId, frame, image, classification, decision, posted, state: nextState };
}

function safeSecretEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (index < left.length ? left.charCodeAt(index) : 0) ^
      (index < right.length ? right.charCodeAt(index) : 0);
  }
  return difference === 0;
}

function authorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(env.DEV_TOKEN && match) && safeSecretEqual(match?.[1] ?? "", env.DEV_TOKEN);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function htmlEscape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function renderDraftHtml(result: TickResult, requestedAt: Date): string {
  if (!result.frame || !result.image || !result.classification || !result.decision) {
    throw new Error("Draft pipeline did not produce a complete result");
  }
  const classification = result.classification;
  const proposedText = result.decision.text ?? (classification.visible ? "Yes! 🏔️" : "No.");
  const imageUri = imageDataUri(result.image);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Is Mt Rainier Out? Draft</title>
  <style>
    body { background: #101820; color: #f5f7fa; font: 16px system-ui, sans-serif; margin: 0; padding: 2rem; }
    main { margin: auto; max-width: 960px; }
    img { display: block; max-width: 100%; height: auto; border-radius: 0.5rem; }
    .card { background: #1b2733; border-radius: 0.5rem; margin-top: 1rem; padding: 1rem; }
    dt { color: #9fb3c8; margin-top: 0.75rem; }
    dd { margin: 0.25rem 0 0; white-space: pre-wrap; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
<main>
  <h1>Draft post</h1>
  <img src="${imageUri}" alt="${htmlEscape(classification.altText)}">
  <section class="card">
    <dl>
      <dt>Proposed post text</dt>
      <dd>${htmlEscape(proposedText)}</dd>
      <dt>Alt text</dt>
      <dd>${htmlEscape(classification.altText)}</dd>
      <dt>Decision</dt>
      <dd>${htmlEscape(result.decision.kind)} (not posted)</dd>
      <dt>Model verdict</dt>
      <dd>${htmlEscape(`${classification.verdict}, confidence ${classification.confidence}`)}</dd>
      <dt>Requested timestamp</dt>
      <dd>${htmlEscape(requestedAt.toISOString())}</dd>
      <dt>Frame</dt>
      <dd><code>${htmlEscape(result.frame.id)}</code> · ${htmlEscape(result.frame.timestamp)}</dd>
    </dl>
  </section>
</main>
</body>
</html>`;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runTick(env, { persist: true });
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!authorized(request, env)) return jsonResponse({ error: "unauthorized" }, 401);

    if (url.pathname === "/draft") {
      if (request.method !== "GET") return htmlResponse("<h1>Method not allowed</h1>", 405);
      const atValue = url.searchParams.get("at");
      if (!atValue) return htmlResponse("<h1>Missing at timestamp</h1><p>Use an ISO-8601 <code>at</code> query parameter.</p>", 400);
      const requestedAt = new Date(atValue);
      if (!Number.isFinite(requestedAt.getTime())) {
        return htmlResponse(`<h1>Invalid timestamp</h1><p>${htmlEscape(atValue)}</p>`, 400);
      }
      try {
        const result = await runTick(env, {
          now: requestedAt,
          frameId: url.searchParams.get("frame") ?? undefined,
          ignoreLastFrame: true,
          persist: false,
          allowPost: false,
          bypassDaylight: true,
        });
        if (result.status !== "success") {
          return htmlResponse(`<h1>Draft unavailable</h1><p>${htmlEscape(result.status)}</p>`, 502);
        }
        return htmlResponse(renderDraftHtml(result, requestedAt));
      } catch (error) {
        return htmlResponse(`<h1>Draft pipeline failed</h1><pre>${htmlEscape(errorMessage(error))}</pre>`, 502);
      }
    }

    if (url.pathname === "/status") {
      return jsonResponse(await readState(env));
    }
    if (url.pathname !== "/check") {
      return jsonResponse({ error: "not_found" }, 404);
    }
    if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);

    try {
      const rawOnly = url.searchParams.get("raw") === "1";
      const requestedPost = url.searchParams.get("post") === "1";
      const result = await runTick(env, {
        allowPost: requestedPost && postingEnabled(env),
        frameId: url.searchParams.get("frame") ?? undefined,
        ignoreLastFrame: true,
        persist: requestedPost && postingEnabled(env),
        rawOnly,
        referenceOnly: rawOnly && url.searchParams.get("refs") === "1",
        bypassDaylight: true,
      });
      if (rawOnly && result.image) {
        return new Response(result.image.bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": result.image.contentType,
            "Cache-Control": "no-store",
            "X-Frame-Id": result.frame?.id ?? "unknown",
          },
        });
      }
      return jsonResponse({
        status: result.status,
        tickId: result.tickId,
        frame: result.frame?.id,
        capturedAt: result.frame?.timestamp,
        classification: result.classification,
        decision: result.decision,
        posted: result.posted,
        state: result.state,
      });
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 502);
    }
  },
};
