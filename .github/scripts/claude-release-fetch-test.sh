#!/usr/bin/env bash
# Tests for claude-release-fetch.sh. Each case builds a fake release folder signed by a throwaway key and serves it
# over file://, so it needs gpg, jq and curl but no network. `checks` in ci.yml runs it when .github/ changes.
set -uo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/claude-release-fetch.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0
version=9.9.9

export GNUPGHOME="$work/signer"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --passphrase '' --quick-gen-key 'Fixture Release Signing <release@example.invalid>' ed25519 sign never 2>/dev/null
test_fpr="$(gpg --with-colons --list-keys 2>/dev/null | awk -F: '/^fpr/ { print $10; exit }')"

# release <name> <manifest platform key>: a release folder whose manifest names that platform, signed after writing.
release() {
  local root="$work/$1" rel="$work/$1/claude-code-releases/$version"
  mkdir -p "$rel/linux-x64" "$root/keys"
  printf 'fixture binary %s\n' "$1" >"$rel/linux-x64/claude"
  local sum; sum="$(sha256sum "$rel/linux-x64/claude" | cut -d' ' -f1)"
  jq -n --arg p "$2" --arg s "$sum" '{version: "9.9.9", platforms: {($p): {checksum: $s}}}' >"$rel/manifest.json"
  gpg --batch --yes --detach-sign -o "$rel/manifest.json.sig" "$rel/manifest.json"
  gpg --batch --armor --export "$test_fpr" >"$root/keys/claude-code.asc"
  echo "$root"
}

# run <label> <expect 0|1> <base> <fpr> <stderr pattern or ''>
run() {
  local out="$work/out-$1" err="$work/err-$1" code=0
  ( unset GNUPGHOME; CLAUDE_RELEASE_BASE="file://$3" CLAUDE_RELEASE_KEY_FPR="$4" "$script" "$version" linux-x64 "$out" ) >/dev/null 2>"$err" || code=$?
  if [ "$2" = 0 ] && [ "$code" -ne 0 ]; then echo "FAIL $1: exit $code: $(cat "$err")"; failures=$((failures + 1)); return; fi
  if [ "$2" = 1 ] && [ "$code" -eq 0 ]; then echo "FAIL $1: passed, should fail"; failures=$((failures + 1)); return; fi
  if [ -n "$5" ] && ! grep -qE "$5" "$err"; then echo "FAIL $1: stderr lacks /$5/: $(cat "$err")"; failures=$((failures + 1)); return; fi
  echo "ok   $1"
}

good="$(release good linux-x64)"
run good 0 "$good" "$test_fpr" ''
if ! grep -qs 'fixture binary good' "$work/out-good"; then echo "FAIL good: binary not written"; failures=$((failures + 1)); fi

missing="$(release missing darwin-arm64)"
run 'missing platform names version and platform' 1 "$missing" "$test_fpr" "Claude Code 9\.9\.9 \(linux-x64\): its manifest has no linux-x64 entry; it lists: darwin-arm64"

run 'another key than the pinned one' 1 "$good" "31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE" 'no valid signature'

tampered="$(release tampered linux-x64)"
jq '.platforms["linux-x64"].checksum = ("0" * 64)' "$tampered/claude-code-releases/$version/manifest.json" >"$work/m" \
  && mv "$work/m" "$tampered/claude-code-releases/$version/manifest.json"
run 'manifest changed after signing' 1 "$tampered" "$test_fpr" 'no valid signature'

swapped="$(release swapped linux-x64)"
echo 'another binary' >"$swapped/claude-code-releases/$version/linux-x64/claude"
run 'binary swapped' 1 "$swapped" "$test_fpr" 'does not match its signed checksum'
[ -e "$work/out-binary swapped" ] && { echo "FAIL binary swapped: bad binary left on disk"; failures=$((failures + 1)); }

nosig="$(release nosig linux-x64)"
rm "$nosig/claude-code-releases/$version/manifest.json.sig"
run 'no signature file' 1 "$nosig" "$test_fpr" 'could not download .*manifest\.json\.sig'

if [ "$failures" -ne 0 ]; then echo "$failures failed"; exit 1; fi
echo "all passed"
