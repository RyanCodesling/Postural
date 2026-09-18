"""Generate high-resolution composite contact sheets and reference comparison for the ex_001 écorché proof."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def create_contact_sheet() -> None:
    root = Path(__file__).resolve().parents[2]
    previews_dir = root / "assets" / "blender" / "previews" / "ex_001_ecorche"

    views = ["front", "lateral", "axillary", "rear"]
    poses = [("rest", "Rest (10.4°)"), ("mid_45", "Mid Elevation (45.0°)"), ("peak_90", "Peak Elevation (90.3°)")]

    # 4 columns (views) x 3 rows (poses)
    cell_w, cell_h = 480, 360
    grid_w = cell_w * len(views)
    grid_h = cell_h * len(poses) + 80  # header space

    sheet = Image.new("RGB", (grid_w, grid_h), color=(20, 24, 28))
    draw = ImageDraw.Draw(sheet)

    # Title header
    title_text = "Postural ex_001 Upper-Body Shoulder Écorché — Neutral-Clay Proof Matrix (OpenSim + PSD)"
    draw.text((24, 24), title_text, fill=(240, 244, 248))

    for row_idx, (pose_key, pose_label) in enumerate(poses):
        y_offset = 80 + row_idx * cell_h
        for col_idx, view_key in enumerate(views):
            x_offset = col_idx * cell_w
            img_path = previews_dir / f"proof_{view_key}_{pose_key}.png"
            if img_path.is_file():
                with Image.open(img_path) as img:
                    resized = img.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
                    sheet.paste(resized, (x_offset, y_offset))

            # Label
            label = f"{view_key.upper()} — {pose_label}"
            draw.rectangle([x_offset + 8, y_offset + 8, x_offset + len(label) * 8 + 16, y_offset + 28], fill=(0, 0, 0, 180))
            draw.text((x_offset + 12, y_offset + 12), label, fill=(255, 220, 140))

    contact_path = previews_dir / "proof_contact_sheet.png"
    sheet.save(contact_path, "PNG")
    print(f"Generated proof contact sheet: {contact_path}")


def create_cutaway_comparison_sheet() -> None:
    root = Path(__file__).resolve().parents[2]
    previews_dir = root / "assets" / "blender" / "previews" / "ex_001_ecorche"

    # Comparison: Superficial vs Rotator Cuff Cutaway at Peak
    views = ["front", "lateral", "rear"]
    cell_w, cell_h = 480, 360
    sheet_w = cell_w * len(views)
    sheet_h = cell_h * 2 + 80

    sheet = Image.new("RGB", (sheet_w, sheet_h), color=(20, 24, 28))
    draw = ImageDraw.Draw(sheet)

    title = "ex_001 Shoulder Écorché — Superficial Layer vs Rotator Cuff Cutaway (Peak 90° Abduction)"
    draw.text((24, 24), title, fill=(240, 244, 248))

    # Row 1: Superficial Peak
    for col_idx, view_key in enumerate(views):
        x_offset = col_idx * cell_w
        y_offset = 80
        img_path = previews_dir / f"proof_{view_key}_peak_90.png"
        if img_path.is_file():
            with Image.open(img_path) as img:
                sheet.paste(img.resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x_offset, y_offset))
        label = f"SUPERFICIAL — {view_key.upper()} 90°"
        draw.rectangle([x_offset + 8, y_offset + 8, x_offset + len(label) * 8 + 16, y_offset + 28], fill=(0, 0, 0, 180))
        draw.text((x_offset + 12, y_offset + 12), label, fill=(140, 220, 255))

    # Row 2: Rotator Cuff Cutaway Peak
    for col_idx, view_key in enumerate(views):
        x_offset = col_idx * cell_w
        y_offset = 80 + cell_h
        img_path = previews_dir / f"proof_rotator_cuff_cutaway_{view_key}_peak.png"
        if img_path.is_file():
            with Image.open(img_path) as img:
                sheet.paste(img.resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x_offset, y_offset))
        label = f"ROTATOR CUFF CUTAWAY — {view_key.upper()} 90°"
        draw.rectangle([x_offset + 8, y_offset + 8, x_offset + len(label) * 8 + 16, y_offset + 28], fill=(0, 0, 0, 180))
        draw.text((x_offset + 12, y_offset + 12), label, fill=(255, 180, 120))

    cutaway_path = previews_dir / "proof_rotator_cuff_cutaway_sheet.png"
    sheet.save(cutaway_path, "PNG")
    print(f"Generated cutaway comparison sheet: {cutaway_path}")


if __name__ == "__main__":
    create_contact_sheet()
    create_cutaway_comparison_sheet()
