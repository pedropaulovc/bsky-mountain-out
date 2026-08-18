import { describe, expect, it } from "vitest";
import {
  decide,
  HEARTBEAT_WINDOWS,
  pacificDateTime,
} from "./decide";
import type { BotState } from "./types";

const high = 0.95;
const visible = (state: BotState, now: Date) =>
  decide({ verdict: "visible", confidence: high, state, now });
const notVisible = (state: BotState, now: Date) =>
  decide({ verdict: "not-visible", confidence: high, state, now });

function baseState(overrides: Partial<BotState> = {}): BotState {
  return { pendingCount: 0, ...overrides };
}

describe("decide", () => {
  it("requires exactly two consecutive checks for a visible transition", () => {
    const first = visible(baseState(), new Date("2026-01-01T12:00:00Z"));
    expect(first.kind).toBe("hold");
    expect(first.state.pendingCount).toBe(1);

    const second = visible(first.state, new Date("2026-01-01T12:01:00Z"));
    expect(second.kind).toBe("transition");
    expect(second.text).toBe("Yes! 🏔️");
    expect(second.state.pendingCount).toBe(2);
    expect(second.stateAfterPost?.lastPostedVerdict).toBe("visible");
    const third = visible(second.stateAfterPost!, new Date("2026-01-01T12:02:00Z"));
    expect(third.kind).toBe("hold");
  });

  it("requires exactly two consecutive checks for a not-visible transition", () => {
    const first = notVisible(baseState(), new Date("2026-01-01T12:00:00Z"));
    const second = notVisible(first.state, new Date("2026-01-01T12:01:00Z"));
    expect(second.kind).toBe("transition");
    expect(second.text).toBe("No.");
    expect(second.stateAfterPost?.lastPostedVerdict).toBe("not-visible");
    expect(second.stateAfterPost?.lastPostAt).toBe("2026-01-01T12:01:00.000Z");
  });

  it("does not advance or reset hysteresis at low confidence", () => {
    const state = baseState({ lastVerdict: "visible", pendingCount: 1 });
    const result = decide({
      verdict: "not-visible",
      confidence: 0.79,
      state,
      now: new Date("2026-01-01T12:00:00Z"),
    });
    expect(result.kind).toBe("low-confidence");
    expect(result.state).toEqual(state);
  });

  it("does not transition on a single changed check", () => {
    const result = notVisible(
      baseState({ lastVerdict: "visible", pendingCount: 2, lastPostedVerdict: "visible" }),
      new Date("2026-01-01T12:00:00Z"),
    );
    expect(result.kind).toBe("hold");
    expect(result.state.pendingCount).toBe(1);
  });

  it("keeps a future heartbeat window and posts once inside it", () => {
    const state = baseState({
      lastVerdict: "not-visible",
      pendingCount: 2,
      lastPostedVerdict: "not-visible",
      notVisibleSince: "2026-01-01T12:00:00.000Z",
      lastPostAt: "2026-01-01T12:00:00.000Z",
    });
    // 07:30 Pacific: random 1/2 chooses the noon window.
    const before = notVisibleWithRandom(
      state,
      new Date("2026-01-04T15:30:00Z"),
      0.5,
    );
    expect(before.kind).toBe("hold");
    expect(before.state.heartbeatWindow).toEqual({
      date: "2026-01-04",
      ...HEARTBEAT_WINDOWS[1],
    });

    const inside = notVisibleWithRandom(
      before.state,
      new Date("2026-01-04T20:00:00Z"),
      0,
    );
    expect(inside.kind).toBe("heartbeat");
    expect(inside.text).toBe("Still no mountain. Day 3. ⛅");
    expect(inside.stateAfterPost?.heartbeatWindow).toBeUndefined();
  });

  it("chooses a future window after a persisted window is missed", () => {
    const state = baseState({
      lastVerdict: "not-visible",
      pendingCount: 2,
      lastPostedVerdict: "not-visible",
      notVisibleSince: "2026-01-01T12:00:00.000Z",
      lastPostAt: "2026-01-01T12:00:00.000Z",
      heartbeatWindow: {
        date: "2026-01-04",
        ...HEARTBEAT_WINDOWS[0],
      },
    });
    // 22:00 Pacific: every window today is over, so selection advances a day.
    const result = notVisibleWithRandom(
      state,
      new Date("2026-01-05T06:00:00Z"),
      0,
    );
    expect(result.kind).toBe("hold");
    expect(result.state.heartbeatWindow).toEqual({
      date: "2026-01-05",
      ...HEARTBEAT_WINDOWS[0],
    });
  });

  it("uses Pacific time and handles daylight-saving conversion", () => {
    expect(pacificDateTime(new Date("2026-01-04T16:00:00Z"))).toEqual({
      date: "2026-01-04",
      minute: 8 * 60,
    });
    expect(pacificDateTime(new Date("2026-07-04T16:00:00Z"))).toEqual({
      date: "2026-07-04",
      minute: 9 * 60,
    });
  });
});

function notVisibleWithRandom(state: BotState, now: Date, value: number) {
  return decide({
    verdict: "not-visible",
    confidence: high,
    state,
    now,
    random: () => value,
  });
}
