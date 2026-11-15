#!/bin/sh
# Xcode build phase "Embed LegallasMCP" (Legallas target).
#
# Builds the LegallasMCP executable with SwiftPM and places it in the app's
# Contents/Helpers, named MCP_HELPER_NAME. Claude Desktop launches it from
# there, so it is signed with the app's identity but without the app's
# entitlements: a sandboxed LegallasMCP could not open the --store path it is
# handed. Runs before Xcode signs the app, which then seals it as nested code.
set -eu

repo="$(cd "$SRCROOT/.." && pwd)"
config=debug
if [ "$CONFIGURATION" = "Release" ]; then
    config=release
fi
# A scratch path of its own keeps this build from racing the repository's
# .build (swift build, swift test) and keeps it inside DerivedData.
scratch="$OBJROOT/LegallasMCP-swiftpm"

# Xcode exports SDKROOT, TOOLCHAINS, compiler flags and more, which a nested
# swift build would pick up; start it from a clean environment instead.
swiftpm() {
    /usr/bin/env -i \
        HOME="$HOME" \
        TMPDIR="${TMPDIR:-/tmp}" \
        PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
        DEVELOPER_DIR="$DEVELOPER_DIR" \
        /usr/bin/xcrun swift build \
        --package-path "$repo" \
        --scratch-path "$scratch" \
        --configuration "$config" \
        --product LegallasMCP \
        "$@"
}

swiftpm
bin_dir="$(swiftpm --show-bin-path)"

helpers="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/Helpers"
mkdir -p "$helpers"
cp -f "$bin_dir/LegallasMCP" "$helpers/$MCP_HELPER_NAME"

if [ "${CODE_SIGNING_ALLOWED:-YES}" = "YES" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then
    /usr/bin/codesign --force \
        --sign "$EXPANDED_CODE_SIGN_IDENTITY" \
        --identifier "$PRODUCT_BUNDLE_IDENTIFIER.$MCP_HELPER_NAME" \
        --options runtime \
        --timestamp=none \
        "$helpers/$MCP_HELPER_NAME"
fi
