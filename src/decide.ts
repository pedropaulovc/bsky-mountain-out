import type { BotState, Classification, Decision, HeartbeatWindow, Verdict } from "./types";

/** Confidence required before an observation is allowed to affect state. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;
export const PACIFIC_TIME_ZONE = "America/Los_Angeles";
export const HEARTBEAT_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/** The three daily windows in which a heartbeat may be posted. */
export const HEARTBEAT_WINDOWS = [
 { startMinute: 7 * 60, endMinute: 8 * 60 },
 { startMinute: 12 * 60, endMinute: 13 * 60 },
 { startMinute: 19 * 60, endMinute: 20 * 60 + 30 },
] as const;

export interface DecideInput {
 /** A normalized verdict. `visible` or `classification` are accepted as conveniences. */
 verdict?: Verdict;
 visible?: boolean;
 classification?: Pick<Classification, "visible" | "verdict" | "confidence">;
 confidence?: number;
 state: BotState;
 now: Date;
 random?: () => number;
}

interface PacificDateTime {
 date: string;
 minute: number;
}

type HeartbeatDefinition = (typeof HEARTBEAT_WINDOWS)[number];

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
 timeZone: PACIFIC_TIME_ZONE,
 year: "numeric",
 month: "2-digit",
 day: "2-digit",
 hour: "2-digit",
 minute: "2-digit",
 hourCycle: "h23",
});

function pacificDateTime(date: Date): PacificDateTime {
 const parts = Object.fromEntries(
  pacificFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
 );
 return {
  date: `${parts.year}-${parts.month}-${parts.day}`,
  minute: Number(parts.hour) * 60 + Number(parts.minute),
 };
}

function nextDate(date: string): string {
 const [year, month, day] = date.split("-").map(Number);
 const next = new Date(Date.UTC(year, month - 1, day + 1));
 return next.toISOString().slice(0, 10);
}

function cloneState(state: BotState): BotState {
 return {
  ...state,
  heartbeatWindow: state.heartbeatWindow
   ? { ...state.heartbeatWindow }
   : undefined,
 };
}

