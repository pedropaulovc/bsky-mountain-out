# Panocam panorama alignment report

Generated: `2026-08-19T01:26:57.202Z`
Sample manifest: `reports/panorama-alignment-2026-08-18/sample-input.json`
Reference: `assets/panocam-alignment-reference.jpg`
Reference source frame: `2025_0325_130000` (clear, Rainier visible).

## Summary

- Sampled timestamps: **100** (evenly spaced among available daily candidates from 2023-08-18 through 2026-08-18).
- Accepted alignments: **95**
- Rejected alignments: **5**
- Processing errors: **0**
- Applied source shift range: **-3334..870 px**; median **692 px**.
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
| `2023_0818_120000` | accepted | 677 | 0.687 | 0.824 | 8 | [crop](adjusted-crops/2023_0818_120000.jpg) |
| `2023_0828_120000` | accepted | 677 | 0.637 | 0.796 | 8 | [crop](adjusted-crops/2023_0828_120000.jpg) |
| `2023_0907_120000` | accepted | 677 | 0.630 | 0.792 | 8 | [crop](adjusted-crops/2023_0907_120000.jpg) |
| `2023_0918_120000` | accepted | 677 | 0.645 | 0.800 | 8 | [crop](adjusted-crops/2023_0918_120000.jpg) |
| `2023_0928_120000` | accepted | 693 | 0.686 | 0.823 | 8 | [crop](adjusted-crops/2023_0928_120000.jpg) |
| `2023_1008_120000` | accepted | 677 | 0.645 | 0.800 | 8 | [crop](adjusted-crops/2023_1008_120000.jpg) |
| `2023_1018_120000` | accepted | 677 | 0.678 | 0.819 | 8 | [crop](adjusted-crops/2023_1018_120000.jpg) |
| `2023_1029_120000` | accepted | 677 | 0.652 | 0.804 | 8 | [crop](adjusted-crops/2023_1029_120000.jpg) |
| `2023_1108_120000` | accepted | 676 | 0.692 | 0.827 | 8 | [crop](adjusted-crops/2023_1108_120000.jpg) |
| `2023_1118_120000` | accepted | 676 | 0.645 | 0.800 | 8 | [crop](adjusted-crops/2023_1118_120000.jpg) |
| `2023_1128_120000` | accepted | 676 | 0.619 | 0.767 | 8 | [crop](adjusted-crops/2023_1128_120000.jpg) |
| `2023_1209_120000` | accepted | 676 | 0.627 | 0.772 | 8 | [crop](adjusted-crops/2023_1209_120000.jpg) |
| `2023_1219_120000` | accepted | 676 | 0.631 | 0.793 | 8 | [crop](adjusted-crops/2023_1219_120000.jpg) |
| `2023_1229_120000` | accepted | 821 | 0.560 | 0.753 | 8 | [crop](adjusted-crops/2023_1229_120000.jpg) |
| `2024_0108_120000` | accepted | 773 | 0.625 | 0.764 | 7 | [crop](adjusted-crops/2024_0108_120000.jpg) |
| `2024_0119_120000` | accepted | 693 | 0.585 | 0.767 | 8 | [crop](adjusted-crops/2024_0119_120000.jpg) |
| `2024_0129_120000` | accepted | 821 | 0.635 | 0.795 | 8 | [crop](adjusted-crops/2024_0129_120000.jpg) |
| `2024_0208_120000` | accepted | 789 | 0.578 | 0.762 | 8 | [crop](adjusted-crops/2024_0208_120000.jpg) |
| `2024_0218_120000` | accepted | 805 | 0.687 | 0.824 | 8 | [crop](adjusted-crops/2024_0218_120000.jpg) |
| `2024_0229_120000` | accepted | 693 | 0.634 | 0.775 | 8 | [crop](adjusted-crops/2024_0229_120000.jpg) |
| `2024_0310_000000` | accepted | 693 | 0.510 | 0.724 | 8 | [crop](adjusted-crops/2024_0310_000000.jpg) |
| `2024_0402_120000` | accepted | 709 | 0.767 | 0.850 | 8 | [crop](adjusted-crops/2024_0402_120000.jpg) |
| `2024_0412_120000` | accepted | 693 | 0.674 | 0.816 | 8 | [crop](adjusted-crops/2024_0412_120000.jpg) |
| `2024_0423_120000` | accepted | 821 | 0.708 | 0.817 | 8 | [crop](adjusted-crops/2024_0423_120000.jpg) |
| `2024_0503_120000` | accepted | 870 | 0.721 | 0.843 | 8 | [crop](adjusted-crops/2024_0503_120000.jpg) |
| `2024_0516_060000` | accepted | 837 | 0.423 | 0.632 | 7 | [crop](adjusted-crops/2024_0516_060000.jpg) |
| `2024_0529_120000` | accepted | 773 | 0.553 | 0.692 | 8 | [crop](adjusted-crops/2024_0529_120000.jpg) |
| `2024_0612_120000` | accepted | 837 | 0.719 | 0.823 | 8 | [crop](adjusted-crops/2024_0612_120000.jpg) |
| `2024_0628_120000` | accepted | 870 | 0.666 | 0.812 | 8 | [crop](adjusted-crops/2024_0628_120000.jpg) |
| `2024_0708_120000` | accepted | 628 | 0.730 | 0.848 | 8 | [crop](adjusted-crops/2024_0708_120000.jpg) |
| `2024_0718_120000` | accepted | 870 | 0.733 | 0.850 | 8 | [crop](adjusted-crops/2024_0718_120000.jpg) |
| `2024_0801_120000` | accepted | 870 | 0.751 | 0.860 | 8 | [crop](adjusted-crops/2024_0801_120000.jpg) |
| `2024_0811_120000` | accepted | 693 | 0.634 | 0.750 | 7 | [crop](adjusted-crops/2024_0811_120000.jpg) |
| `2024_0821_120000` | accepted | -1369 | 0.526 | 0.683 | 6 | [crop](adjusted-crops/2024_0821_120000.jpg) |
| `2024_0904_120000` | accepted | 854 | 0.753 | 0.861 | 8 | [crop](adjusted-crops/2024_0904_120000.jpg) |
| `2024_0914_120000` | accepted | 676 | 0.645 | 0.800 | 8 | [crop](adjusted-crops/2024_0914_120000.jpg) |
| `2024_0925_120000` | accepted | 757 | 0.671 | 0.815 | 8 | [crop](adjusted-crops/2024_0925_120000.jpg) |
| `2024_1009_120000` | accepted | 693 | 0.696 | 0.829 | 8 | [crop](adjusted-crops/2024_1009_120000.jpg) |
| `2024_1019_120000` | rejected |  | 0.204 | 0.000 | 6 |  |
| `2024_1029_120000` | accepted | 854 | 0.527 | 0.715 | 8 | [crop](adjusted-crops/2024_1029_120000.jpg) |
| `2024_1109_120000` | accepted | 837 | 0.679 | 0.819 | 8 | [crop](adjusted-crops/2024_1109_120000.jpg) |
| `2024_1119_120000` | accepted | 837 | 0.662 | 0.810 | 8 | [crop](adjusted-crops/2024_1119_120000.jpg) |
| `2024_1130_120000` | accepted | 709 | 0.641 | 0.798 | 8 | [crop](adjusted-crops/2024_1130_120000.jpg) |
| `2024_1210_120000` | accepted | 854 | 0.643 | 0.799 | 8 | [crop](adjusted-crops/2024_1210_120000.jpg) |
| `2024_1221_120000` | accepted | 676 | 0.642 | 0.799 | 8 | [crop](adjusted-crops/2024_1221_120000.jpg) |
| `2024_1231_120000` | accepted | 837 | 0.660 | 0.809 | 8 | [crop](adjusted-crops/2024_1231_120000.jpg) |
| `2025_0110_120000` | accepted | 741 | 0.493 | 0.671 | 7 | [crop](adjusted-crops/2025_0110_120000.jpg) |
| `2025_0120_060000` | rejected |  | 0.475 | 0.000 | 8 |  |
| `2025_0202_120000` | accepted | -32 | 0.507 | 0.723 | 8 | [crop](adjusted-crops/2025_0202_120000.jpg) |
| `2025_0212_120000` | accepted | 451 | 0.745 | 0.857 | 8 | [crop](adjusted-crops/2025_0212_120000.jpg) |
| `2025_0222_120000` | accepted | 660 | 0.581 | 0.746 | 8 | [crop](adjusted-crops/2025_0222_120000.jpg) |
| `2025_0304_120000` | accepted | 709 | 0.630 | 0.767 | 7 | [crop](adjusted-crops/2025_0304_120000.jpg) |
| `2025_0315_120000` | accepted | -3334 | 0.559 | 0.752 | 8 | [crop](adjusted-crops/2025_0315_120000.jpg) |
| `2025_0325_120000` | accepted | 16 | 0.796 | 0.885 | 8 | [crop](adjusted-crops/2025_0325_120000.jpg) |
| `2025_0405_120000` | accepted | -966 | 0.770 | 0.871 | 8 | [crop](adjusted-crops/2025_0405_120000.jpg) |
| `2025_0415_120000` | accepted | -370 | 0.758 | 0.864 | 8 | [crop](adjusted-crops/2025_0415_120000.jpg) |
| `2025_0426_120000` | accepted | -612 | 0.666 | 0.812 | 8 | [crop](adjusted-crops/2025_0426_120000.jpg) |
| `2025_0507_120000` | accepted | 451 | 0.668 | 0.795 | 8 | [crop](adjusted-crops/2025_0507_120000.jpg) |
| `2025_0517_120000` | accepted | 854 | 0.581 | 0.764 | 8 | [crop](adjusted-crops/2025_0517_120000.jpg) |
| `2025_0527_120000` | accepted | 660 | 0.756 | 0.863 | 8 | [crop](adjusted-crops/2025_0527_120000.jpg) |
| `2025_0608_120000` | accepted | 660 | 0.722 | 0.844 | 8 | [crop](adjusted-crops/2025_0608_120000.jpg) |
| `2025_0623_120000` | accepted | -387 | 0.718 | 0.842 | 8 | [crop](adjusted-crops/2025_0623_120000.jpg) |
| `2025_0710_120000` | rejected |  | 0.446 | 0.000 | 6 |  |
| `2025_0727_120000` | accepted | 644 | 0.723 | 0.826 | 8 | [crop](adjusted-crops/2025_0727_120000.jpg) |
| `2025_0807_120000` | accepted | 644 | 0.685 | 0.785 | 8 | [crop](adjusted-crops/2025_0807_120000.jpg) |
| `2025_0817_120000` | accepted | -48 | 0.738 | 0.852 | 8 | [crop](adjusted-crops/2025_0817_120000.jpg) |
| `2025_0827_120000` | accepted | 708 | 0.696 | 0.829 | 8 | [crop](adjusted-crops/2025_0827_120000.jpg) |
| `2025_0906_000000` | accepted | 692 | 0.508 | 0.705 | 8 | [crop](adjusted-crops/2025_0906_000000.jpg) |
| `2025_0918_120000` | accepted | 708 | 0.732 | 0.849 | 8 | [crop](adjusted-crops/2025_0918_120000.jpg) |
| `2025_0929_180000` | accepted | 708 | 0.554 | 0.749 | 8 | [crop](adjusted-crops/2025_0929_180000.jpg) |
| `2025_1009_120000` | accepted | 708 | 0.645 | 0.782 | 8 | [crop](adjusted-crops/2025_1009_120000.jpg) |
| `2025_1019_120000` | accepted | 708 | 0.658 | 0.789 | 8 | [crop](adjusted-crops/2025_1019_120000.jpg) |
| `2025_1031_120000` | accepted | 692 | 0.661 | 0.790 | 8 | [crop](adjusted-crops/2025_1031_120000.jpg) |
| `2025_1111_120000` | accepted | 692 | 0.670 | 0.796 | 8 | [crop](adjusted-crops/2025_1111_120000.jpg) |
| `2025_1122_120000` | accepted | 692 | 0.642 | 0.799 | 8 | [crop](adjusted-crops/2025_1122_120000.jpg) |
| `2025_1206_120000` | accepted | 725 | 0.644 | 0.781 | 8 | [crop](adjusted-crops/2025_1206_120000.jpg) |
| `2025_1216_120000` | accepted | 692 | 0.640 | 0.797 | 8 | [crop](adjusted-crops/2025_1216_120000.jpg) |
| `2025_1228_120000` | accepted | 692 | 0.667 | 0.813 | 8 | [crop](adjusted-crops/2025_1228_120000.jpg) |
| `2026_0107_120000` | accepted | 692 | 0.670 | 0.815 | 8 | [crop](adjusted-crops/2026_0107_120000.jpg) |
| `2026_0117_120000` | accepted | 692 | 0.659 | 0.771 | 8 | [crop](adjusted-crops/2026_0117_120000.jpg) |
| `2026_0127_120000` | accepted | 692 | 0.699 | 0.831 | 8 | [crop](adjusted-crops/2026_0127_120000.jpg) |
| `2026_0207_120000` | accepted | 692 | 0.632 | 0.793 | 8 | [crop](adjusted-crops/2026_0207_120000.jpg) |
| `2026_0217_120000` | accepted | 692 | 0.558 | 0.726 | 7 | [crop](adjusted-crops/2026_0217_120000.jpg) |
| `2026_0303_120000` | accepted | 692 | 0.670 | 0.815 | 8 | [crop](adjusted-crops/2026_0303_120000.jpg) |
| `2026_0313_120000` | rejected |  | 0.292 | 0.000 | 7 |  |
| `2026_0324_120000` | accepted | 692 | 0.671 | 0.815 | 8 | [crop](adjusted-crops/2026_0324_120000.jpg) |
| `2026_0403_120000` | accepted | 692 | 0.739 | 0.853 | 8 | [crop](adjusted-crops/2026_0403_120000.jpg) |
| `2026_0413_120000` | accepted | 692 | 0.656 | 0.807 | 8 | [crop](adjusted-crops/2026_0413_120000.jpg) |
| `2026_0423_120000` | accepted | 692 | 0.694 | 0.828 | 8 | [crop](adjusted-crops/2026_0423_120000.jpg) |
| `2026_0504_120000` | accepted | 692 | 0.756 | 0.863 | 8 | [crop](adjusted-crops/2026_0504_120000.jpg) |
| `2026_0514_120000` | accepted | 0 | 0.745 | 0.857 | 8 | [crop](adjusted-crops/2026_0514_120000.jpg) |
| `2026_0524_120000` | rejected |  | 0.229 | 0.000 | 5 |  |
| `2026_0603_120000` | accepted | 692 | 0.712 | 0.838 | 8 | [crop](adjusted-crops/2026_0603_120000.jpg) |
| `2026_0614_120000` | accepted | 692 | 0.728 | 0.847 | 8 | [crop](adjusted-crops/2026_0614_120000.jpg) |
| `2026_0624_120000` | accepted | 692 | 0.692 | 0.827 | 8 | [crop](adjusted-crops/2026_0624_120000.jpg) |
| `2026_0708_120000` | accepted | 692 | 0.660 | 0.809 | 8 | [crop](adjusted-crops/2026_0708_120000.jpg) |
| `2026_0718_120000` | accepted | 692 | 0.741 | 0.854 | 8 | [crop](adjusted-crops/2026_0718_120000.jpg) |
| `2026_0729_120000` | accepted | 692 | 0.728 | 0.847 | 8 | [crop](adjusted-crops/2026_0729_120000.jpg) |
| `2026_0808_120000` | accepted | 692 | 0.717 | 0.841 | 8 | [crop](adjusted-crops/2026_0808_120000.jpg) |
| `2026_0818_120000` | accepted | 692 | 0.724 | 0.845 | 8 | [crop](adjusted-crops/2026_0818_120000.jpg) |
