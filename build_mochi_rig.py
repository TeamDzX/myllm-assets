#!/usr/bin/env python3
"""Build Mochi's walk rig: a sprite sheet plus a per-frame head track.

THE PROBLEM. Mochi's accessories are overlay PNGs parented to the walker box
(the right call — baking them into the art would mean re-rendering every loop
for all 72 slot combinations). But the walk loop is generative video, and
Mochi's head travels ~32px horizontally and ~20px vertically inside the 400px
sprite as she waddles. A rigidly-parented hat cannot follow that, so it reads as
floating beside her head rather than sitting on it.

THE FIX. Measure where the head is in every frame, ship that as a track, and let
each accessory ride it. One track fixes all ten accessories and every
combination of them.

WHY A SPRITE SHEET. An animated WebP's playhead cannot be read from JavaScript.
There is no way to ask which frame is on screen, and an accessory one frame out
of phase is precisely the artefact being fixed. Driving our own sheet off our
own clock is frame-exact by construction. It is also smaller here (491 KB vs
771 KB) because the loop is a perfect palindrome — 33 of the 64 frames are
unique and the player ping-pongs the rest.

WHAT WAS TRIED AND REJECTED for measuring the head:
  - crown (topmost point): jumps between the two ears, 80px of phantom swing
  - ear-tip detection: latches onto arms and feet as the silhouette wobbles;
    derived scale swung 0.34-2.7, unusable
  - measured rotation from either of the above: same noise, ±40°
  - scale from head width: real, but only ±2% — not worth carrying
The head-region centroid is the one stable signal. Rotation is derived from
horizontal displacement instead of measured: a waddler leans into its sway, so
tying lean to dx gives smooth motion that is in phase for free.

Usage:  python3 build_mochi_rig.py [--apply]
        (dry run prints the numbers; --apply writes the sheet and the track)
"""
from PIL import Image, ImageSequence
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
MOCHI = os.path.join(ROOT, "apps", "mochi")
SRC = os.path.join(MOCHI, "anim_walk_t.webp")     # alpha-keyed walker
SHEET = os.path.join(MOCHI, "walk_sheet.webp")

CELL, COLS = 400, 6
HEAD_FRAC = 0.30      # top 30% of the body: high enough to miss the swinging arms
SMOOTH = 2            # 3-tap passes; the centroid still breathes a pixel or two
LEAN_PER_PX = 0.42    # degrees of lean per pixel of horizontal head travel
MIN_RUN = 12          # ignore alpha runs narrower than this — keying specks


def _runs(line):
    out, cur, start = [], 0, 0
    for i, v in enumerate(line + [0]):
        if v:
            if cur == 0:
                start = i
            cur += 1
        else:
            if cur:
                out.append((cur, start, i - 1))
            cur = 0
    return out


def _mask(frame):
    px = frame.split()[3].load()
    w, h = frame.size
    return [[r for r in _runs([1 if px[x, y] > 96 else 0 for x in range(w)])
             if r[0] >= MIN_RUN] for y in range(h)], w, h


def head_centre(frame):
    """Alpha centroid of the top HEAD_FRAC of the body."""
    m, w, h = _mask(frame)
    ys = [y for y in range(h) if m[y]]
    top, bot = ys[0], ys[-1]
    cut = int(top + HEAD_FRAC * (bot - top))
    sx = sy = n = 0
    for y in range(top, cut + 1):
        for ln, s, e in m[y]:
            sx += (s + e) / 2.0 * ln
            sy += y * ln
            n += ln
    return sx / n, sy / n


def pingpong(i, n):
    """Index into the unique frames for played frame i of a 2(n-1) loop."""
    j = i % (2 * (n - 1))
    return j if j < n else 2 * (n - 1) - j


