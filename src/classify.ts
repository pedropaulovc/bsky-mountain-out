import type { Classification, Env, Frame, ImageArtifact, Verdict } from "./types";

/** The model must return this small, machine-readable object and nothing else. */
export const CLASSIFICATION_PROMPT = `Analyze the TARGET image or TARGET panel from the Space Needle PanoCam and determine whether Mount Rainier is visibly present. Return strict JSON only, with exactly these fields: {"visible": boolean, "confidence": number, "sceneDescription": string}. The confidence must be a number from 0 to 1. The sceneDescription becomes social-media alt text: write one or two concise factual sentences about the observable landscape, setting, light, and weather; do not start with "Image of" or "Photo of"; do not hedge with words such as "appears" or "seems"; do not editorialize; do not include the Rainier visibility verdict or source attribution because the application adds those explicitly. Do not use markdown, code fences, or commentary.`;

export const VISION_PROMPT = CLASSIFICATION_PROMPT;
export const REFERENCE_PROMPT_SUFFIX = `If the image is a labeled contact sheet, analyze only the panel labeled TARGET. Panels labeled REFERENCE are examples of Mount Rainier when visible; do not count a mountain in a REFERENCE panel as evidence that it is visible in TARGET. Compare the distinctive snow-covered summit and upper slopes, but rely on observable details in TARGET.`;

export interface ClassificationOptions {
 /** Override the model configured on the Worker. */
 modelId?: string;
 /** Override the default strict-JSON instruction. */
 prompt?: string;
 /** Timestamp used in the generated Bluesky alt text. */
 timestamp?: Date | string | number;
 /** Alias for timestamp, useful when adapting a Frame. */
 altDateTime?: Date | string | number;
 /** Alias for timestamp when a Frame is passed through. */
 capturedAt?: Date | string | number;
 /** Additional model input fields, such as model-specific generation settings. */
 input?: Record<string, unknown>;
 /** Optional labeled contact sheet used only by the classifier. */
 referenceSheet?: ImageArtifact;
}

export type ClassificationTimestamp = Date | string | number;
export type ClassificationInput = ClassificationOptions | ClassificationTimestamp | Frame;

export type ParsedClassification = Pick<
 Classification,
 "visible" | "verdict" | "confidence" | "sceneDescription"
>;

/** Build the strict instruction independently of the Worker AI binding. */
export function buildClassificationPrompt(override?: string): string {
 const prompt = override ?? CLASSIFICATION_PROMPT;
 if (typeof prompt !== "string" || prompt.trim().length === 0) {
  throw new TypeError("Classification prompt must be a non-empty string");
 }
 return prompt.trim();
}

/** Convert JPEG bytes to the data URI accepted by the Moondream Workers AI model. */
export function imageDataUri(image: ImageArtifact): string {
 if (image.contentType !== "image/jpeg") {
  throw new TypeError("Vision classification requires a JPEG ImageArtifact");
 }
 if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
  throw new TypeError("ImageArtifact must contain non-empty JPEG bytes");
 }
 return `data:image/jpeg;base64,${base64Encode(image.bytes)}`;
}

/** Build the model input without invoking Workers AI. */
export function buildVisionInput(
 image: ImageArtifact,
 prompt = CLASSIFICATION_PROMPT,
 additionalInput: Record<string, unknown> = {},
 referenceSheet?: ImageArtifact,
): Record<string, unknown> {
 const question = [
  buildClassificationPrompt(prompt),
  referenceSheet ? REFERENCE_PROMPT_SUFFIX : "",
 ].filter(Boolean).join("\n\n");
 return {
  task: "query",
  ...additionalInput,
  image: imageDataUri(referenceSheet ?? image),
  question,
  stream: false,
  reasoning: false,
 };
}

/**
 * Parse a model response. Workers AI models commonly return `{response: string}`,
 * while test doubles and other model versions may return the JSON object directly.
 */
