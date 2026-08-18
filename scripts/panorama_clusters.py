#!/usr/bin/env python3
"""Sample, assemble, and cluster Space Needle PanoCam panoramas."""
from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import csv
import io
import json
import math
import sys
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

ASSET_BASE = "https://d3omclagh7m7mg.cloudfront.net/assets"
DATA_URL = "https://d3omclagh7m7mg.cloudfront.net/data.json"
SLICE_COUNT = 17
SLICE_WIDTH = 512
SLICE_HEIGHT = 1080
PANORAMA_WIDTH = SLICE_COUNT * SLICE_WIDTH
USER_AGENT = "bsky-mountain-out-panorama-cluster/1.0"


@dataclass(frozen=True)
class Frame:
    frame_id: str
    captured_at: datetime

    @property
    def year(self) -> str:
        return self.frame_id[:4]

    @property
    def month(self) -> str:
        return self.frame_id[5:7]

    @property
    def day(self) -> str:
        return self.frame_id[7:9]

    @property
    def asset_base(self) -> str:
        return f"{ASSET_BASE}/{self.year}/{self.month}/{self.day}/{self.frame_id}"


def parse_frame_id(frame_id: str) -> Frame | None:
    try:
        captured_at = datetime.strptime(frame_id, "%Y_%m%d_%H%M%S")
    except ValueError:
        return None
    return Frame(frame_id, captured_at)


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def catalog_frames(data: dict, start: datetime, end: datetime) -> list[Frame]:
    frames: dict[str, Frame] = {}
    for year, months in data.items():
        if not isinstance(months, dict):
            continue
        for month in months.values():
            if not isinstance(month, dict):
                continue
            for day in month.values():
                if not isinstance(day, dict):
                    continue
                for raw_id in day.get("times", []):
                    frame = parse_frame_id(raw_id)
                    if frame and start <= frame.captured_at <= end:
                        frames[frame.frame_id] = frame
    return sorted(frames.values(), key=lambda frame: frame.captured_at)


def select_even_sample(frames: list[Frame], count: int) -> list[Frame]:
    if len(frames) <= count:
        return frames
    first = frames[0].captured_at
    last = frames[-1].captured_at
    timestamps = [frame.captured_at for frame in frames]
    chosen: list[Frame] = []
    used: set[str] = set()
    for index in range(count):
        target = first + (last - first) * index / (count - 1)
        position = bisect.bisect_left(timestamps, target)
        candidates = [position - 1, position, position + 1]
        candidates = [candidate for candidate in candidates if 0 <= candidate < len(frames)]
        candidate = min(candidates, key=lambda item: abs(timestamps[item] - target))
        while frames[candidate].frame_id in used and candidate + 1 < len(frames):
            candidate += 1
        chosen.append(frames[candidate])
        used.add(frames[candidate].frame_id)
    return sorted(chosen, key=lambda frame: frame.captured_at)


def slice_url(frame: Frame, index: int) -> str:
    return f"{frame.asset_base}/slice{index}.jpg"


