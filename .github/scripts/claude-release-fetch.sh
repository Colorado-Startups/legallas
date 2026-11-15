#!/usr/bin/env bash
# Downloads one Claude Code release binary and checks it twice: the release manifest's GPG signature against
# Anthropic's release key, pinned here by fingerprint, then the binary's SHA-256 against that signed manifest.
# Key, file names and fingerprint: code.claude.com/docs/en/setup, "Binary integrity and code signing" (read
# 2026-11-05; signatures from 2.1.89 on). Tests: claude-release-fetch-test.sh.
# Usage: claude-release-fetch.sh <version> <platform> <out-file>
set -euo pipefail

version="$1"
platform="$2"
out="$3"
base="${CLAUDE_RELEASE_BASE:-https://downloads.claude.ai}"
fpr="${CLAUDE_RELEASE_KEY_FPR:-31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE}"
release="$base/claude-code-releases/$version"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "::error::Claude Code $version ($platform): $*" >&2; exit 1; }
fetch() { curl -fsSL --retry 3 -o "$2" "$1" || fail "could not download $1"; }

fetch "$release/manifest.json" "$work/manifest.json"
fetch "$release/manifest.json.sig" "$work/manifest.json.sig"
fetch "$base/keys/claude-code.asc" "$work/key.asc"

# A fresh keyring holding only the downloaded key; the signature counts only if it is the pinned one.
export GNUPGHOME="$work/gnupg"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --import "$work/key.asc" 2>/dev/null || fail "the release key at $base/keys/claude-code.asc would not import"
gpg --batch --status-fd 1 --verify "$work/manifest.json.sig" "$work/manifest.json" >"$work/status" 2>/dev/null || true
awk -v fpr="$fpr" '$2 == "VALIDSIG" && ($3 == fpr || $NF == fpr) { ok = 1 } END { exit !ok }' "$work/status" \
  || fail "manifest.json has no valid signature from release key $fpr"

checksum="$(jq -r --arg p "$platform" '.platforms[$p].checksum // empty' "$work/manifest.json")"
if [ -z "$checksum" ]; then
  fail "its manifest has no $platform entry; it lists: $(jq -r '.platforms // {} | keys | join(", ")' "$work/manifest.json")"
fi
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]] || fail "the $platform checksum in its manifest is not a SHA-256: $checksum"

fetch "$release/$platform/claude" "$out"
echo "$checksum  $out" | sha256sum -c --quiet - >/dev/null 2>&1 || { rm -f "$out"; fail "the binary does not match its signed checksum"; }
echo "Claude Code $version ($platform): signature by $fpr and checksum verified"