export function parseClassificationResponse(response: unknown): ParsedClassification {
 const candidate = findClassificationCandidate(response);
 if (!candidate) {
  throw new Error("Vision model response did not contain a JSON classification");
 }

 if (typeof candidate.visible !== "boolean") {
  throw new Error("Vision classification is missing a boolean visible field");
 }
 if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence)) {
  throw new Error("Vision classification is missing a finite numeric confidence field");
 }

 const sceneDescription = candidate.sceneDescription ?? candidate.scene_description;
 if (typeof sceneDescription !== "string" || sceneDescription.trim().length === 0) {
  throw new Error("Vision classification is missing a sceneDescription field");
 }

 const visible = candidate.visible;
 const verdict: Verdict = visible ? "visible" : "not-visible";
 return {
  visible,
  verdict,
  confidence: Math.max(0, Math.min(1, candidate.confidence)),
  sceneDescription: sceneDescription.trim(),
 };
}

/** Generate the required, factual alt text for a classification. */
export function buildAltText(
 sceneDescription: string,
 visible: boolean,
 timestamp?: ClassificationTimestamp,
): string {
 if (typeof sceneDescription !== "string" || sceneDescription.trim().length === 0) {
  throw new TypeError("Scene description must be a non-empty string");
 }

 const scene = sanitizeSceneDescription(sceneDescription);
 const dateTime = formatAltDateTime(timestamp);
 const visibility = `Mount Rainier is ${visible ? "visible" : "not visible"}.`;
 const attribution = `Image: Space Needle PanoCam, ${dateTime} PT`;
 const suffix = `${visibility} ${attribution}`;
 const separatorLength = 2;
 const sceneLimit = Math.max(0, 2000 - suffix.length - separatorLength);
 const clippedScene = scene.slice(0, sceneLimit).trim().replace(/[.,;:]?\s*$/, "");
 return clippedScene.length > 0 ? `${clippedScene}. ${suffix}` : suffix;
}

export const createAltText = buildAltText;

/** Run Workers AI vision classification and return the shared Classification shape. */
export async function classifyImage(
 env: Pick<Env, "AI" | "MODEL_ID">,
 image: ImageArtifact,
 input?: ClassificationInput,
): Promise<Classification> {
 const options = normalizeOptions(input);
 const modelId = options.modelId ?? env.MODEL_ID;
 if (typeof modelId !== "string" || modelId.trim().length === 0) {
  throw new Error("A Workers AI model id is required for vision classification");
 }

 const prompt = buildClassificationPrompt(options.prompt);
 const modelInput = buildVisionInput(image, prompt, options.input, options.referenceSheet);
 const raw = await env.AI.run(modelId, modelInput);
 const parsed = parseClassificationResponse(raw);
 const timestamp = options.timestamp ?? options.altDateTime ?? options.capturedAt;
 return {
  ...parsed,
  altText: buildAltText(parsed.sceneDescription, parsed.visible, timestamp),
 };
}

function normalizeOptions(input?: ClassificationInput): ClassificationOptions {
 if (input === undefined) return {};
 if (input instanceof Date || typeof input === "string" || typeof input === "number") {
  return { timestamp: input };
 }
 if (isFrame(input)) {
  return { timestamp: input.capturedAt };
 }
 return input;
}

function isFrame(value: ClassificationOptions | Frame): value is Frame {
 return "capturedAt" in value && "id" in value && "assetBaseUrl" in value;
}

type UnknownRecord = Record<string, unknown>;

function findClassificationCandidate(value: unknown, depth = 0): UnknownRecord | undefined {
 if (depth > 6 || value === null || value === undefined) return undefined;
 if (typeof value === "string") {
  for (const parsed of parseJsonObjects(value)) {
   const candidate = findClassificationCandidate(parsed, depth + 1);
   if (candidate) return candidate;
  }
  return undefined;
 }
 if (Array.isArray(value)) {
  for (const item of value) {
   const candidate = findClassificationCandidate(item, depth + 1);
   if (candidate) return candidate;
  }
  return undefined;
 }
 if (typeof value !== "object") return undefined;

 const object = value as UnknownRecord;
 if ("visible" in object || "confidence" in object || "sceneDescription" in object || "scene_description" in object) {
  return object;
 }
 for (const key of ["response", "result", "output", "text", "answer", "caption", "content", "choices"]) {
  if (key in object) {
   const candidate = findClassificationCandidate(object[key], depth + 1);
   if (candidate) return candidate;
  }
 }
 return undefined;
}

