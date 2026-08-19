# Panocam panorama alignment report

Generated: `2026-08-19T00:53:28.547Z`
Sample manifest: `reports/panorama-clusters-2026-08-18-final/sample.json`
Reference: `assets/panocam-alignment-reference.jpg`
Reference source frame: `2025_0325_130000` (clear, Rainier visible).

## Summary

- Sampled timestamps: **100** (the existing evenly spaced three-year manifest).
- Accepted alignments: **72**
- Rejected alignments: **28**
- Processing errors: **0**
- Applied source shift range: **-660..837 px**; median **692 px**.
- Source panoramas preserve the decoded terminal slice width; the report crops the old 8704px cache to the true source width before applying the shift.

## Method

1. Fetch each frame's full-width `thumbnail.jpg`.
2. Resize to a 512×96 structural representation and compare three vertical edge bands over all circular horizontal shifts.
3. Require a score/margin gate, agreement between vertical bands, and at least four of eight inlier horizontal tiles.
4. Apply the measured shift to the true-width cached panorama, crop the canonical 512×384 Rainier window, resize it to 1440×1080, and add the production attribution strip.

## Final adjusted crops

The overview is generated after alignment. Individual final crops are in [`adjusted-crops/`](adjusted-crops/).

![Final adjusted crops](final-crops-overview.jpg)

## Per-frame results

