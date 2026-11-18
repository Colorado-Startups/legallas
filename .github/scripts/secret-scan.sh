#!/usr/bin/env bash
# Scans git history for secrets with the gitleaks CLI (MIT licensed).
# gitleaks-action needs a paid GITLEAKS_LICENSE on an organization's
# repository, which this one is since the move to Colorado-Startups
# (2026-10-31); the CLI it wraps does not. A pinned release binary for the
# runner's platform (Linux x86_64 or arm64, macOS on Apple silicon), checked
# against the SHA-256 digest GitHub records for each release asset, and cached
# in the runner's tool cache. Bump the version by updating every URL and digest
# together. Findings are redacted in the log.
#
# A clean result has to mean the commits were read, so a pull request can't change
# what this reads and a scan that read too little fails. Every route it closes is
# planted in secret-scan-test.sh. No scan can read a secret that no longer looks like one (UTF-16,
# compressed, encrypted, or split across lines or commits).
#
# The workflow passes, through env: EVENT_NAME, PR_BASE_SHA and PR_HEAD_SHA
# (pull_request), PUSH_BEFORE (push), MERGE_GROUP_BASE_SHA and MERGE_GROUP_HEAD_SHA
# (merge_group). The checkout must have full history.
set -euo pipefail

GITLEAKS_RELEASE="https://github.com/gitleaks/gitleaks/releases/download/v8.30.1"
GITLEAKS_RULES_URL="https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/config/gitleaks.toml"
GITLEAKS_RULES_SHA256="e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf"

case "$(uname -s)/$(uname -m)" in
    Linux/x86_64)
        GITLEAKS_URL="$GITLEAKS_RELEASE/gitleaks_8.30.1_linux_x64.tar.gz"
        GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
        ;;
    Linux/aarch64|Linux/arm64)
        GITLEAKS_URL="$GITLEAKS_RELEASE/gitleaks_8.30.1_linux_arm64.tar.gz"
        GITLEAKS_SHA256="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
        ;;
    Darwin/arm64)
        GITLEAKS_URL="$GITLEAKS_RELEASE/gitleaks_8.30.1_darwin_arm64.tar.gz"
        GITLEAKS_SHA256="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
        ;;
    *)
        echo "::error::secret-scan.sh supports Linux x86_64 and arm64 and macOS on Apple silicon, not $(uname -s)/$(uname -m)"
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

# fetch <var> <name> <url> <sha256>: as in lint-workflows.sh. Download, verify
# and unpack once per version, then set <var> to the binary's path; a bad or
# half-unpacked download is never cached.
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

gitleaks=""
fetch gitleaks gitleaks "$GITLEAKS_URL" "$GITLEAKS_SHA256"

# gitleaks' own rules for this release, less every allow-list that names paths (the
# global one holds lockfiles, images, fonts, office files and vendored folders), because
# anyone can name a file to suit a list, and every one that reads the whole line, because
# a comment on the line can satisfy it. Passing --config also stops a .gitleaks.toml being
# read. An allow-list on one rule is held back until its end shows which kind it is.
rules_source="$TOOLS/gitleaks-rules-$GITLEAKS_RULES_SHA256.toml"
if [[ ! -s "$rules_source" ]]; then
    work="$(mktemp "$TOOLS/.rules.XXXXXX")"
    curl -fsSL --retry 3 -o "$work" "$GITLEAKS_RULES_URL"
    echo "$GITLEAKS_RULES_SHA256  $work" | sha256_check >/dev/null
    mv "$work" "$rules_source"