function parseJsonObjects(text: string): UnknownRecord[] {
 const source = text.trim();
 if (source.length === 0) return [];
 const candidates: string[] = [];
 const direct = tryParseRecord(source);
 if (direct) candidates.push(source);

 const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
 for (const match of source.matchAll(fencePattern)) {
  if (match[1]) candidates.push(match[1].trim());
 }
 for (const objectText of balancedObjects(source)) candidates.push(objectText);

 const parsed: UnknownRecord[] = [];
 for (const candidate of candidates) {
  const object = tryParseRecord(candidate);
  if (object) parsed.push(object);
 }
 return parsed;
}

function tryParseRecord(value: string): UnknownRecord | undefined {
 try {
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
   ? (parsed as UnknownRecord)
   : undefined;
 } catch {
  return undefined;
 }
}

function balancedObjects(text: string): string[] {
 const objects: string[] = [];
 for (let start = 0; start < text.length; start += 1) {
  if (text[start] !== "{") continue;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
   const character = text[index];
   if (quoted) {
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') quoted = false;
    continue;
   }
   if (character === '"') {
    quoted = true;
   } else if (character === "{") {
    depth += 1;
   } else if (character === "}") {
    depth -= 1;
    if (depth === 0) {
     objects.push(text.slice(start, index + 1));
     break;
    }
   }
  }
 }
 return objects;
}

function sanitizeSceneDescription(value: string): string {
 let scene = value.replace(/\s+/g, " ").trim();
 scene = scene.replace(/^['"`\s]+|['"`\s]+$/g, "");
 scene = scene.replace(/^(?:(?:an?\s+)?(?:image|photo|photograph)\s+of\s+)+/i, "");
 scene = scene.replace(/\b(?:an?\s+)?(?:image|photo|photograph)\s+of\b/gi, "");
 scene = scene.replace(/\b(?:it\s+)?(?:appears?|seems?)\s+(?:to\s+be\s+|to\s+show\s+|that\s+)?/gi, "");
 scene = scene.replace(/\b(?:may|might|could)\s+be\b/gi, "");
 scene = scene.replace(/\b(?:possibly|perhaps|maybe|likely|probably|might|could)\b/gi, "");
 scene = scene.replace(/\b(?:beautiful|stunning|breathtaking|amazing|gorgeous|lovely|dramatic|spectacular|incredible|wonderful|great)\b/gi, "");
 scene = scene.replace(/\s{2,}/g, " ").replace(/^\s*[,.;:-]+\s*/, "").trim();
 return scene || "The camera view shows the surrounding landscape";
}

function formatAltDateTime(timestamp?: ClassificationTimestamp): string {
 if (timestamp instanceof Date) return formatDateInPacific(timestamp);
 if (typeof timestamp === "number") return formatDateInPacific(new Date(timestamp));
 if (typeof timestamp === "string" && timestamp.trim().length > 0) {
  const value = timestamp.trim().replace(/\s*PT\s*$/i, "");
  const parsed = Date.parse(value);
  if (/T|Z|\d{4}-\d{2}-\d{2}/i.test(value) && Number.isFinite(parsed)) {
   return formatDateInPacific(new Date(parsed));
  }
  return value.slice(0, 128);
 }
 return formatDateInPacific(new Date());
}

function formatDateInPacific(date: Date): string {
 if (!Number.isFinite(date.getTime())) return "unknown time";
 return new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  dateStyle: "medium",
  timeStyle: "short",
 }).format(date);
}

function base64Encode(bytes: Uint8Array): string {
 const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 let output = "";
 for (let index = 0; index < bytes.length; index += 3) {
  const first = bytes[index];
  const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
  const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
  output += alphabet[first >> 2];
  output += alphabet[((first & 3) << 4) | (second >> 4)];
  output += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
  output += index + 2 < bytes.length ? alphabet[third & 63] : "=";
 }
 return output;
}
