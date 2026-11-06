"""Render 16-sample motion progression and generate motion contact sheet and reference comparison."""

from pathlib import Path
import bpy
from mathutils import Vector
from PIL import Image, ImageDraw


def render_motion_samples(blend_path: Path, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    scene = bpy.context.scene
    camera = bpy.data.objects.get("EX001_Ecorche_Camera")
    if camera is None:
        raise RuntimeError("Camera EX001_Ecorche_Camera not found")

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 480
    scene.render.resolution_y = 360

    # Position camera for front-quarter 3/4 view of the unilateral raise
    camera.location = Vector((0.45, -2.4, 1.40))
    camera.data.lens = 55
    dir_vec = Vector((0.15, 0.0, 1.38)) - camera.location
    camera.rotation_euler = dir_vec.to_track_quat("-Z", "Y").to_euler()

    # 16 sampled frames across 210 frames (rest -> raise -> hold -> lower -> settle)
    frames = [1, 15, 30, 45, 60, 75, 90, 108, 120, 135, 150, 165, 180, 195, 205, 210]
    sample_paths = []

    for frame in frames:
        scene.frame_set(frame)
        filepath = out_dir / f"motion_frame_{frame:04d}.png"
        scene.render.filepath = str(filepath)
        bpy.ops.render.render(write_still=True)
        sample_paths.append(filepath)
        print(f"Rendered motion sample: {filepath}")

    return sample_paths


def build_motion_sheet(sample_paths: list[Path], out_dir: Path) -> None:
    # 4 columns x 4 rows
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

    for idx, (img_path, frame, phase) in enumerate(zip(sample_paths, frame_numbers, phase_names, strict=False)):
        c = idx % cols
        r = idx // cols
        x = c * cell_w
        y = 80 + r * cell_h
        if img_path.is_file():
            with Image.open(img_path) as img:
                sheet.paste(img.resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x, y))

        label = f"F{frame:03d} — {phase}"
        draw.rectangle([x + 8, y + 8, x + len(label) * 8 + 16, y + 28], fill=(0, 0, 0, 180))
        draw.text((x + 12, y + 12), label, fill=(160, 240, 180))

    motion_sheet_path = out_dir / "proof_motion_contact_sheet.png"
    sheet.save(motion_sheet_path, "PNG")
    print(f"Generated motion contact sheet: {motion_sheet_path}")


def build_side_by_side_comparison(previews_dir: Path) -> None:
    # Side-by-side comparison between:
    # 1. Écorché Front Peak (New PSD + Segmented Bundles)
    # 2. Écorché Bone Overlay Peak (Underlying Skeleton & Anchors)
    # 3. Rotator Cuff Cutaway Peak (Deep Layer Anatomy)
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
    blend = root / "assets" / "blender" / "ex_001_lateral_arm_raise_ecorche.blend"
    out = root / "assets" / "blender" / "previews" / "ex_001_ecorche"

    samples = render_motion_samples(blend, out)
    build_motion_sheet(samples, out)
    build_side_by_side_comparison(out)