| Frame | Status | Applied shift (px) | Score | Confidence | Inlier tiles | Crop |
|---|---:|---:|---:|---:|---:|---|
| `2023_0818_000000` | accepted | 677 | 0.484 | 0.672 | 8 | [crop](adjusted-crops/2023_0818_000000.jpg) |
| `2023_0826_202000` | accepted | 677 | 0.559 | 0.714 | 8 | [crop](adjusted-crops/2023_0826_202000.jpg) |
| `2023_0913_124000` | accepted | 677 | 0.696 | 0.829 | 8 | [crop](adjusted-crops/2023_0913_124000.jpg) |
| `2023_0922_085000` | accepted | 677 | 0.600 | 0.750 | 7 | [crop](adjusted-crops/2023_0922_085000.jpg) |
| `2023_1001_050000` | accepted | 677 | 0.481 | 0.652 | 8 | [crop](adjusted-crops/2023_1001_050000.jpg) |
| `2023_1010_012000` | accepted | 677 | 0.484 | 0.710 | 8 | [crop](adjusted-crops/2023_1010_012000.jpg) |
| `2023_1027_174000` | accepted | 709 | 0.340 | 0.485 | 6 | [crop](adjusted-crops/2023_1027_174000.jpg) |
| `2023_1105_135000` | accepted | 676 | 0.612 | 0.782 | 8 | [crop](adjusted-crops/2023_1105_135000.jpg) |
| `2023_1114_100000` | accepted | 676 | 0.593 | 0.771 | 8 | [crop](adjusted-crops/2023_1114_100000.jpg) |
| `2023_1123_062000` | accepted | 676 | 0.496 | 0.717 | 8 | [crop](adjusted-crops/2023_1123_062000.jpg) |
| `2023_1210_224000` | rejected |  | 0.378 | 0.000 | 5 |  |
| `2023_1219_184000` | rejected |  | 0.428 | 0.000 | 6 |  |
| `2023_1228_150000` | accepted | 805 | 0.455 | 0.693 | 8 | [crop](adjusted-crops/2023_1228_150000.jpg) |
| `2025_0101_000000` | rejected |  | 0.416 | 0.000 | 6 |  |
| `2025_0101_002000` | rejected |  | 0.409 | 0.000 | 6 |  |
| `2025_0101_004000` | rejected |  | 0.421 | 0.000 | 6 |  |
| `2025_0101_010000` | accepted | 741 | 0.480 | 0.607 | 7 | [crop](adjusted-crops/2025_0101_010000.jpg) |
| `2025_0101_012000` | accepted | 741 | 0.456 | 0.638 | 8 | [crop](adjusted-crops/2025_0101_012000.jpg) |
| `2025_0101_014000` | accepted | 709 | 0.468 | 0.645 | 8 | [crop](adjusted-crops/2025_0101_014000.jpg) |
| `2025_0101_020000` | accepted | 676 | 0.513 | 0.726 | 8 | [crop](adjusted-crops/2025_0101_020000.jpg) |
| `2025_0101_022000` | accepted | 805 | 0.495 | 0.716 | 8 | [crop](adjusted-crops/2025_0101_022000.jpg) |
| `2025_0101_024000` | accepted | 741 | 0.470 | 0.558 | 6 | [crop](adjusted-crops/2025_0101_024000.jpg) |
| `2025_0101_030000` | rejected |  | 0.452 | 0.000 | 5 |  |
| `2025_0101_032000` | accepted | 693 | 0.482 | 0.690 | 8 | [crop](adjusted-crops/2025_0101_032000.jpg) |
| `2025_0101_034000` | rejected |  | 0.464 | 0.000 | 7 |  |
| `2025_0101_040000` | rejected |  | 0.432 | 0.000 | 7 |  |
| `2025_0101_042000` | accepted | 821 | 0.464 | 0.673 | 7 | [crop](adjusted-crops/2025_0101_042000.jpg) |
| `2025_0101_044000` | accepted | 821 | 0.488 | 0.687 | 7 | [crop](adjusted-crops/2025_0101_044000.jpg) |
| `2025_0101_050000` | accepted | 805 | 0.454 | 0.637 | 8 | [crop](adjusted-crops/2025_0101_050000.jpg) |
| `2025_0101_052000` | rejected |  | 0.456 | 0.000 | 8 |  |
| `2025_0101_054000` | accepted | 709 | 0.482 | 0.709 | 8 | [crop](adjusted-crops/2025_0101_054000.jpg) |
| `2025_0101_060000` | accepted | 709 | 0.479 | 0.682 | 7 | [crop](adjusted-crops/2025_0101_060000.jpg) |
| `2025_0101_062000` | accepted | 837 | 0.501 | 0.700 | 8 | [crop](adjusted-crops/2025_0101_062000.jpg) |
| `2025_0101_064000` | accepted | 821 | 0.502 | 0.720 | 8 | [crop](adjusted-crops/2025_0101_064000.jpg) |
| `2025_0101_070000` | accepted | 821 | 0.487 | 0.712 | 8 | [crop](adjusted-crops/2025_0101_070000.jpg) |
| `2025_0101_072000` | rejected |  | 0.458 | 0.000 | 6 |  |
| `2025_0101_074000` | accepted | 725 | 0.571 | 0.734 | 7 | [crop](adjusted-crops/2025_0101_074000.jpg) |
| `2025_0101_080000` | accepted | 821 | 0.468 | 0.676 | 7 | [crop](adjusted-crops/2025_0101_080000.jpg) |
| `2025_0101_081000` | accepted | 837 | 0.472 | 0.678 | 7 | [crop](adjusted-crops/2025_0101_081000.jpg) |
| `2025_0101_082000` | rejected |  | 0.407 | 0.000 | 6 |  |
| `2025_0101_083000` | rejected |  | 0.428 | 0.000 | 6 |  |
| `2025_0101_084000` | rejected |  | 0.445 | 0.000 | 7 |  |
| `2025_0101_085000` | accepted | 837 | 0.528 | 0.709 | 7 | [crop](adjusted-crops/2025_0101_085000.jpg) |
| `2025_0101_090000` | accepted | 837 | 0.533 | 0.694 | 7 | [crop](adjusted-crops/2025_0101_090000.jpg) |
| `2025_0101_091000` | accepted | 837 | 0.580 | 0.739 | 7 | [crop](adjusted-crops/2025_0101_091000.jpg) |
| `2025_0101_092000` | accepted | 805 | 0.576 | 0.736 | 7 | [crop](adjusted-crops/2025_0101_092000.jpg) |
| `2025_0111_194000` | accepted | 741 | 0.488 | 0.712 | 8 | [crop](adjusted-crops/2025_0111_194000.jpg) |
| `2025_0129_121000` | accepted | 676 | 0.662 | 0.810 | 8 | [crop](adjusted-crops/2025_0129_121000.jpg) |
| `2025_0207_082000` | accepted | 741 | 0.463 | 0.648 | 6 | [crop](adjusted-crops/2025_0207_082000.jpg) |
| `2025_0216_042000` | accepted | 660 | 0.507 | 0.723 | 8 | [crop](adjusted-crops/2025_0216_042000.jpg) |
| `2025_0225_004000` | rejected |  | 0.419 | 0.000 | 7 |  |
| `2025_0305_210000` | rejected |  | 0.364 | 0.000 | 7 |  |
| `2025_0314_170000` | rejected |  | 0.362 | 0.000 | 7 |  |
| `2025_0323_132000` | accepted | -660 | 0.557 | 0.707 | 7 | [crop](adjusted-crops/2025_0323_132000.jpg) |
| `2025_0410_054000` | accepted | 660 | 0.493 | 0.715 | 8 | [crop](adjusted-crops/2025_0410_054000.jpg) |
| `2025_0419_020000` | accepted | -451 | 0.447 | 0.645 | 7 | [crop](adjusted-crops/2025_0419_020000.jpg) |
| `2025_0428_134000` | accepted | 660 | 0.702 | 0.832 | 8 | [crop](adjusted-crops/2025_0428_134000.jpg) |
| `2025_0506_182000` | rejected |  | 0.382 | 0.000 | 6 |  |
| `2025_0524_104000` | accepted | -32 | 0.678 | 0.819 | 8 | [crop](adjusted-crops/2025_0524_104000.jpg) |
| `2025_0602_070000` | accepted | 660 | 0.626 | 0.789 | 8 | [crop](adjusted-crops/2025_0602_070000.jpg) |
| `2025_0611_030000` | rejected |  | 0.263 | 0.000 | 6 |  |
| `2025_0619_232000` | accepted | 660 | 0.500 | 0.718 | 8 | [crop](adjusted-crops/2025_0619_232000.jpg) |
| `2025_0628_193000` | rejected |  | 0.377 | 0.000 | 6 |  |
| `2025_0725_081000` | accepted | 644 | 0.602 | 0.738 | 8 | [crop](adjusted-crops/2025_0725_081000.jpg) |
| `2025_0803_042000` | accepted | 403 | 0.491 | 0.695 | 8 | [crop](adjusted-crops/2025_0803_042000.jpg) |
| `2025_0812_004000` | rejected |  | 0.384 | 0.000 | 6 |  |
| `2025_0820_204000` | rejected |  | 0.439 | 0.000 | 6 |  |
| `2025_0829_170000` | accepted | 692 | 0.544 | 0.725 | 8 | [crop](adjusted-crops/2025_0829_170000.jpg) |
| `2025_0916_092000` | accepted | 708 | 0.527 | 0.709 | 7 | [crop](adjusted-crops/2025_0916_092000.jpg) |
| `2025_0925_054000` | accepted | 692 | 0.486 | 0.667 | 7 | [crop](adjusted-crops/2025_0925_054000.jpg) |
| `2025_1004_014000` | accepted | 692 | 0.508 | 0.705 | 8 | [crop](adjusted-crops/2025_1004_014000.jpg) |
| `2025_1012_220000` | accepted | 692 | 0.486 | 0.636 | 8 | [crop](adjusted-crops/2025_1012_220000.jpg) |
| `2025_1030_142000` | accepted | 708 | 0.655 | 0.787 | 8 | [crop](adjusted-crops/2025_1030_142000.jpg) |
| `2025_1108_103000` | accepted | 692 | 0.646 | 0.801 | 8 | [crop](adjusted-crops/2025_1108_103000.jpg) |
| `2025_1117_064000` | rejected |  | 0.409 | 0.000 | 7 |  |
| `2025_1126_030000` | rejected |  | 0.164 | 0.000 | 6 |  |
| `2025_1204_230000` | rejected |  | 0.139 | 0.000 | 7 |  |
| `2025_1213_192000` | accepted | 692 | 0.508 | 0.723 | 8 | [crop](adjusted-crops/2025_1213_192000.jpg) |
| `2025_1231_115000` | accepted | 692 | 0.617 | 0.747 | 8 | [crop](adjusted-crops/2025_1231_115000.jpg) |
| `2026_0109_080000` | accepted | 692 | 0.576 | 0.737 | 7 | [crop](adjusted-crops/2026_0109_080000.jpg) |
| `2026_0118_040000` | accepted | 692 | 0.506 | 0.722 | 8 | [crop](adjusted-crops/2026_0118_040000.jpg) |
| `2026_0127_002000` | accepted | 692 | 0.488 | 0.712 | 8 | [crop](adjusted-crops/2026_0127_002000.jpg) |
| `2026_0213_165000` | accepted | 692 | 0.651 | 0.804 | 8 | [crop](adjusted-crops/2026_0213_165000.jpg) |
| `2026_0303_091000` | accepted | 692 | 0.674 | 0.816 | 8 | [crop](adjusted-crops/2026_0303_091000.jpg) |
| `2026_0312_052000` | accepted | 692 | 0.527 | 0.734 | 8 | [crop](adjusted-crops/2026_0312_052000.jpg) |
| `2026_0321_014000` | accepted | 692 | 0.524 | 0.732 | 8 | [crop](adjusted-crops/2026_0321_014000.jpg) |
| `2026_0329_214000` | accepted | 692 | 0.480 | 0.707 | 8 | [crop](adjusted-crops/2026_0329_214000.jpg) |
| `2026_0416_141000` | accepted | 692 | 0.732 | 0.849 | 8 | [crop](adjusted-crops/2026_0416_141000.jpg) |
| `2026_0425_102000` | accepted | 692 | 0.694 | 0.828 | 8 | [crop](adjusted-crops/2026_0425_102000.jpg) |
| `2026_0504_063000` | accepted | 692 | 0.456 | 0.669 | 7 | [crop](adjusted-crops/2026_0504_063000.jpg) |
| `2026_0513_024000` | accepted | 692 | 0.483 | 0.709 | 8 | [crop](adjusted-crops/2026_0513_024000.jpg) |
| `2026_0521_230000` | rejected |  | 0.430 | 0.000 | 6 |  |
| `2026_0530_192000` | rejected |  | 0.391 | 0.000 | 6 |  |
| `2026_0608_152000` | accepted | 692 | 0.670 | 0.814 | 8 | [crop](adjusted-crops/2026_0608_152000.jpg) |
| `2026_0626_075000` | accepted | 692 | 0.655 | 0.806 | 8 | [crop](adjusted-crops/2026_0626_075000.jpg) |
| `2026_0707_112000` | accepted | 692 | 0.721 | 0.843 | 8 | [crop](adjusted-crops/2026_0707_112000.jpg) |
| `2026_0714_002000` | rejected |  | 0.477 | 0.000 | 8 |  |
| `2026_0722_202000` | accepted | 692 | 0.517 | 0.728 | 8 | [crop](adjusted-crops/2026_0722_202000.jpg) |
| `2026_0809_125000` | accepted | 692 | 0.759 | 0.865 | 8 | [crop](adjusted-crops/2026_0809_125000.jpg) |
| `2026_0818_090000` | rejected |  | 0.304 | 0.000 | 8 |  |
