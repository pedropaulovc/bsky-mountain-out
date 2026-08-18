#!/usr/bin/env -S npx tsx

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const VALID_LABELS = ["visible", "not-visible"] as const;
type Label = (typeof VALID_LABELS)[number];
type Example = {
  frameId: string;
  url: string;
  label: Label | null;
  status?: string;
  reviewPrompt?: string;
};

type ModelReport = {
  model: string;
  evaluated: number;
  skipped: number;
  correct: number;
  confusion: Record<Label, Record<Label, number>>;
};

const scriptDirectory = new URL(".", import.meta.url);
const defaultLabelsPath = resolve(fileURLToPath(new URL("labels.json", scriptDirectory)));
const requestTimeoutMs = 120_000;

function fail(message: string): never {
  throw new Error(message);
}

function usage(): void {
  console.log(`Usage: npm run eval -- [--labels FILE] [--models MODEL[,MODEL...]] [--limit N]

Required environment:
  CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID)
  CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)

Models default to EVAL_MODELS, then MODEL_ID, then @cf/moondream/moondream3.1-9B-A2B.
Labels with label:null are intentionally skipped until hand-labeled.`);
}

function parseArgs(): { labelsPath: string; models: string[]; limit?: number } {
  let labelsPath = process.env.LABELS_FILE ?? defaultLabelsPath;
  let modelsValue = process.env.EVAL_MODELS ?? process.env.MODEL_IDS ?? process.env.MODEL_ID ?? "@cf/moondream/moondream3.1-9B-A2B";
  let limit: number | undefined;

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--labels") {
      labelsPath = args[++index] ?? fail("--labels requires a file path");
      continue;
    }
    if (arg === "--models") {
      modelsValue = args[++index] ?? fail("--models requires a comma-separated model list");
      continue;
    }
    if (arg === "--limit") {
      const value = args[++index] ?? fail("--limit requires a positive integer");
      if (!/^\d+$/.test(value) || Number(value) < 1) fail("--limit must be a positive integer");
      limit = Number(value);
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }

  const models = [...new Set(modelsValue.split(",").map((model) => model.trim()).filter(Boolean))];
  if (models.length === 0) fail("at least one model is required via EVAL_MODELS or --models");
  return { labelsPath, models, limit };
}