fi
rules="$(mktemp)"
awk '/^\[allowlist\]$/ { global = 1 }
     /^\[\[rules\]\]$/ { global = 0 }
     global && /^paths = \[$/ { skipping = 1; next }
     skipping { if (/^\]$/) skipping = 0; next }
     /^\[\[rules\.allowlists\]\]$|^\[\[rules\]\]$|^$/ { if (!dropped) printf "%s", held; held = ""; dropped = 0; holding = /allowlists/ }
     holding { held = held $0 "\n"; if (/^paths = \[$/ || /^regexTarget = "line"$/) dropped = 1; next }
     { print }
     END { if (!dropped) printf "%s", held }' "$rules_source" >"$rules"

refuse() {
    echo "::error::$1"
    exit 1
}

# gitleaks always honours a .gitleaksignore in the folder it scans, whatever the flags.
excuses="$(git ls-files -- ':(glob)**/.gitleaksignore' ':(glob)**/.gitleaks.toml')"
[[ -z "$excuses" ]] || refuse "Only a reviewed change to this script can excuse a finding. Remove: $excuses"

# The scan below reads through these lines, but a code review's diff doesn't: a file
# marked -diff or binary shows as "binary", and .gitattributes can mark itself. The
# two known files are exempt in the root file only, since a path in a folder's file is
# relative to that folder. A new one is added here.
hiding='(^|[[:space:]])(-diff(=[^[:space:]]*)?|binary)([[:space:]]|$)'
known='^(web/package-lock\.json|\*\.riv)[[:space:]]'
hidden=""
# In a file first, because a process substitution's failure would go unseen and read as no files.
attribute_files="$(mktemp)"
git ls-files -z -- ':(glob)**/.gitattributes' >"$attribute_files"
while IFS= read -r -d '' file; do
    # grep exits 1 for no match and 2 when it can't read the file, which must not pass as clean.
    found="$(grep -E "$hiding" "./$file")" || [[ $? -eq 1 ]] || refuse "Couldn't read $file, so what it hides is unknown."
    found="$(grep -vE '^[[:space:]]*#' <<<"$found" || true)"
    if [[ "$file" == .gitattributes ]]; then
        found="$(grep -vE "$known" <<<"$found" || true)"
    fi
    if [[ -n "$found" ]]; then
        hidden+="$found"$'\n'
    fi
done <"$attribute_files"
[[ -z "$hidden" ]] || refuse "A new .gitattributes line hides a file from review. Remove: $hidden"

is_commit() {
    git rev-parse --verify --quiet "$1^{commit}" >/dev/null
}

# Which commits to scan: --all reads the whole history (every commit, every branch).
range=(--full-history --all)
case "${EVENT_NAME:-}" in
    pull_request)
        # Every commit in the pull request, not only its final diff: a secret
        # added and then removed inside a PR stays in history after the merge.
        is_commit "${PR_BASE_SHA:?}" || refuse "The pull request's base $PR_BASE_SHA isn't a commit here, so nothing could be read."
        is_commit "${PR_HEAD_SHA:?}" || refuse "The pull request's head $PR_HEAD_SHA isn't a commit here, so nothing could be read."
        range=("$PR_BASE_SHA..$PR_HEAD_SHA") ;;
    push)
        # What landed on main. A first push (an all-zero before) or a before
        # that a force-push removed gives no usable range, so scan everything.
        if [[ -n "${PUSH_BEFORE:-}" && ! "$PUSH_BEFORE" =~ ^0+$ ]] && is_commit "$PUSH_BEFORE"; then
            range=("$PUSH_BEFORE..HEAD")
        fi ;;
    merge_group)
        # What the queue adds to main, not every branch: one stray branch holding a
        # flagged commit once failed every queue run. Its own PR scans that branch.
        is_commit "${MERGE_GROUP_BASE_SHA:?}" || refuse "The merge group's base $MERGE_GROUP_BASE_SHA isn't a commit here, so nothing could be read."
        is_commit "${MERGE_GROUP_HEAD_SHA:?}" || refuse "The merge group's head $MERGE_GROUP_HEAD_SHA isn't a commit here, so nothing could be read."
        range=("$MERGE_GROUP_BASE_SHA..$MERGE_GROUP_HEAD_SHA") ;;
    # workflow_dispatch (the manual run) and anything else: the full history.