def download(url: str, destination: Path) -> tuple[str, int]:
    if destination.exists() and destination.stat().st_size > 0:
        return "cached", destination.stat().st_size
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = response.read()
    if not payload:
        raise RuntimeError(f"empty response: {url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return "downloaded", len(payload)


def normalize_slice(path: Path) -> Image.Image:
    with Image.open(path) as opened:
        image = opened.convert("RGB")
    width, height = image.size
    target_width = min(width, SLICE_WIDTH)
    if height != SLICE_HEIGHT or width > SLICE_WIDTH:
        image = image.resize((target_width, SLICE_HEIGHT), Image.Resampling.LANCZOS)
    return image


def assemble_panorama(frame: Frame, raw_dir: Path, output: Path) -> None:
    panorama = Image.new("RGB", (PANORAMA_WIDTH, SLICE_HEIGHT), (0, 0, 0))
    for index in range(SLICE_COUNT):
        image = normalize_slice(raw_dir / frame.frame_id / f"slice{index}.jpg")
        x = index * SLICE_WIDTH
        if x >= PANORAMA_WIDTH:
            image.close()
            continue
        if x + image.width > PANORAMA_WIDTH:
            image = image.crop((0, 0, PANORAMA_WIDTH - x, image.height))
        panorama.paste(image, (x, 0))
        image.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    panorama.save(output, format="JPEG", quality=78, optimize=True, progressive=True)
    panorama.close()


def edge_feature(path: Path) -> np.ndarray:
    with Image.open(path) as opened:
        gray = opened.convert("L").resize((512, 64), Image.Resampling.BILINEAR)
    pixels = np.asarray(gray, dtype=np.float32)
    horizontal = np.zeros_like(pixels)
    vertical = np.zeros_like(pixels)
    horizontal[:, 1:] = np.abs(pixels[:, 1:] - pixels[:, :-1])
    vertical[1:, :] = np.abs(pixels[1:, :] - pixels[:-1, :])
    magnitude = np.hypot(horizontal, vertical)
    threshold = float(np.percentile(magnitude, 78))
    edges = (magnitude >= threshold).astype(np.uint8) * 255
    reduced = Image.fromarray(edges, mode="L").resize((64, 16), Image.Resampling.BILINEAR)
    return np.asarray(reduced, dtype=np.float32).reshape(-1) / 255.0


def make_labeled_thumbnail(path: Path, label: str, width: int = 960, height: int = 120) -> Image.Image:
    with Image.open(path) as opened:
        image = ImageOps.fit(opened.convert("RGB"), (width, height), method=Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height + 24), (16, 24, 32))
    canvas.paste(image, (0, 24))
    draw = ImageDraw.Draw(canvas)
    draw.text((8, 5), label, fill=(245, 247, 250))
    image.close()
    return canvas


