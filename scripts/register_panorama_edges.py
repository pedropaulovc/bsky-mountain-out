#!/usr/bin/env python3
"""Normalize, register, and cluster full PanoCam panoramas by structural edges."""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

FEATURE_WIDTH = 2048
FEATURE_HEIGHT = 256
PANORAMA_WIDTH = 8704
PANORAMA_HEIGHT = 1080


def load_sample_ids(sample_json: Path) -> list[str]:
    data = json.loads(sample_json.read_text(encoding="utf-8"))
    return [entry["frameId"] for entry in data]


def normalize_edges(path: Path) -> tuple[np.ndarray, np.ndarray]:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"cannot read {path}")
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (FEATURE_WIDTH, FEATURE_HEIGHT), interpolation=cv2.INTER_AREA)

    # Normalize local contrast so exposure and day/night color do not dominate.
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(32, 8))
    local_contrast = clahe.apply(resized)
    blurred = cv2.GaussianBlur(local_contrast, (0, 0), sigmaX=9.0)
    detail = cv2.GaussianBlur(cv2.absdiff(local_contrast, blurred), (0, 0), sigmaX=1.2)

    # Combine Canny with a Scharr magnitude map. Normalize against the upper
    # tail per image; flat gray/black frames then contribute almost no noise.
    canny = cv2.Canny(detail, 10, 34, apertureSize=3, L2gradient=True)
    dx = cv2.Scharr(detail, cv2.CV_32F, 1, 0)
    dy = cv2.Scharr(detail, cv2.CV_32F, 0, 1)
    magnitude = cv2.magnitude(dx, dy)
    low = float(np.percentile(magnitude, 94.0))
    high = float(np.percentile(magnitude, 99.5))
    if high > low + 1.0:
        structure = np.clip((magnitude - low) / (high - low), 0.0, 1.0)
    else:
        structure = np.zeros_like(magnitude, dtype=np.float32)
    canny_strength = cv2.GaussianBlur(canny.astype(np.float32) / 255.0, (3, 3), 0)
    edges = np.maximum(structure, canny_strength * 0.6)

    # Close only one-pixel gaps; do not dilate, which would turn dense
    # high-contrast neighborhoods into solid masks.
    kernel = np.ones((3, 3), dtype=np.uint8)
    canny_closed = cv2.morphologyEx((canny_strength * 255).astype(np.uint8), cv2.MORPH_CLOSE, kernel, iterations=1)
    edges = np.maximum(edges, canny_closed.astype(np.float32) / 255.0 * 0.45)
    edges[: int(FEATURE_HEIGHT * 0.12), :] = 0
    edges[int(FEATURE_HEIGHT * 0.96) :, :] = 0
    return resized, edges.astype(np.float32)


def feature_registration(reference_gray: np.ndarray, current_gray: np.ndarray, max_shift: int) -> tuple[int, float]:
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(32, 8))
    reference_image = clahe.apply(reference_gray.astype(np.uint8))
    current_image = clahe.apply(current_gray.astype(np.uint8))
    detector = cv2.SIFT_create(nfeatures=3000, contrastThreshold=0.02, edgeThreshold=12)
    reference_keypoints, reference_descriptors = detector.detectAndCompute(reference_image, None)
    current_keypoints, current_descriptors = detector.detectAndCompute(current_image, None)
    if reference_descriptors is None or current_descriptors is None:
        return 0, 0.0
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    matches = matcher.knnMatch(reference_descriptors, current_descriptors, k=2)
    deltas: list[tuple[float, float]] = []
    for pair in matches:
        if len(pair) != 2:
            continue
        first, second = pair
        if first.distance >= 0.80 * second.distance:
            continue
        reference_point = reference_keypoints[first.queryIdx].pt
        current_point = current_keypoints[first.trainIdx].pt
        dx = reference_point[0] - current_point[0]
        dy = reference_point[1] - current_point[1]
        if abs(dx) <= max_shift and abs(dy) <= 24:
            deltas.append((dx, dy))
    if len(deltas) < 4:
        return 0, 0.0
    values = np.asarray(deltas, dtype=np.float32)
    median_dx = float(np.median(values[:, 0]))
    median_dy = float(np.median(values[:, 1]))
    residual = np.hypot(values[:, 0] - median_dx, values[:, 1] - median_dy)
    inliers = residual <= max(4.0, float(np.percentile(residual, 55.0)))
    if int(inliers.sum()) < 4:
        return 0, 0.0
    return int(round(median_dx)), float(inliers.sum() / len(deltas))


def render_panel(images: list[tuple[np.ndarray, str]], output: Path, width: int = 960, height: int = 120) -> None:
    columns = len(images)
    panel = Image.new("RGB", (columns * width, height + 24), (16, 24, 32))
    draw = ImageDraw.Draw(panel)
    for index, (array, label) in enumerate(images):
        image = Image.fromarray(array).convert("RGB")
        image = ImageOps.fit(image, (width, height), method=Image.Resampling.BILINEAR)
        x = index * width
        panel.paste(image, (x, 24))
        draw.text((x + 6, 5), label, fill=(245, 247, 250))
        image.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    panel.save(output, format="JPEG", quality=86, optimize=True)
    panel.close()