esac

# Findings only a reviewed change here can excuse, each by its gitleaks fingerprint: one
# commit, file, rule and line, so a later change to that file is still read. The launch
# snapshot (#2) adds the whole tree in one commit, and run 43747961458 read it whole: a
# test's fake key that only a whole-file read matches, reported twice on that line.
# Both entries: test placeholder proving a .key file is refused; body AAAA. The second is
# the same line in #2's own commit before the squash, which a full-history scan also reads.
# One line: secret-scan-test.sh swaps this whole line for its own entry.
excused=("f668214f58118acc870eefa0683aa3dc971ad9b3:web/scripts/iwork.test.ts:private-key:280" "99a94c44b77ae02fd303202c5f102a74d875dfec:web/scripts/iwork.test.ts:private-key:280")
excused_file="$(mktemp)"
printf '%s\n' "${excused[@]}" >"$excused_file"

# How many commits in that range have a hunk that leaves lines, the only thing gitleaks
# reads, which it must at least match. Deleting, moving, changing a mode and an empty commit
# have none, so a true 0 passes; so does a hunk whose new side is empty (+N,0), such as a
# symlink turned into an empty file, whose deleted side gitleaks skips (#379). Added lines
# start with +, so only git's own lines can match here, and C keeps awk from stopping at a
# binary's bytes.
expected="$(git log "${range[@]}" --text -p --diff-merges=first-parent --diff-filter=ACMRT --format='commit %H' |
    LC_ALL=C awk '/^commit /{sha=$2; next} /^@@ -[0-9,]+ \+[0-9]+(,[1-9][0-9]*)? @@/{seen[sha]=1} END{n=0; for (sha in seen) n++; print n}')"

"$gitleaks" version
# gitleaks hands --log-opts to `git log -p`, split on spaces, in place of its own.
#   --text: read every file as text, whatever its bytes or .gitattributes say.
#   --diff-merges=first-parent: read what a merge commit adds; git log skips it otherwise.
#   --ignore-gitleaks-allow: only a reviewed change to this scan can excuse a finding,
#   never a comment on the line itself.
#   --gitleaks-ignore-path: the excused list above; a tracked .gitleaksignore is refused earlier.
log="$(mktemp)"
status=0
"$gitleaks" git --config "$rules" --redact --verbose --no-banner --exit-code 1 --ignore-gitleaks-allow \
    --gitleaks-ignore-path "$excused_file" \
    --log-opts="--text --diff-merges=first-parent ${range[*]}" . 2>&1 | tee "$log" || status="${PIPESTATUS[0]}"
[[ "$status" -eq 0 ]] || exit "$status"

# gitleaks exits 0 when `git log` dies, so a clean exit proves nothing on its own.
scanned="$(sed -n 's/.*[^0-9]\([0-9][0-9]*\) commits scanned.*/\1/p' "$log" | tail -n 1)"
[[ -n "$scanned" ]] || refuse "gitleaks reported no count of commits scanned, so nothing shows it read anything."
[[ "$scanned" -ge "$expected" ]] || refuse "gitleaks scanned $scanned commits but ${range[*]} has $expected to read."
echo "Read $scanned commits; $expected in this range have something to read."

# A diff holds neither a commit's message, which a squash merge copies onto main, nor who
# it names, nor the name of an empty file, so those go through gitleaks on their own. gitleaks drops
# all of stdin when its opening bytes look like a file type (PDF, tar, ISO), which a
# message could copy, so a newline and padding past the furthest such offset go first.
{
    printf '\n%40000s\n' ''
    git log "${range[@]}" --format='%an %ae %cn %ce%n%B'
    git log "${range[@]}" --diff-merges=first-parent --name-only --format=
} | "$gitleaks" stdin --config "$rules" --redact --verbose --no-banner --exit-code 1 --ignore-gitleaks-allow
