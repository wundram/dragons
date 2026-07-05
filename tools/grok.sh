#!/usr/bin/env bash
# Thin wrapper around the `grok` CLI for image generation and vision evaluation.
# Usage:
#   tools/grok.sh gen  "<description>" <out.png>
#   tools/grok.sh eval <image.png> ["<extra criteria>"]
#   tools/grok.sh ask  "<free-form prompt>"
set -euo pipefail

cmd="${1:-}"; shift || true

case "$cmd" in
  gen)
    desc="${1:?description required}"; out="${2:?output path required}"
    out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
    grok --always-approve -p "Generate an image: ${desc}. Save it as a PNG to ${out}. After saving, reply with the absolute path only."
    ;;
  eval)
    img="${1:?image path required}"; extra="${2:-}"
    img="$(cd "$(dirname "$img")" && pwd)/$(basename "$img")"
    grok --always-approve \
      --json-schema '{"type":"object","properties":{"geometry":{"type":"integer"},"style":{"type":"integer"},"expressiveness":{"type":"integer"},"appeal":{"type":"integer"},"defects":{"type":"array","items":{"type":"string"}},"top_fix":{"type":"string"}},"required":["geometry","style","expressiveness","appeal","defects","top_fix"]}' \
      -p "Analyze the image at ${img}. Score 1-10: geometry (no gaps/holes/inverted faces/bad corners), style (consistency), expressiveness, appeal. List concrete visual defects and the single most important fix. ${extra}"
    ;;
  ask)
    grok --always-approve -p "${1:?prompt required}"
    ;;
  *)
    echo "usage: $0 {gen <desc> <out.png> | eval <img.png> [extra] | ask <prompt>}" >&2
    exit 2
    ;;
esac
