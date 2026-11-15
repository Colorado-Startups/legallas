#!/usr/bin/env bash
# Lints .github/workflows with actionlint (syntax, expressions, shellcheck) and
# zizmor (security: template injection, credential persistence, permissions).
# Both are pinned release binaries for the runner's platform (Linux x86_64 or
# arm64, macOS on Apple silicon), checked against the SHA-256 digests GitHub
# records for each release asset, and cached in the runner's tool cache. Bump
# a version by updating every URL and digest of that tool together. zizmor's
# Linux builds need glibc 2.34 or newer (Debian 12, Ubuntu 22.04).
set -euo pipefail

ACTIONLINT_RELEASE="https://github.com/rhysd/actionlint/releases/download/v1.7.12"
ZIZMOR_RELEASE="https://github.com/zizmorcore/zizmor/releases/download/v1.30.1"

case "$(uname -s)/$(uname -m)" in
    Linux/x86_64)
        ACTIONLINT_URL="$ACTIONLINT_RELEASE/actionlint_1.7.12_linux_amd64.tar.gz"
        ACTIONLINT_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
        ZIZMOR_URL="$ZIZMOR_RELEASE/zizmor-x86_64-unknown-linux-gnu.tar.gz"
        ZIZMOR_SHA256="e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a"
        ;;
    Linux/aarch64|Linux/arm64)
        ACTIONLINT_URL="$ACTIONLINT_RELEASE/actionlint_1.7.12_linux_arm64.tar.gz"
        ACTIONLINT_SHA256="325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
        ZIZMOR_URL="$ZIZMOR_RELEASE/zizmor-aarch64-unknown-linux-gnu.tar.gz"
        ZIZMOR_SHA256="7ff1dce33bdd18fd2a4affe63bdd47efcccca97b2cec1c1863ec26e9e2647540"
        ;;
    Darwin/arm64)
        ACTIONLINT_URL="$ACTIONLINT_RELEASE/actionlint_1.7.12_darwin_arm64.tar.gz"
        ACTIONLINT_SHA256="aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"
        ZIZMOR_URL="$ZIZMOR_RELEASE/zizmor-aarch64-apple-darwin.tar.gz"
        ZIZMOR_SHA256="e28d22b087f9ebb8d99da6e740d348c930f559961c7c3f12badda54f882195a2"
        ;;
    *)
        echo "::error::lint-workflows.sh supports Linux x86_64 and arm64 and macOS on Apple silicon, not $(uname -s)/$(uname -m)"
        exit 1
        ;;
esac

# Debian and Ubuntu ship sha256sum; macOS ships shasum. Both read "<digest>  <file>".
if command -v sha256sum >/dev/null; then
    sha256_check() { sha256sum -c -; }
else
    sha256_check() { shasum -a 256 -c -; }
fi

TOOLS="${RUNNER_TOOL_CACHE:-${RUNNER_TEMP:-/tmp}}/legallas-lint"
mkdir -p "$TOOLS"

# fetch <var> <name> <url> <sha256>: download, verify and unpack once per
# version, then set <var> to the binary's path. Not called inside $(...): bash
# turns off `set -e` there, which would let a failed checksum through. The
# archive is unpacked into a temp folder and moved into the cache only after
# it verified, so a bad or half-unpacked download is never cached.
fetch() {
    local var="$1" name="$2" url="$3" sha="$4"
    local dir="$TOOLS/$name-$sha"
    if [[ ! -x "$dir/$name" ]]; then
        local work
        work="$(mktemp -d "$TOOLS/.fetch.XXXXXX")" || return 1
        curl -fsSL --retry 3 -o "$work/archive.tar.gz" "$url" || { rm -rf "$work"; return 1; }
        echo "$sha  $work/archive.tar.gz" | sha256_check || { rm -rf "$work"; return 1; }
        mkdir -p "$work/bin" || { rm -rf "$work"; return 1; }
        tar -xzf "$work/archive.tar.gz" -C "$work/bin" || { rm -rf "$work"; return 1; }
        [[ -x "$work/bin/$name" ]] || { echo "::error::$name missing from $url"; rm -rf "$work"; return 1; }
        rm -rf "$dir" && mv "$work/bin" "$dir" && rm -rf "$work" || return 1
    fi
    printf -v "$var" '%s' "$dir/$name"
}

actionlint=""
zizmor=""
fetch actionlint actionlint "$ACTIONLINT_URL" "$ACTIONLINT_SHA256"
fetch zizmor zizmor "$ZIZMOR_URL" "$ZIZMOR_SHA256"

status=0
"$actionlint" -version
"$actionlint" -color || status=1
"$zizmor" --version
"$zizmor" --offline --format github .github/workflows || status=1
exit "$status"
