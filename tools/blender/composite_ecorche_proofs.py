"""Generate composite proof sheets, motion sequence matrix, and structural comparison for the ex_001 shoulder écorché."""

from pathlib import Path
from PIL import Image, ImageDraw


def create_contact_sheet(previews_dir: Path) -> None:
    views = ["front", "lateral", "axillary", "rear"]
    poses = [("rest", "Rest (10.4°)"), ("mid_45", "Mid Elevation (45.0°)"), ("peak_90", "Peak Elevation (90.3°)")]

    cell_w, cell_h = 480, 360
    grid_w = cell_w * len(views)
    grid_h = cell_h * len(poses) + 80

    sheet = Image.new("RGB", (grid_w, grid_h), color=(20, 24, 28))
    draw = ImageDraw.Draw(sheet)

    title = "Postural ex_001 Upper-Body Shoulder Écorché — Neutral-Clay Proof Matrix (OpenSim + PSD)"
    draw.text((24, 24), title, fill=(240, 244, 248))

    for row_idx, (pose_key, pose_label) in enumerate(poses):
        y_offset = 80 + row_idx * cell_h
        for col_idx, view_key in enumerate(views):
            x_offset = col_idx * cell_w
            img_path = previews_dir / f"proof_{view_key}_{pose_key}.png"
            if img_path.is_file():
                with Image.open(img_path) as img:
                    sheet.paste(img.resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x_offset, y_offset))

            label = f"{view_key.upper()} — {pose_label}"
            draw.rectangle([x_offset + 8, y_offset + 8, x_offset + len(label) * 8 + 16, y_offset + 28], fill=(0, 0, 0, 180))
            draw.text((x_offset + 12, y_offset + 12), label, fill=(255, 220, 140))

    contact_path = previews_dir / "proof_contact_sheet.png"
    sheet.save(contact_path, "PNG")
    print(f"Generated proof contact sheet: {contact_path}")


def create_cutaway_comparison_sheet(previews_dir: Path) -> None:
    views = ["front", "lateral", "rear"]
    cell_w, cell_h = 480, 360
    sheet_w = cell_w * len(views)
    sheet_h = cell_h * 2 + 80

    sheet = Image.new("RGB", (sheet_w, sheet_h), color=(20, 24, 28))
    draw = ImageDraw.Draw(sheet)

    title = "ex_001 Shoulder Écorché — Superficial Layer vs Rotator Cuff Cutaway (Peak 90° Abduction)"
    draw.text((24, 24), title, fill=(240, 244, 248))

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


def build_motion_sheet(previews_dir: Path) -> None:
    cols, rows = 4, 4
    cell_w, cell_h = 480, 360
    grid_w = cell_w * cols
    grid_h = cell_h * rows + 80

    sheet = Image.new("RGB", (grid_w, grid_h), color=(20, 24, 28))
    draw = ImageDraw.Draw(sheet)

    title = "ex_001 Shoulder Écorché — 16-Sample Motion Progression (210 Frames, 7.0s Reversible Abduction)"
    draw.text((24, 24), title, fill=(240, 244, 248))

    frame_numbers = [1, 15, 30, 45, 60, 75, 90, 108, 120, 135, 150, 165, 180, 195, 205, 210]
    phase_names = [
        "Rest (0.0s)", "Rest (0.5s)", "Raise (1.0s)", "Raise (1.5s)",
        "Mid 45° (2.0s)", "Raise (2.5s)", "Peak Approach (3.0s)", "Peak Hold 90° (3.6s)",
        "Peak Hold (4.0s)", "Lowering (4.5s)", "Lowering (5.0s)", "Lowering (5.5s)",
        "Lowering (6.0s)", "Settle (6.5s)", "Settle (6.8s)", "Rest Loop (7.0s)"
    ]

    for idx, (frame, phase) in enumerate(zip(frame_numbers, phase_names, strict=False)):
        c = idx % cols
        r = idx // cols
        x = c * cell_w
        y = 80 + r * cell_h
        img_path = previews_dir / f"motion_frame_{frame:04d}.png"
        if img_path.is_file():
            with Image.open(img_path) as img:
                sheet.paste(img.resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x, y))

        label = f"F{frame:03d} — {phase}"
        draw.rectangle([x + 8, y + 8, x + len(label) * 8 + 16, y + 28], fill=(0, 0, 0, 180))
        draw.text((x + 12, y + 12), label, fill=(160, 240, 180))

    motion_sheet_path = previews_dir / "proof_motion_contact_sheet.png"
    sheet.save(motion_sheet_path, "PNG")
    print(f"Generated motion contact sheet: {motion_sheet_path}")


def build_structural_comparison(previews_dir: Path) -> None:
    cell_w, cell_h = 640, 480
    sheet = Image.new("RGB", (cell_w * 3, cell_h + 80), color=(20, 24, 28))
    draw = ImageDraw.Draw(sheet)

    title = "ex_001 Shoulder Écorché — Structural Layering & Registration Comparison (Peak 90° Abduction)"
    draw.text((24, 24), title, fill=(240, 244, 248))

    items = [
        ("proof_front_peak_90.png", "1. SUPERFICIAL ÉCORCHÉ (PSD BUNDLES)"),
        ("proof_qa_bone_overlay_peak.png", "2. QA SKELETON & ANCHOR OVERLAY"),
        ("proof_rotator_cuff_cutaway_front_peak.png", "3. ROTATOR CUFF CUTAWAY LAYER"),
    ]

    for idx, (filename, label) in enumerate(items):
        img_path = previews_dir / filename
        x = idx * cell_w
        y = 80
        if img_path.is_file():
            with Image.open(img_path) as img:
                sheet.paste(img.resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x, y))
        draw.rectangle([x + 12, y + 12, x + len(label) * 9 + 20, y + 36], fill=(0, 0, 0, 190))
        draw.text((x + 16, y + 16), label, fill=(255, 230, 140))

    comp_path = previews_dir / "proof_structural_comparison_sheet.png"
    sheet.save(comp_path, "PNG")
    print(f"Generated structural comparison sheet: {comp_path}")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    previews = root / "assets" / "blender" / "previews" / "ex_001_ecorche"

    create_contact_sheet(previews)
    create_cutaway_comparison_sheet(previews)
    build_motion_sheet(previews)
    build_structural_comparison(previews)