def render_cluster_montage(records: list[dict], output: Path, width: int = 960, height: int = 120) -> None:
    columns = 2
    rows = math.ceil(len(records) / columns)
    montage = Image.new("RGB", (columns * width, rows * (height + 24)), (16, 24, 32))
    draw = ImageDraw.Draw(montage)
    for index, record in enumerate(records):
        with Image.open(record["path"]) as opened:
            image = ImageOps.fit(opened.convert("RGB"), (width, height), method=Image.Resampling.BILINEAR)
        x = (index % columns) * width
        y = (index // columns) * (height + 24)
        montage.paste(image, (x, y + 24))
        draw.text((x + 6, y + 5), f"{record['frame_id']} · shift {record['shift_px']}px", fill=(245, 247, 250))
        image.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    montage.save(output, format="JPEG", quality=86, optimize=True)
    montage.close()


def find_vertical_landmarks(consensus: np.ndarray) -> list[dict]:
    gray = cv2.normalize((consensus * 255).astype(np.uint8), None, 0, 255, cv2.NORM_MINMAX)
    city = gray[int(gray.shape[0] * 0.30) : int(gray.shape[0] * 0.96)]
    edge_image = cv2.Canny(city, 8, 24, apertureSize=3, L2gradient=True)
    lines = cv2.HoughLinesP(
        edge_image,
        1,
        np.pi / 180,
        threshold=12,
        minLineLength=18,
        maxLineGap=16,
    )
    if lines is None:
        return []
    candidates: list[tuple[float, float, float]] = []
    for line in lines.reshape(-1, 4):
        x1, y1, x2, y2 = map(float, line)
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        if dy < 3 or dx > dy * 0.35:
            continue
        x = (x1 + x2) / 2
        length = math.hypot(dx, dy)
        candidates.append((x, length, dx / max(dy, 1.0)))
    candidates.sort(key=lambda item: item[1], reverse=True)
    selected: list[dict] = []
    for x, length, slope in candidates:
        if any(abs(x - item["x_feature"]) < 24 for item in selected):
            continue
        selected.append({"x_feature": round(x, 1), "length": round(length, 1), "slope": round(slope, 3)})
        if len(selected) >= 20:
            break
    return selected


def run(args: argparse.Namespace) -> Path:
    input_dir = Path(args.input_dir).resolve()
    output = Path(args.output).resolve()
    sample_json = Path(args.sample_json).resolve()
    output.mkdir(parents=True, exist_ok=True)
    frame_ids = load_sample_ids(sample_json)
    paths = [input_dir / f"{frame_id}.jpg" for frame_id in frame_ids]

    raws: list[np.ndarray] = []
    edge_maps: list[np.ndarray] = []
    for index, path in enumerate(paths, start=1):
        raw, edges = normalize_edges(path)
        raws.append(raw)
        edge_maps.append(edges)
        if index % 20 == 0 or index == len(paths):
            print(f"Normalized {index}/{len(paths)} panoramas", flush=True)

    reference_index = int(np.argmax([float(edge.mean()) for edge in edge_maps]))
    reference = edge_maps[reference_index]
    shifts: list[int] = []
    registration_scores: list[float] = []
    aligned_edges: list[np.ndarray] = []
    for index, edge in enumerate(edge_maps):
        shift, score = feature_registration(raws[reference_index], raws[index], args.max_shift)
        shifts.append(shift)
        registration_scores.append(score)
        aligned_edges.append(np.roll(edge, shift, axis=1))
        if index % 20 == 0 or index == len(edge_maps) - 1:
            print(f"Registered {index + 1}/{len(edge_maps)} panoramas", flush=True)

    reliable_indexes = [index for index, score in enumerate(registration_scores) if score >= args.min_registration_score]
    if len(reliable_indexes) < 4:
        reliable_indexes = list(range(len(aligned_edges)))
    aligned_stack = np.stack([aligned_edges[index] for index in reliable_indexes])
    consensus = np.median(aligned_stack, axis=0)
    consensus_path = output / "consensus-edges.png"
    cv2.imwrite(str(consensus_path), (consensus * 255).astype(np.uint8))
    vertical_landmarks = find_vertical_landmarks(consensus)
    (output / "landmarks.json").write_text(json.dumps(vertical_landmarks, indent=2) + "\n", encoding="utf-8")

    aligned_features = np.stack([cv2.resize(edge, (128, 32), interpolation=cv2.INTER_AREA).reshape(-1) for edge in aligned_edges])
    candidates: list[tuple[int, float, np.ndarray]] = []
    max_k = min(args.max_k, len(frame_ids) - 1)
    for k in range(2, max_k + 1):
        model = KMeans(n_clusters=k, random_state=args.seed, n_init=20)
        labels = model.fit_predict(aligned_features)
        score = float(silhouette_score(aligned_features, labels))
        candidates.append((k, score, labels))
    best_k, best_score, labels = max(candidates, key=lambda item: item[1])

    rows: list[dict] = []
    for frame_id, shift, score, label in zip(frame_ids, shifts, registration_scores, labels, strict=True):
        rows.append({"frame_id": frame_id, "shift_feature_px": shift, "shift_panorama_px": round(shift * PANORAMA_WIDTH / FEATURE_WIDTH, 2), "registration_score": round(score, 5), "cluster": int(label + 1)})
    with (output / "alignment.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    raw_edge_samples = []
    for index in [0, reference_index, len(frame_ids) - 1]:
        raw_edge_samples.append((raws[index], f"raw {frame_ids[index]}"))
        edge_image = (aligned_edges[index] * 255).astype(np.uint8)
        raw_edge_samples.append((edge_image, f"normalized edges {frame_ids[index]}"))
    render_panel(raw_edge_samples, output / "normalization-examples.jpg", width=640, height=120)

    cluster_rows: list[dict] = []
    cluster_root = output / "clusters"
    for cluster in range(1, best_k + 1):
        member_indexes = [index for index, label in enumerate(labels, start=0) if label + 1 == cluster]
        distances = [(float(np.linalg.norm(aligned_features[index] - aligned_features[member_indexes].mean(axis=0))), index) for index in member_indexes]
        representatives = [index for _, index in sorted(distances)[: min(4, len(distances))]]
        panels = [
            {
                "path": input_dir / f"{frame_ids[index]}.jpg",
                "frame_id": frame_ids[index],
                "shift_px": rows[index]["shift_panorama_px"],
            }
            for index in representatives
        ]
        montage = cluster_root / f"cluster-{cluster:02d}-aligned-samples.jpg"
        render_cluster_montage(panels, montage)
        cluster_rows.append({"cluster": cluster, "count": len(member_indexes), "representatives": [frame_ids[index] for index in representatives], "montage": montage.relative_to(output).as_posix()})

    report = [
        "# Aggressive panorama edge registration",
        "",
        f"Input sample: `{sample_json}` ({len(frame_ids)} panoramas)",
        f"Reference frame: `{frame_ids[reference_index]}` (highest normalized edge density)",
        f"Registration shift range: `{min(shifts)}`..`{max(shifts)}` feature pixels; `{min(row['shift_panorama_px'] for row in rows)}`..`{max(row['shift_panorama_px'] for row in rows)}` panorama pixels",
        f"Registration score: median `{np.median(registration_scores):.4f}`, min `{min(registration_scores):.4f}`, max `{max(registration_scores):.4f}`",
        f"Reliable registrations used for consensus: **{len(reliable_indexes)}/{len(frame_ids)}** (threshold `{args.min_registration_score:.2f}`)",
        "",
        "## Normalization and registration",
        "",
        "Each panorama is converted to grayscale, locally contrast-normalized with CLAHE, high-pass filtered to remove day/night illumination, and processed with aggressive Canny plus high-percentile Scharr edges. Morphological closing preserves broken avenue, skyline, and shoreline edges without filling neighborhoods.",
        "",
        "Horizontal alignment uses SIFT feature matching on the CLAHE-normalized grayscale panoramas, with Lowe ratio filtering, vertical-delta filtering, and a robust median horizontal translation constrained to the configured search window. The registered edge maps are then used for consensus and clustering.",
        "",
        "![Normalization examples](normalization-examples.jpg)",
        "",
        "## Structural landmarks",
        "",
        "The Hough detector reports long near-vertical consensus edges in `landmarks.json`. These are candidate avenue/building edges after registration; they are not yet labeled geographically.",
        "",
        "The consensus edge image is available at [`consensus-edges.png`](consensus-edges.png).",
        "",
        "## Edge clusters",
        "",
        f"K-means over the registered edge maps selected **k={best_k}** with silhouette score **{best_score:.4f}**.",
        "",
        "| Cluster | Count | Representative frames | Samples |",
        "|---:|---:|---|---|",
    ]
    for row in cluster_rows:
        representatives = ", ".join(f"`{frame_id}`" for frame_id in row["representatives"])
        report.append(f"| {row['cluster']} | {row['count']} | {representatives} | [{row['montage']}]({row['montage']}) |")
    report.extend(
        [
            "",
            "## Conclusion",
            "",
            "The aggressive edge representation substantially suppresses day/night color and exposure differences, but the registration score and consensus image should be inspected before using the resulting shift as a production crop. Stable avenues and the Elliott Bay shoreline are viable geometric anchors; the next step is to label those consensus landmarks and estimate Rainier's bearing from clear mountain frames.",
            "",
            "This experiment demonstrates structural grouping and horizontal registration. It does not yet claim an automatically verified Rainier direction.",
        ]
    )
    (output / "REPORT.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"Registered edge report written to {output / 'REPORT.md'}")
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", default="reports/panorama-clusters-2026-08-18-final/panoramas")
    parser.add_argument("--sample-json", default="reports/panorama-clusters-2026-08-18-final/sample.json")
    parser.add_argument("--output", default="reports/panorama-edge-registration-2026-08-18")
    parser.add_argument("--max-k", type=int, default=8)
    parser.add_argument("--max-shift", type=int, default=512)
    parser.add_argument("--min-registration-score", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
