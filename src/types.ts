export type Verdict = "visible" | "not-visible";

export type ImageMode = "stitched" | "postcard" | "raw-slice" | "raw-slice-unwatermarked";

export interface Frame {
  id: string;
  timestamp: string;
  capturedAt: Date;
  assetBaseUrl: string;
  shareUrl: string;
}

export interface ImageArtifact {
  bytes: Uint8Array;
  contentType: "image/jpeg";
  width: number;
  height: number;
}

export interface Classification {
  visible: boolean;
  verdict: Verdict;
  confidence: number;
  sceneDescription: string;
  altText: string;
}

export interface BotState {
  lastVerdict?: Verdict;
  pendingCount: number;
  lastPostedVerdict?: Verdict;
  lastPostAt?: string;
  lastFrame?: string;
  notVisibleSince?: string;
  heartbeatWindow?: HeartbeatWindow;
}

export interface HeartbeatWindow {
  date: string;
  startMinute: number;
  endMinute: number;
}

export type DecisionKind =
  | "hold"
  | "low-confidence"
  | "transition"
  | "heartbeat";

export interface Decision {
  kind: DecisionKind;
  state: BotState;
  stateAfterPost?: BotState;
  text?: string;
  dayNumber?: number;
}

export interface Env {
  ASSETS?: Fetcher;
  STATE: KVNamespace;
  BSKY_IDENTIFIER: string;
  BSKY_APP_PASSWORD: string;
  BSKY_SERVICE_URL: string;
  MODEL_ID: string;
  OPENAI_API_KEY: string;
  OPENAI_API_URL: string;
  CLASSIFIER_REASONING_EFFORT: string;
  IMAGE_MODE: ImageMode;
  CLASSIFIER_REFERENCE_URLS: string;
  POSTING_ENABLED: string;
  DEV_TOKEN: string;
}

