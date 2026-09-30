#!/usr/bin/env python3
"""Separa vocais/instrumental com Demucs e imprime PROGRESS n / RESULT <arquivo>."""
import argparse, re, subprocess, sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--input", required=True)
ap.add_argument("--out-dir", required=True)
ap.add_argument("--model", default="htdemucs")
ap.add_argument("--device", default="cpu")
a = ap.parse_args()

cmd = [sys.executable, "-m", "demucs", "--two-stems", "vocals", "-n", a.model,
       "-d", a.device, "-o", a.out_dir, a.input]
p = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, bufsize=0)
last, tail = -1, b""
while True:
    chunk = p.stderr.read(256)
    if not chunk:
        break
    tail = (tail + chunk)[-2000:]
    m = re.findall(rb"(\d+)%", chunk)
    if m and int(m[-1]) != last:
        last = int(m[-1])
        print(f"PROGRESS {last}", flush=True)
if p.wait() != 0:
    print(tail.decode(errors="ignore")[-300:], file=sys.stderr)
    sys.exit(1)

stem = Path(a.out_dir) / a.model / Path(a.input).stem / "no_vocals.wav"
if not stem.exists():
    print("no_vocals.wav não encontrado", file=sys.stderr)
    sys.exit(2)
print(f"RESULT {stem}", flush=True)
