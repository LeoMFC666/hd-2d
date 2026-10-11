#!/bin/sh
# Monta um site estatico do app com esbuild (sem Vite) para testes num
# navegador headless. Uso: tools/build-test-site.sh <pasta-de-saida>
set -e
OUT="${1:-test-site}"
mkdir -p "$OUT"
# esbuild do PATH quando houver (ambientes sem acesso ao registro npm).
if command -v esbuild >/dev/null 2>&1; then ESBUILD=esbuild; else ESBUILD="npx esbuild"; fi
$ESBUILD src/main.ts --bundle --format=esm --target=es2022 \
  --outfile="$OUT/app.js" \
  --alias:@wasm-gaming/mgba-wasm=./node_modules/@wasm-gaming/mgba-wasm/dist/mgba/mgba.sdk.js
cp -r public/mgba "$OUT/mgba"
cp styles.css "$OUT/"
sed 's#<script type="module" src="/src/main.ts"></script>#<script type="module" src="/app.js"></script>#' index.html > "$OUT/index.html"
echo "site em $OUT - sirva com: python3 -m http.server 8080 --directory $OUT"
