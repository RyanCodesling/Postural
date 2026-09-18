"""Compose the ex_001 ecorche V2 Stage 1 renders into one review sheet."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


PANELS = (
    ("rest_front_oblique.png", "Front oblique - muscle-only primary"),
    ("rest_true_lateral.png", "True lateral - muscle-only primary"),
    ("rest_rear_oblique.png", "Rear oblique - muscle-only primary"),
    ("rest_inferior_axillary.png", "Inferior axillary - muscle-only primary"),
    ("rest_full_chain_front_oblique.png", "Full distal-chain overview"),
    ("qa_anchors_front_oblique.png", "QA - line skeleton and attachment markers"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "previews"
            / "ex_001_ecorche_v2"
            / "static_rest"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "previews"
            / "ex_001_ecorche_v2"
            / "static_rest_contact_sheet.png"
        ),
    )
    return parser.parse_args()


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    name = "arialbd.ttf" if bold else "arial.ttf"
    path = Path("C:/Windows/Fonts") / name
    try:
        return ImageFont.truetype(str(path), size=size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    args = parse_args()
    input_dir = args.input_dir.resolve()
    panels: list[tuple[Image.Image, str]] = []
    for filename, label in PANELS:
        path = input_dir / filename
        if not path.is_file():
            raise FileNotFoundError(path)
        image = Image.open(path).convert("RGB")
        if image.width < 400 or image.height < 400:
            raise RuntimeError(f"Render is unexpectedly small: {path} -> {image.size}")
        extrema = image.getextrema()
        if all(low == high for low, high in extrema):
            raise RuntimeError(f"Render is blank: {path}")
        panels.append((image, label))

    tile = 540
    label_height = 54
    margin = 24
    header = 126
    footer = 72
    columns = 3
    rows = 2
    width = margin * 2 + columns * tile + (columns - 1) * margin
    height = header + rows * (tile + label_height) + (rows - 1) * margin + footer
    canvas = Image.new("RGB", (width, height), (18, 23, 29))
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (margin, 18),
        "ex_001 shoulder ecorche V2 - Stage 1 static anatomy checkpoint",
        fill=(244, 246, 248),
        font=font(32, bold=True),
    )
    draw.text(
        (margin, 67),
        "New procedural surfaces | OpenSim paths constrain attachments only | rest 12.03391 degrees | no animation/GLB/web integration",
        fill=(175, 190, 204),
        font=font(20),
    )
    draw.text(
        (margin, 96),
        "Primary panels hide skeleton/anchors. QA markers: green origin, blue insertion, yellow connector. Engineering visualization; nonclinical.",
        fill=(229, 181, 87),
        font=font(18),
    )

    for index, (source, label) in enumerate(panels):
        row, column = divmod(index, columns)
        left = margin + column * (tile + margin)
        top = header + row * (tile + label_height + margin)
        resized = source.resize((tile, tile), Image.Resampling.LANCZOS)
        canvas.paste(resized, (left, top))
        draw.rectangle(
            (left, top + tile, left + tile, top + tile + label_height),
            fill=(28, 35, 43),
        )
        draw.text(
            (left + 14, top + tile + 15),
            label,
            fill=(239, 242, 245),
            font=font(18, bold=True),
        )

    draw.text(
        (margin, height - footer + 21),
        "Visual acceptance is deliberately separate from computed PASS. Motion authoring remains gated until this sheet is reviewed.",
        fill=(178, 191, 203),
        font=font(19),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output.resolve(), format="PNG", optimize=True)
    print(
        f"EX001_ECORCHE_V2_CONTACT_SHEET={args.output.resolve()} "
        f"size={canvas.width}x{canvas.height} panels={len(panels)}"
    )


if __name__ == "__main__":
    main()
