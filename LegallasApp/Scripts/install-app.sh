#!/usr/bin/env bash
# Builds, checks and installs the app into ~/Applications. Run it by hand
# after pulling main; nothing schedules it. ~/Applications needs no administrator password and keeps
# the app to this account.
#
# Usage: bash LegallasApp/Scripts/install-app.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scripts="$repo/LegallasApp/Scripts"
signing="$repo/LegallasApp/Config/Signing.xcconfig"
name="$(bash "$scripts/app-setting.sh" PRODUCT_NAME)"
bundle_id="$(bash "$scripts/app-setting.sh" PRODUCT_BUNDLE_IDENTIFIER)"
helper_name="$(bash "$scripts/app-setting.sh" MCP_HELPER_NAME)"
dest="$HOME/Applications/$name.app"

# The team ID is the OU of the first Apple Development certificate, if any.
print_team_hint() {
    local subject team
    subject="$(security find-certificate -c "Apple Development" -p 2>/dev/null \
        | openssl x509 -noout -subject 2>/dev/null || true)"
    team="$(sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' <<<"$subject")"
    if [[ -n "$team" ]]; then
        echo "Your keychain has an Apple Development certificate for team $team. Create it with:" >&2
        printf "  printf 'DEVELOPMENT_TEAM = %s\\\\nCODE_SIGN_IDENTITY = Apple Development\\\\n' > '%s'\\n" "$team" "$signing" >&2
    else
        echo "No Apple Development certificate found. In Xcode: Settings > Accounts, add your" >&2
        echo "Apple Account, then Manage Certificates > + > Apple Development. Then rerun this." >&2
    fi
}

if [[ ! -f "$signing" ]]; then
    echo "error: $signing is missing." >&2
    echo "An installed $name.app needs a stable signing identity: an ad hoc build gets a new" >&2
    echo "signature every time, and macOS then asks before each new build may open the" >&2
    echo "sandbox container holding your case data." >&2
    print_team_hint
    exit 1
fi

if pgrep -x "$name" >/dev/null; then
    echo "error: $name is running. Quit it (and stop any swift run of it), then rerun." >&2
    exit 1
fi

app="$(bash "$scripts/build-app.sh" Release)"
bash "$scripts/verify-app.sh" "$app"
if [[ -z "$(bash "$scripts/signing-team.sh" "$app")" ]]; then
    echo "error: the build is signed ad hoc even though $signing exists; check its team ID." >&2
    exit 1
fi

mkdir -p "$HOME/Applications"
staging="$HOME/Applications/.$name.app.installing"
rm -rf "$staging"
ditto "$app" "$staging"
if [[ -d "$dest" ]]; then
    existing="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$dest/Contents/Info.plist" 2>/dev/null || true)"
    if [[ "$existing" != "$bundle_id" ]]; then
        rm -rf "$staging"
        echo "error: $dest exists but is not $name (bundle id '$existing'); leaving it alone." >&2
        exit 1
    fi
    rm -rf "$dest"
fi
mv "$staging" "$dest"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$dest"

cat <<EOF

Installed $dest
Open it from ~/Applications (or Spotlight) so macOS asks for notification permission.

Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):
EOF
"$dest/Contents/Helpers/$helper_name" --help 2>&1 | sed -n '/"mcpServers"/,$p' | sed "s#/Users/<you>#$HOME#g"
