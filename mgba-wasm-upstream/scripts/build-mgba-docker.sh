#!/usr/bin/env bash
set -euo pipefail

# Local wrapper: run the mGBA WASM build inside Docker (emscripten/emsdk).

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_SCRIPT="/workspace/scripts/build-mgba.sh"

echo "Building mGBA WASM via Docker..."
docker run --rm \
    -v "$PROJECT_DIR:/workspace" \
    -w /workspace \
    emscripten/emsdk:latest \
    bash -c "
      set -euo pipefail
      apt-get update -qq && apt-get install -y cmake git -qq
      bash $BUILD_SCRIPT
    "
