#!/usr/bin/env bash
# Checks a built app without launching it: bundle identity, the MCP helper, the LegallasCore resource bundle, the code signature, and
# that the signed entitlements match LegallasApp/Legallas/Legallas.entitlements.
#
# Usage: bash LegallasApp/Scripts/verify-app.sh <path/to/the.app>
#
# Never launches the app: a launch creates its sandbox container, and on a
# developer's Mac an ad hoc build would claim that container.
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
    echo "usage: $0 <path/to/the.app>" >&2
    exit 64
fi
app="$1"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_entitlements="$repo/LegallasApp/Legallas/Legallas.entitlements"
baseline="$repo/LegallasApp/Config/entitlements_baseline.txt"
expected_name="$(bash "$repo/LegallasApp/Scripts/app-setting.sh" PRODUCT_NAME)"
expected_bundle_id="$(bash "$repo/LegallasApp/Scripts/app-setting.sh" PRODUCT_BUNDLE_IDENTIFIER)"
helper_name="$(bash "$repo/LegallasApp/Scripts/app-setting.sh" MCP_HELPER_NAME)"
helper="$app/Contents/Helpers/$helper_name"

failures=0
fail() { echo "error: $*" >&2; failures=$((failures + 1)); }
pass() { echo "ok: $*"; }

plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null || true; }

bundle_id="$(plist_value "$app/Contents/Info.plist" CFBundleIdentifier)"
executable="$(plist_value "$app/Contents/Info.plist" CFBundleExecutable)"
if [[ "$bundle_id" == "$expected_bundle_id" ]]; then
    pass "bundle identifier $bundle_id"
else
    fail "bundle identifier is '$bundle_id', expected $expected_bundle_id"
fi
if [[ -n "$executable" && -x "$app/Contents/MacOS/$executable" ]]; then
    pass "executable Contents/MacOS/$executable"
else
    fail "Contents/MacOS/$executable is missing or not executable"
fi

if [[ -x "$helper" ]] && helper_help="$("$helper" --help 2>&1)"; then
    pass "Contents/Helpers/$helper_name runs (--help)"
    # The helper's names come from AppSettings, the bundle's from the xcconfig files: a room sets both.
    for setting in "$helper_name:" " $expected_name macOS" "/$expected_name.app/" "/Containers/$expected_bundle_id/"; do
        [[ "$helper_help" == *"$setting"* ]] \
            || fail "the helper's --help does not say '$setting': AppSettings and the build settings disagree"
    done
else
    fail "Contents/Helpers/$helper_name is missing or failed --help"
fi
[[ ! -e "$app/Contents/Resources/$helper_name" ]] \
    || fail "$helper_name also sits in Contents/Resources; it belongs in Contents/Helpers only"

# Bundle.module looks in Contents/Resources first; a copy at the bundle root
# would break the code signature seal.
resources="$app/Contents/Resources/Legallas_LegallasCore.bundle"
if find "$resources" -name ColoradoCourtHolidays.json 2>/dev/null | grep -q .; then
    pass "LegallasCore resources in Contents/Resources"
else
    fail "ColoradoCourtHolidays.json not found under $resources"
fi

if codesign --verify --strict --deep "$app" 2>/dev/null; then
    pass "code signature verifies (strict, nested code included)"
else
    fail "codesign --verify --strict --deep failed"
fi

signed="$(mktemp)"
helper_signed="$(mktemp)"
trap 'rm -f "$signed" "$helper_signed"' EXIT
codesign -d --entitlements - --xml "$app" >"$signed" 2>/dev/null || true
codesign -d --entitlements - --xml "$helper" >"$helper_signed" 2>/dev/null || true

# Every key in the source file must be signed with the same value, and every
# baseline key must be true. Xcode may add get-task-allow for local signing.
if mismatches="$(/usr/bin/python3 - "$source_entitlements" "$signed" "$baseline" <<'PY'
import plistlib, sys
source_path, signed_path, baseline_path = sys.argv[1:4]
with open(source_path, "rb") as f:
    source = plistlib.load(f)
try:
    with open(signed_path, "rb") as f:
        signed = plistlib.load(f)
except Exception:
    signed = {}
problems = [f"{k}: signed {signed.get(k)!r}, source {v!r}" for k, v in source.items() if signed.get(k) != v]
with open(baseline_path) as f:
    keys = [line.strip() for line in f if line.strip() and not line.startswith("#")]
problems += [f"{k}: baseline requires true" for k in keys if signed.get(k) is not True]
print("\n".join(problems))
sys.exit(1 if problems else 0)
PY
)"; then
    pass "signed entitlements match Legallas.entitlements and the baseline"
else
    while IFS= read -r line; do fail "entitlement $line"; done <<<"$mismatches"
fi

if grep -q 'com.apple.security.app-sandbox' "$helper_signed"; then
    fail "$helper_name is signed with the sandbox entitlement; it must read the --store path it is given"
else
    pass "$helper_name is not sandboxed"
fi

team="$(bash "$repo/LegallasApp/Scripts/signing-team.sh" "$app")"
if [[ -z "$team" ]]; then
    echo "note: signed ad hoc (fine for CI; install-app.sh requires a team)"
else
    echo "note: signed by team $team"
fi

if [[ "$failures" -gt 0 ]]; then
    echo "$failures check(s) failed for $app" >&2
    exit 1
fi
echo "All checks passed for $app"
