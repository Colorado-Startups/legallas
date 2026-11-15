#!/usr/bin/env bash
# Builds the app with xcodebuild and prints the bundle's path on stdout.
#
# Usage: bash LegallasApp/Scripts/build-app.sh [Release|Debug]   (default Release)
#
# DerivedData lives in .build/xcode, so repeated local builds stay
# incremental. Signs with the team in LegallasApp/Config/Signing.xcconfig when
# that file exists, ad hoc otherwise (CI). LEGALLAS_BUILD_JOBS=<n> caps
# xcodebuild at n parallel jobs (a local build may set 3 so the machine
# stays usable); unset, as in CI, xcodebuild picks its own count.
set -euo pipefail

configuration="${1:-Release}"
case "$configuration" in
    Release|Debug) ;;
    *) echo "usage: $0 [Release|Debug]" >&2; exit 64 ;;
esac

jobs="${LEGALLAS_BUILD_JOBS:-}"
if [[ -n "$jobs" && ! "$jobs" =~ ^[1-9][0-9]*$ ]]; then
    echo "error: LEGALLAS_BUILD_JOBS must be a positive whole number, not '$jobs'" >&2
    exit 64
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
derived="$repo/.build/xcode"

args=(
    build
    -project "$repo/LegallasApp/Legallas.xcodeproj"
    -scheme LegallasApp
    -configuration "$configuration"
    -destination 'platform=macOS,arch=arm64'
    -derivedDataPath "$derived"
    -quiet
)
if [[ -n "$jobs" ]]; then
    args+=(-jobs "$jobs")
fi
# Automatic signing with a team may need Xcode to create or refresh the Mac
# development profile, using the Apple Account signed in to Xcode.
if [[ -f "$repo/LegallasApp/Config/Signing.xcconfig" ]]; then
    args+=(-allowProvisioningUpdates)
fi

# xcodebuild's progress goes to stderr so stdout carries only the path.
xcodebuild "${args[@]}" >&2

app="$derived/Build/Products/$configuration/$(bash "$repo/LegallasApp/Scripts/app-setting.sh" PRODUCT_NAME).app"
if [[ ! -d "$app" ]]; then
    echo "error: xcodebuild finished but $app is missing" >&2
    exit 1
fi
echo "$app"