def write_montage(paths: list[tuple[Path, str]], output: Path, columns: int = 2) -> None:
    if not paths:
        return
    thumbnails = [make_labeled_thumbnail(path, label) for path, label in paths]
    rows = math.ceil(len(thumbnails) / columns)
    width = max(image.width for image in thumbnails)
    height = max(image.height for image in thumbnails)
    montage = Image.new("RGB", (columns * width, rows * height), (16, 24, 32))
    for index, image in enumerate(thumbnails):
        montage.paste(image, ((index % columns) * width, (index // columns) * height))
        image.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    montage.save(output, format="JPEG", quality=82, optimize=True)
    montage.close()


def write_overview(records: list[dict], output: Path) -> None:
    thumb_width, thumb_height = 256, 32
    label_height = 18
    columns = 5
    rows = math.ceil(len(records) / columns)
    overview = Image.new("RGB", (columns * thumb_width, rows * (thumb_height + label_height)), (16, 24, 32))
    draw = ImageDraw.Draw(overview)
    for index, record in enumerate(records):
        with Image.open(record["panorama_path"]) as opened:
            image = ImageOps.fit(opened.convert("RGB"), (thumb_width, thumb_height), method=Image.Resampling.BILINEAR)
        x = (index % columns) * thumb_width
        y = (index // columns) * (thumb_height + label_height)
        overview.paste(image, (x, y + label_height))
        draw.text((x + 4, y + 2), f"C{record['cluster'] + 1} {record['frame_id']}", fill=(245, 247, 250))
    output.parent.mkdir(parents=True, exist_ok=True)
    overview.save(output, format="JPEG", quality=82, optimize=True)
    overview.close()


def run(args: argparse.Namespace) -> Path:
    output = Path(args.output).resolve()
    raw_dir = output / "raw"
    panorama_dir = output / "panoramas"
    cluster_dir = output / "clusters"
    output.mkdir(parents=True, exist_ok=True)
    start = datetime.strptime(args.start, "%Y-%m-%d")
    end = datetime.strptime(args.end, "%Y-%m-%d") + timedelta(days=1) - timedelta(microseconds=1)

    print("Fetching timestamp catalog", flush=True)
    data = fetch_json(DATA_URL)
    excluded = set(args.exclude_frame)
    excluded_dates = set(args.exclude_date)
    available = [
        frame
        for frame in catalog_frames(data, start, end)
        if frame.frame_id not in excluded and frame.captured_at.date().isoformat() not in excluded_dates
    ]
    if len(available) < args.count:
        raise RuntimeError(f"only {len(available)} timestamps available; need {args.count}")
    candidate_count = min(len(available), args.count + args.candidate_buffer)
    sampled_candidates = select_even_sample(available, candidate_count)
    print(f"Catalog: {len(available)} timestamps; testing {len(sampled_candidates)} candidates", flush=True)

    jobs = []
    for frame in sampled_candidates:
        for index in range(SLICE_COUNT):
            destination = raw_dir / frame.frame_id / f"slice{index}.jpg"
            jobs.append((frame.frame_id, slice_url(frame, index), destination))
    failures: list[str] = []
    failed_frame_ids: set[str] = set()
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_map = {
            executor.submit(download, url, destination): (frame_id, url, destination)
            for frame_id, url, destination in jobs
        }
        for future in concurrent.futures.as_completed(future_map):
            frame_id, url, destination = future_map[future]
            try:
                future.result()
            except Exception as error:  # noqa: BLE001 - report and continue
                failures.append(f"{url}: {error}")
                failed_frame_ids.add(frame_id)
            completed += 1
            if completed % 50 == 0 or completed == len(jobs):
                print(f"Downloaded {completed}/{len(jobs)} slices", flush=True)
    if failures:
        (output / "download-failures.txt").write_text("\n".join(failures) + "\n", encoding="utf-8")
        print(f"Skipped {len(failed_frame_ids)} incomplete timestamps; see download-failures.txt", flush=True)
    valid_candidates = [frame for frame in sampled_candidates if frame.frame_id not in failed_frame_ids]
    if len(valid_candidates) < args.count:
        raise RuntimeError(
            f"only {len(valid_candidates)} complete candidate timestamps; need {args.count}. "
            "Increase --candidate-buffer or exclude unavailable dates."
        )
    sampled = select_even_sample(valid_candidates, args.count)
    (output / "sample.json").write_text(
        json.dumps(
            [{"frameId": frame.frame_id, "capturedAt": frame.captured_at.isoformat()} for frame in sampled],
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Selected {len(sampled)} complete timestamps", flush=True)

    records: list[dict] = []
    for index, frame in enumerate(sampled, start=1):
        panorama_path = panorama_dir / f"{frame.frame_id}.jpg"
        assemble_panorama(frame, raw_dir, panorama_path)
        records.append({"frame_id": frame.frame_id, "captured_at": frame.captured_at.isoformat(), "panorama_path": panorama_path})
        if index % 10 == 0 or index == len(sampled):
            print(f"Assembled {index}/{len(sampled)} panoramas", flush=True)

    features = np.vstack([edge_feature(record["panorama_path"]) for record in records])
    feature_path = output / "edge-features.npy"
    np.save(feature_path, features)
    candidates: list[tuple[int, float, np.ndarray]] = []
    max_k = min(args.max_k, len(records) - 1)
    for k in range(2, max_k + 1):
        model = KMeans(n_clusters=k, random_state=args.seed, n_init=20)
        labels = model.fit_predict(features)
        score = float(silhouette_score(features, labels))
        candidates.append((k, score, labels))
    best_k, best_score, labels = max(candidates, key=lambda item: item[1])
    for record, label in zip(records, labels, strict=True):
        record["cluster"] = int(label)
    print(f"Selected k={best_k} with silhouette={best_score:.4f}", flush=True)

    cluster_rows: list[dict] = []
    model = KMeans(n_clusters=best_k, random_state=args.seed, n_init=20).fit(features)
    for cluster in range(best_k):
        members = [index for index, label in enumerate(labels) if label == cluster]
        distances = [(float(np.linalg.norm(features[index] - model.cluster_centers_[cluster])), index) for index in members]
        representatives = [index for _, index in sorted(distances)[: min(4, len(distances))]]
        sample_paths = [(records[index]["panorama_path"], f"{records[index]['frame_id']} · {records[index]['captured_at']}") for index in representatives]
        montage_path = cluster_dir / f"cluster-{cluster + 1:02d}-samples.jpg"
        write_montage(sample_paths, montage_path)
        cluster_rows.append(
            {
                "cluster": cluster + 1,
                "count": len(members),
                "representatives": [records[index]["frame_id"] for index in representatives],
                "montage": montage_path.relative_to(output).as_posix(),
            }
        )
    write_overview(records, output / "overview.jpg")

    for record in records:
        record["panorama_path"] = record["panorama_path"].relative_to(output).as_posix()
    with (output / "clusters.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["frame_id", "captured_at", "cluster", "panorama_path"])
        writer.writeheader()
        writer.writerows(records)

    report_lines = [
        "# PanoCam full-panorama clustering",
        "",
        f"Generated: `{datetime.now(timezone.utc).isoformat()}`",
        f"Available timestamps in range after exclusions: **{len(available)}**",
        f"Excluded timestamps: {', '.join(f'`{frame_id}`' for frame_id in sorted(excluded)) or 'none'}",
        f"Excluded dates: {', '.join(f'`{excluded_date}`' for excluded_date in sorted(excluded_dates)) or 'none'}",
        f"Sampled timestamps: **{len(sampled)}**",
        f"Incomplete candidate timestamps skipped: **{len(failed_frame_ids)}**",
        "",
        "## Method",
        "",
        f"- Downloaded all `{SLICE_COUNT}` numbered slices for each sampled timestamp.",
        f"- Assembled slices at their source offsets (`sliceN` at `N × {SLICE_WIDTH}px`) into `{PANORAMA_WIDTH}×{SLICE_HEIGHT}` panoramas.",
        "- Converted each panorama to grayscale, computed horizontal and vertical pixel gradients, thresholded the top 22% gradient magnitudes, and resized the edge map to 64×16.",
        f"- Ran K-means for k=2..{max_k}; selected the highest silhouette score.",
        f"- Selected **k={best_k}** with silhouette score **{best_score:.4f}**.",
        "",
        "## Cluster summary",
        "",
        "| Cluster | Count | Representative frames | Samples |",
        "|---:|---:|---|---|",
    ]
    for row in cluster_rows:
        representatives = ", ".join(f"`{frame_id}`" for frame_id in row["representatives"])
        report_lines.append(f"| {row['cluster']} | {row['count']} | {representatives} | [{row['montage']}]({row['montage']}) |")
    report_lines.extend(
        [
            "",
            "## Overview",
            "",
            "![All sampled panoramas, labeled by cluster](overview.jpg)",
            "",
            "The full panorama samples are in [`panoramas/`](panoramas/). The reproducible timestamp selection is in [`sample.json`](sample.json), and cluster assignments are in [`clusters.csv`](clusters.csv).",
            "",
            "## Interpretation and limitations",
            "",
            "Clusters describe visual edge-layout similarity, not semantic weather or compass classes. A cluster can combine similar skyline geometry under different lighting, and source-camera alignment changes can split visually related views across clusters.",
            "",
            "The edge feature is intentionally simple: it is useful for exposing whether panorama layouts group together, but it is not a robust panorama-registration algorithm and does not prove a stable physical heading.",
            "",
        ]
    )
    (output / "REPORT.md").write_text("\n".join(report_lines), encoding="utf-8")
    return output


def parse_args() -> argparse.Namespace:
    today = datetime.now(timezone.utc).date()
    three_years_ago = date(today.year - 3, today.month, today.day)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=three_years_ago.isoformat())
    parser.add_argument("--end", default=today.isoformat())
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--max-k", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--candidate-buffer", type=int, default=20)
    parser.add_argument("--exclude-frame", action="append", default=[])
    parser.add_argument("--exclude-date", action="append", default=[])
    parser.add_argument("--output", default="reports/panorama-clusters-2026-08-18")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        result = run(parse_args())
    except Exception as error:  # noqa: BLE001 - CLI should report a useful failure
        print(f"experiment failed: {error}", file=sys.stderr)
        raise
    print(f"Report written to {result / 'REPORT.md'}")