function isLabel(value: unknown): value is Label {
  return value === VALID_LABELS[0] || value === VALID_LABELS[1];
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadManifest(path: string, limit?: number): Promise<Example[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`could not read labels file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.labels)) {
    fail(`labels file ${path} must contain a labels array`);
  }

  const selected = limit === undefined ? parsed.labels : parsed.labels.slice(0, limit);
  if (selected.length === 0) fail("labels file contains no examples");
  return selected.map((raw, index) => {
    if (!isRecord(raw)) fail(`labels[${index}] is not an object`);
    const frameId = raw.frameId;
    const url = raw.url;
    const label = raw.label;
    if (typeof frameId !== "string" || frameId.trim() === "") {
      fail(`labels[${index}].frameId must be a non-empty string`);
    }
    if (typeof url !== "string" || url.trim() === "") {
      fail(`labels[${index}].url must be a non-empty string`);
    }
    if (label !== null && !isLabel(label)) {
      fail(`labels[${index}].label must be visible, not-visible, or null`);
    }
    return {
      frameId,
      url,
      label: label ?? null,
      status: typeof raw.status === "string" ? raw.status : undefined,
      reviewPrompt: typeof raw.reviewPrompt === "string" ? raw.reviewPrompt : undefined,
    };
  });
}

async function loadImage(url: string, frameId: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (url.startsWith("file://")) {
    try {
      bytes = new Uint8Array(await readFile(new URL(url)));
    } catch (error) {
      fail(`could not read image ${frameId} from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch (error) {
      fail(`could not download image ${frameId} from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      fail(`image ${frameId} returned HTTP ${response.status}: ${body}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.byteLength === 0) fail(`image ${frameId} is empty`);
  return bytes;
}

function responseText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return "";
  for (const key of ["response", "answer", "description", "caption", "text", "output"]) {
    const value = result[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function parsePrediction(text: string, model: string, frameId: string): Label {
  const match = text.toLowerCase().match(/\b(not[ -]?visible|visible)\b/);
  if (!match) fail(`model ${model} returned no visible/not-visible label for ${frameId}: ${text.slice(0, 500)}`);
  return match[1].startsWith("not") ? "not-visible" : "visible";
}

async function runModel(model: string, examples: Example[], token: string, accountId: string): Promise<ModelReport> {
  const confusion: Record<Label, Record<Label, number>> = {
    visible: { visible: 0, "not-visible": 0 },
    "not-visible": { visible: 0, "not-visible": 0 },
  };
  let evaluated = 0;
  let skipped = 0;
  let correct = 0;
  const imageCache = new Map<string, Uint8Array>();
  // Model IDs intentionally retain their provider slash (for example
  // @cf/moondream/moondream3.1-9B-A2B), which is part of the Workers AI route.
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${encodeURI(model)}`;

  for (const example of examples) {
    if (example.label === null) {
      skipped += 1;
      continue;
    }
    const image = imageCache.get(example.url) ?? await loadImage(example.url, example.frameId);
    imageCache.set(example.url, image);
    const body = {
      task: "query",
      image: `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`,
      question: "Determine whether Mount Rainier is visibly present in this Space Needle webcam frame. Respond with exactly one label, visible or not-visible, followed by one short factual reason.",
      stream: false,
      reasoning: false,
    };
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      fail(`Workers AI request failed for model ${model}, frame ${example.frameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const raw = await response.text();
    if (!response.ok) fail(`Workers AI returned HTTP ${response.status} for model ${model}, frame ${example.frameId}: ${raw.slice(0, 1000)}`);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      fail(`Workers AI returned non-JSON for model ${model}, frame ${example.frameId}: ${raw.slice(0, 1000)}`);
    }
    if (!isRecord(payload) || payload.success !== true) {
      fail(`Workers AI returned an unsuccessful response for model ${model}, frame ${example.frameId}: ${raw.slice(0, 1000)}`);
    }
    const text = responseText(payload.result);
    if (!text) fail(`Workers AI response has no text for model ${model}, frame ${example.frameId}: ${raw.slice(0, 1000)}`);
    const prediction = parsePrediction(text, model, example.frameId);
    evaluated += 1;
    confusion[example.label][prediction] += 1;
    if (prediction === example.label) correct += 1;
  }
  return { model, evaluated, skipped, correct, confusion };
}

function printReport(report: ModelReport): void {
  console.log(`\nModel: ${report.model}`);
  console.log(`  evaluated: ${report.evaluated}`);
  console.log(`  skipped pending hand labels: ${report.skipped}`);
  if (report.evaluated === 0) {
    console.log("  accuracy: not computed (no labeled examples; replace label:null first)");
  } else {
    console.log(`  accuracy: ${(report.correct / report.evaluated * 100).toFixed(2)}% (${report.correct}/${report.evaluated})`);
  }
  console.log("  confusion (actual -> predicted):");
  for (const actual of VALID_LABELS) {
    console.log(`    ${actual}: visible=${report.confusion[actual].visible}, not-visible=${report.confusion[actual]["not-visible"]}`);
  }
  for (const label of VALID_LABELS) {
    const actualCount = VALID_LABELS.reduce((total, actual) => total + report.confusion[actual][label], 0);
    const predictedCount = VALID_LABELS.reduce((total, predicted) => total + report.confusion[label][predicted], 0);
    const truePositive = report.confusion[label][label];
    const precision = predictedCount === 0 ? 0 : truePositive / predictedCount;
    const recall = actualCount === 0 ? 0 : truePositive / actualCount;
    console.log(`  ${label}: precision=${(precision * 100).toFixed(2)}% recall=${(recall * 100).toFixed(2)}%`);
  }
}

async function main(): Promise<void> {
  const { labelsPath, models, limit } = parseArgs();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  if (!accountId) fail("CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID) is required; no accuracy is reported without credentials");
  if (!token) fail("CLOUDFLARE_API_TOKEN (or CF_API_TOKEN) is required; no accuracy is reported without credentials");
  const examples = await loadManifest(labelsPath, limit);
  const labeled = examples.filter((example) => example.label !== null).length;
  console.log(`Loaded ${examples.length} examples (${labeled} hand-labeled, ${examples.length - labeled} pending).`);
  const reports: ModelReport[] = [];
  for (const model of models) {
    reports.push(await runModel(model, examples, token, accountId));
  }
  for (const report of reports) printReport(report);
}

main().catch((error) => {
  console.error(`evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