def main():
    apply_ = "--apply" in sys.argv
    im = Image.open(SRC)
    frames = [f.convert("RGBA").copy() for f in ImageSequence.Iterator(im)]

    # The palindrome is an assumption worth checking rather than trusting: if a
    # future re-roll of the loop isn't one, the sheet would silently drop half
    # the animation.
    #
    # Check ALPHA exactly and RGB with a tolerance, because that is the shape of
    # the truth here: the loop was produced with pingpong=true, so the mirrored
    # frames are the same source image, but animated WebP encodes frames as
    # deltas and the two copies decode with different accumulated error. Measured
    # on the current loop: alpha bit-identical, RGB max 49/255 with only 0.09% of
    # visible pixels above 32 — invisible. Comparing raw bytes would fail on
    # noise; comparing with getbbox() would pass on anything (it only tests
    # alpha, which is exactly the trap this replaced).
    n_all = len(frames)
    half = n_all // 2
    for k in range(1, half):
        a, b = frames[k], frames[n_all - k]
        if a.split()[3].tobytes() != b.split()[3].tobytes():
            sys.exit(f"ERROR: frame {k} silhouette != frame {n_all-k} — not a palindrome. "
                     f"Ship all {n_all} frames, or re-roll the loop.")
        pa, pb = a.load(), b.load()
        bad = sum(1 for y in range(0, CELL, 4) for x in range(0, CELL, 4)
                  if (pa[x, y][3] > 8 or pb[x, y][3] > 8)
                  and max(abs(pa[x, y][i] - pb[x, y][i]) for i in range(3)) > 64)
        if bad > 40:
            sys.exit(f"ERROR: frame {k} colour differs from frame {n_all-k} in {bad} sampled "
                     f"pixels — that is real motion, not encode noise. Ship all {n_all} frames.")
    uniq = frames[:half + 1]
    rows = -(-len(uniq) // COLS)

    heads = [head_centre(f) for f in uniq]
    n = len(heads)
    pts = heads
    for _ in range(SMOOTH):
        src = pts
        pts = [tuple((src[pingpong(i - 1, n)][d] + src[i][d] + src[pingpong(i + 1, n)][d]) / 3.0
                     for d in (0, 1)) for i in range(n)]

    # Reference pose is the MEAN, not frame 0: the accessory art was eyeballed
    # against the loop as a whole, so centring here keeps every existing PNG
    # correct and spreads any residual error evenly instead of to one side.
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    track = [[round(p[0] - mx, 1), round(p[1] - my, 1), round((p[0] - mx) * LEAN_PER_PX, 2)]
             for p in pts]

    xs = [t[0] for t in track]
    ys = [t[1] for t in track]
    print(f"frames: {n_all} played, {n} unique (palindrome verified)")
    print(f"pivot:  ({mx:.1f}, {my:.1f}) px = ({mx/CELL*100:.1f}%, {my/CELL*100:.1f}%) of the sprite")
    print(f"dx:     {min(xs):+.1f}..{max(xs):+.1f} px   dy: {min(ys):+.1f}..{max(ys):+.1f} px")
    print(f"lean:   {min(t[2] for t in track):+.2f}..{max(t[2] for t in track):+.2f}°")

    if not apply_:
        print("\nDry run — pass --apply to write the sheet and track.")
        return

    sheet = Image.new("RGBA", (CELL * COLS, CELL * rows), (0, 0, 0, 0))
    for i, f in enumerate(uniq):
        sheet.paste(f, ((i % COLS) * CELL, (i // COLS) * CELL))
    sheet.save(SHEET, "WEBP", quality=86, method=6, exact=True)

    print(f"\nwrote {os.path.relpath(SHEET, ROOT)}  {sheet.size[0]}x{sheet.size[1]}  "
          f"{os.path.getsize(SHEET)//1024} KB (source loop {os.path.getsize(SRC)//1024} KB)")
    print("\nPaste into mochi.html (RIG_PIVOT / RIG_TRACK):")
    print(f"var RIG_PIVOT = [{mx:.1f}, {my:.1f}];")
    rows_out = ",\n  ".join(
        ",".join(f"[{t[0]},{t[1]},{t[2]}]" for t in track[i:i + 4])
        for i in range(0, len(track), 4))
    print("var RIG_TRACK = [\n  " + rows_out + "\n];")


if __name__ == "__main__":
    main()
