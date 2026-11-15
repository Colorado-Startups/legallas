#!/usr/bin/env bash
# Usage: swift-coverage-summary.sh <out.json>
# After `swift test --enable-code-coverage`, writes the line coverage of each
# production file of the Swift package (Sources/ and LegallasApp/) as
#   {"files": [{"path": "Sources/...", "lines": N, "covered": M}]}
# with paths relative to the checkout. Test files and build products are left
# out. ci.yml's swift and swift-ocr jobs upload it; the Code page of the Quality
# and Speed site reads it. No file names beyond the package's own source paths
# and no source text are written.
#
# SwiftPM builds more than one test binary here (a test target that imports an
# executable target gets its own), and the JSON `swift test --show-codecov-path`
# names covers only one of them. So the summary comes from llvm-cov over the
# merged profile and every test bundle and executable in the build folder.
set -euo pipefail

out="${1:?usage: swift-coverage-summary.sh <out.json>}"
command -v jq >/dev/null || { echo "::error title=jq missing::jq is not on this runner"; exit 1; }
bin="$(swift build --show-bin-path)"
profile="$(dirname "$(swift test --show-codecov-path)")/default.profdata"
test -s "$profile" || { echo "::error title=No Swift coverage::$profile is missing or empty"; exit 1; }

candidates=()
for bundle in "$bin"/*.xctest; do
    [ -d "$bundle" ] || continue
    name="$(basename "$bundle" .xctest)"
    if [ -x "$bundle/Contents/MacOS/$name" ]; then candidates+=("$bundle/Contents/MacOS/$name"); fi
done
for exe in "$bin/Legallas" "$bin/LegallasMCP" "$bin/LegallasExtract"; do
    if [ -f "$exe" ] && [ -x "$exe" ]; then candidates+=("$exe"); fi
done
# Only binaries built with coverage: llvm-cov refuses the whole export when one has no coverage map.
objects=()
for candidate in "${candidates[@]}"; do
    if xcrun llvm-cov export -summary-only -instr-profile "$profile" "$candidate" >/dev/null 2>&1; then objects+=("$candidate"); fi
done
[ "${#objects[@]}" -gt 0 ] || { echo "::error title=No Swift coverage::no test bundle in $bin"; exit 1; }
args=("${objects[0]}")
for object in "${objects[@]:1}"; do args+=(-object "$object"); done
echo "Objects: ${objects[*]#"$bin"/}"

xcrun llvm-cov export -summary-only -instr-profile "$profile" "${args[@]}" \
    | jq --arg root "$PWD/" '{files: [
        .data[0].files[]
        | select((.filename | startswith($root + "Sources/")) or (.filename | startswith($root + "LegallasApp/")))
        | {path: (.filename | ltrimstr($root)), lines: .summary.lines.count, covered: .summary.lines.covered}
      ]}' > "$out"

count="$(jq '.files | length' "$out")"
if [ "$count" -eq 0 ]; then
    echo "::error title=No Swift coverage::llvm-cov lists no file under Sources/ or LegallasApp/"
    exit 1
fi
jq -r '"Swift line coverage: \(([.files[].covered] | add) // 0) of \(([.files[].lines] | add) // 0) lines in \(.files | length) files"' "$out"
jq -r '[.files[] | {m: (.path | split("/")[0:2] | join("/")), l: .lines, c: .covered}] | group_by(.m)[] | "  \(.[0].m): \([.[].c] | add) of \([.[].l] | add)"' "$out"