function randomIndex(length: number, random: () => number): number {
 const value = random();
 if (!Number.isFinite(value)) return 0;
 return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

function isValidWindow(window: HeartbeatWindow | undefined): window is HeartbeatWindow {
 return Boolean(
  window &&
  /^\d{4}-\d{2}-\d{2}$/.test(window.date) &&
  Number.isInteger(window.startMinute) &&
  Number.isInteger(window.endMinute) &&
  window.startMinute >= 0 &&
  window.endMinute <= 24 * 60 &&
  window.startMinute < window.endMinute,
 );
}

/**
 * Pick a window which has not ended yet. The current day's active window is
 * eligible, so selecting it while already inside it permits a post on this
 * first check. If all of today's windows have ended, selection moves to
 * tomorrow (in Pacific calendar time, not by adding 24 elapsed hours).
 */
function selectFutureWindow(
 local: PacificDateTime,
 random: () => number,
): HeartbeatWindow {
 const availableToday = HEARTBEAT_WINDOWS.filter(
  ({ endMinute }) => endMinute > local.minute,
 );
 const date = availableToday.length > 0 ? local.date : nextDate(local.date);
 const choices: readonly HeartbeatDefinition[] =
  availableToday.length > 0 ? availableToday : HEARTBEAT_WINDOWS;
 const selected = choices[randomIndex(choices.length, random)];
 return { date, ...selected };
}

function elapsedSince(iso: string | undefined, nowMs: number): number | undefined {
 if (!iso) return undefined;
 const timestamp = Date.parse(iso);
 if (!Number.isFinite(timestamp)) return undefined;
 return Math.max(0, nowMs - timestamp);
}

function heartbeatDue(state: BotState, now: Date): boolean {
 if (!state.notVisibleSince) return false;
 const notVisibleAge = elapsedSince(state.notVisibleSince, now.getTime());
 if (notVisibleAge === undefined || notVisibleAge < HEARTBEAT_DELAY_MS) return false;

 // A post made before the current not-visible period does not delay its
 // heartbeat. A heartbeat/transition made during it does.
 const postAge = elapsedSince(state.lastPostAt, now.getTime());
 return postAge === undefined || postAge >= HEARTBEAT_DELAY_MS;
}

function dayNumber(notVisibleSince: string | undefined, now: Date): number {
 const age = elapsedSince(notVisibleSince, now.getTime());
 return Math.max(1, Math.floor((age ?? 0) / (24 * 60 * 60 * 1000)));
}

function resolveVerdict(input: DecideInput): Verdict | undefined {
 if (input.verdict) return input.verdict;
 if (typeof input.visible === "boolean") {
  return input.visible ? "visible" : "not-visible";
 }
 if (input.classification) {
  if (input.classification.verdict) return input.classification.verdict;
  return input.classification.visible ? "visible" : "not-visible";
 }
 return undefined;
}

function resolveConfidence(input: DecideInput): number {
 const confidence = input.confidence ?? input.classification?.confidence;
 return typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0;
}

/**
 * Apply one observation without mutating the supplied state.
 *
 * `state` is the observation state and is safe to persist before attempting a
 * post. For a post decision, `stateAfterPost` is the state to persist only
 * after the post succeeds; retaining `state` on failure causes the same post
 * to be retried on the next observation.
 */
export function decide(input: DecideInput): Decision {
 const { state: originalState, now } = input;
 if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
  throw new RangeError("now must be a valid Date");
 }

 const observedState = cloneState(originalState);
 const verdict = resolveVerdict(input);
 if (!verdict || resolveConfidence(input) < HIGH_CONFIDENCE_THRESHOLD) {
  return { kind: "low-confidence", state: observedState };
 }

 const nowIso = now.toISOString();
 const state = cloneState(originalState);
 const previousVerdict = state.lastVerdict;
 const previousCount = Number.isInteger(state.pendingCount)
  ? Math.max(0, state.pendingCount)
  : 0;

 if (previousVerdict === verdict) {
  state.pendingCount = Math.min(2, previousCount + 1);
 } else {
  state.lastVerdict = verdict;
  state.pendingCount = 1;
 }
 state.lastVerdict = verdict;

 // A high-confidence visible observation ends the not-visible interval right
 // away, even while the visible transition is gathering its second check.
 if (verdict === "visible") {
  delete state.notVisibleSince;
  delete state.heartbeatWindow;
 } else if (!state.notVisibleSince) {
  state.notVisibleSince = nowIso;
 }

 const transitionReady =
  state.pendingCount >= 2 && state.lastPostedVerdict !== verdict;
 if (transitionReady) {
  const stateAfterPost = cloneState(state);
  stateAfterPost.pendingCount = 0;
  stateAfterPost.lastPostedVerdict = verdict;
  stateAfterPost.lastPostAt = nowIso;
  if (verdict === "visible") {
   delete stateAfterPost.notVisibleSince;
   delete stateAfterPost.heartbeatWindow;
  } else {
   stateAfterPost.notVisibleSince ??= nowIso;
   delete stateAfterPost.heartbeatWindow;
  }
  return {
   kind: "transition",
   state,
   stateAfterPost,
   text: verdict === "visible" ? "Yes! 🏔️" : "No.",
  };
 }

 // Heartbeats are only considered after a high-confidence not-visible
 // observation and never compete with a transition post.
 if (verdict === "not-visible" && heartbeatDue(state, now)) {
  const local = pacificDateTime(now);
  let window = isValidWindow(state.heartbeatWindow)
   ? { ...state.heartbeatWindow }
   : undefined;

  if (
   !window ||
   window.date < local.date ||
   (window.date === local.date && local.minute >= window.endMinute)
  ) {
   window = selectFutureWindow(local, input.random ?? Math.random);
   state.heartbeatWindow = window;
  }

  const insideWindow =
   window.date === local.date &&
   local.minute >= window.startMinute &&
   local.minute < window.endMinute;
  if (insideWindow) {
   const stateAfterPost = cloneState(state);
   delete stateAfterPost.heartbeatWindow;
   stateAfterPost.lastPostAt = nowIso;
   return {
    kind: "heartbeat",
    state,
    stateAfterPost,
    text: `Still no mountain. Day ${dayNumber(state.notVisibleSince, now)}. ⛅`,
    dayNumber: dayNumber(state.notVisibleSince, now),
   };
  }
 }

 return { kind: "hold", state };
}

export { pacificDateTime };
