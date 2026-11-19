#!/bin/sh
# Monta o laboratorio de modelos numa pasta, com a ROM ao lado.
# Uso: tools/model-lab/build.sh <pasta> <rom.gba>
# Depois: python3 -m http.server 8090 --directory <pasta>
set -e
OUT="${1:-lab-site}"
ROM="$2"
mkdir -p "$OUT"
if command -v esbuild >/dev/null 2>&1; then ESBUILD=esbuild; else ESBUILD="npx esbuild"; fi
$ESBUILD tools/model-lab/lab.ts --bundle --format=esm --target=es2022 --outfile="$OUT/lab.js" --log-level=warning
cp tools/model-lab/lab.html "$OUT/lab.html"
if [ -n "$ROM" ]; then cp "$ROM" "$OUT/rom.gba"; fi
echo "laboratorio em $OUT"
