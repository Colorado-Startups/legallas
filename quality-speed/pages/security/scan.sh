#!/usr/bin/env bash
# Runs the free scanners the Security page scores, over this repository's whole history, and leaves their raw output
# in <raw-dir> for collect-scan.ts. CI only: it downloads tools and scans everything, which is never a job for a laptop.
#
#   quality-speed/pages/security/scan.sh <raw-dir>
#
# It carries on past a scanner's failure on purpose. Each step writes its exit code to <name>.rc, and collect-scan.ts turns
# anything unproven into `missing`, so one broken tool costs its own metric and never reads as a clean result. Each tool
# also runs a planted drill with the same flags: a scanner that can no longer find a planted problem proves nothing by
# finding none.
#
# Tools follow the repository's rule (.github/scripts/secret-scan.sh): pinned releases, checked against the SHA-256
# digest GitHub records for each asset. Bump a version by updating its URL and digest together, and take a release at
# least 7 days old, as .github/dependabot.yml does. gitleaks is not pinned here: this runs the secret scan CI gates on.
#
# Licences (quality-speed/pages/security/PLAN.md): the Semgrep rules allow internal use only, so they are downloaded at
# run time, never committed or shipped, and only counts reach the site.
set -uo pipefail

RAW="${1:?usage: scan.sh <raw-dir>}"
if [[ -z "${CI:-}" ]]; then
    echo "::error::scan.sh runs in CI only" >&2
    exit 2
fi
mkdir -p "$RAW"
RAW="$(cd "$RAW" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
TOOLS="${RUNNER_TOOL_CACHE:-${RUNNER_TEMP:-/tmp}}/legallas-lint"
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/qs-security.XXXXXX")"
mkdir -p "$TOOLS"

OSV_URL="https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_amd64"
OSV_SHA256="160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"
SCORECARD_URL="https://github.com/ossf/scorecard/releases/download/v5.6.0/scorecard_5.6.0_linux_amd64.tar.gz"
SCORECARD_SHA256="19bde07129450cb65a95c6e3b9f34e034341579e6f0e241546ec3ae6efb2dd9a"
SEMGREP_IMAGE="semgrep/semgrep@sha256:451b3d875c00dac7ed5db5293e584a07de11449a409c10b3c2d2652f429630b6" # 1.182.1
SEMGREP_RULES_REPO="https://github.com/semgrep/semgrep-rules"
SEMGREP_RULES_COMMIT="16b9e6d45f10649f6a531ec4838ed9924372c3bc"
# Everything this repository is written in, and nothing it is not.
SEMGREP_RULE_DIRS=(javascript typescript python bash swift html yaml/github-actions generic/secrets)

# fetch_binary <var> <name> <url> <sha256>: download and verify once per digest, then set <var> to the binary's path.
fetch_binary() {
    local var="$1" name="$2" url="$3" sha="$4"
    local dir="$TOOLS/$name-$sha"
    if [[ ! -x "$dir/$name" ]]; then
        local tmp
        tmp="$(mktemp -d "$TOOLS/.fetch.XXXXXX")" || return 1
        curl -fsSL --retry 3 -o "$tmp/download" "$url" || { rm -rf "$tmp"; return 1; }
        echo "$sha  $tmp/download" | sha256sum -c - >/dev/null || { rm -rf "$tmp"; return 1; }
        mkdir -p "$tmp/bin" || { rm -rf "$tmp"; return 1; }
        case "$url" in
            *.tar.gz) tar -xzf "$tmp/download" -C "$tmp/bin" || { rm -rf "$tmp"; return 1; } ;;
            *) mv "$tmp/download" "$tmp/bin/$name" && chmod +x "$tmp/bin/$name" || { rm -rf "$tmp"; return 1; } ;;
        esac
        [[ -x "$tmp/bin/$name" ]] || { echo "::error::$name missing from $url" >&2; rm -rf "$tmp"; return 1; }
        rm -rf "$dir" && mv "$tmp/bin" "$dir" && rm -rf "$tmp" || return 1
    fi
    printf -v "$var" '%s' "$dir/$name"
}

# step <name> <command...>: runs it, keeps stdout and stderr in <name>.log and the exit code in <name>.rc.
step() {
    local name="$1"
    shift
    "$@" >"$RAW/$name.log" 2>&1
    local rc=$?
    echo "$rc" >"$RAW/$name.rc"
    echo "$name: exit $rc"
}

# Pull request heads. Merges here are squashes, so a pull request's own commits never reach main, and a secret added and
# then removed inside one stays readable through its ref. Through the environment, so the token is in no process list.
fetch_pull_heads() {
    local basic
    basic="$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)" || return 1
    GIT_CONFIG_COUNT=1 \
        GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
        GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $basic" \
        git -C "$ROOT" fetch --quiet --no-tags origin '+refs/pull/*/head:refs/remotes/qs-pr/*'
}

# added_paths <repo>: every path any commit on any ref ever added. NUL-separated with quoting off, because git otherwise
# quotes a non-ASCII path, and no pattern would match it. Stays in <raw-dir>: a path could itself name a matter.
added_paths() {
    git -C "$1" -c core.quotePath=false log --all --no-renames --diff-merges=first-parent --diff-filter=A --name-only --format= -z
}

# commits_with_text <repo>: the commits the secret scan can read, which is what its own count should reach. It takes commits
# that add or change lines of text. A commit that only deletes, renames, changes a mode, adds an empty file or changes a
# binary gives it nothing to read.
commits_with_text() {
    git -C "$1" log --all --no-merges --diff-filter=ACMR --numstat --format='commit %H' |
        awk '/^commit /{sha=$2; next} /^[0-9]/ && $1+$2>0 {seen[sha]=1} END{n=0; for (sha in seen) n++; print n}'
}

# Every tracked path as it's written. git otherwise quotes a non-ASCII one, and no anchored pattern would match that.
tracked() {
    git -C "$ROOT" ls-files -z | tr '\0' '\n'
}

# Files that can blind a scanner from inside this repository, which the drills, run in empty folders, can't notice. Any hit
# means collect-scan.ts trusts none of the three scans. Inline comments are off in both scanners: --disable-nosem below, and
# --ignore-gitleaks-allow in the secret scan, which the planted secret tests.
list_blinders() {
    tracked | grep -E '(^|/)(\.gitleaks\.toml|\.gitleaksignore|\.gitleaks\.baseline|\.semgrepignore|osv-scanner\.toml|\.osv-scanner\.toml)$'
    # A -diff or binary attribute turns a file's text into "binary files differ", which the secret scan can't read. The
    # lockfile and the Rive binaries are known and reviewed; anything else hides text.
    tracked | grep -E '(^|/)\.gitattributes$' | while IFS= read -r file; do
        grep -E '(^|[[:space:]])(-diff(=[^[:space:]]*)?|binary)([[:space:]]|$)' "$ROOT/$file" |
            grep -vE '^[[:space:]]*#' |
            grep -vE '^(web/package-lock\.json|\*\.riv)[[:space:]]'
    done
    return 0
}

# new_drill_repo <dir> <path> <content>: a throwaway repository with one planted commit. Never this repository, so the
# signing rule for real commits does not apply here.
new_drill_repo() {
    local dir="$1" path="$2" content="$3"
    mkdir -p "$dir/$(dirname "$path")" || return 1
    git -C "$dir" init --quiet || return 1
    printf '%s\n' "$content" >"$dir/$path" || return 1
    git -C "$dir" add -A || return 1
    git -C "$dir" -c user.name=drill -c user.email=drill@example.invalid -c commit.gpgsign=false \
        commit --quiet -m 'planted for a drill' || return 1
}

# Neither this nor osv-scanner needs the token, so neither sees it.
secret_scan() {
    (cd "$1" && env -u GH_TOKEN -u GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML -u EVENT_NAME -u PR_BASE_SHA -u PR_HEAD_SHA -u PUSH_BEFORE "$ROOT/.github/scripts/secret-scan.sh")
}

# One pass over this repository (/src) and the planted drill (/drill) together. Loading the rules took 80 of the drill's
# 81 seconds when it ran alone, and in one pass the drill has the scan's very rules and flags. split_semgrep then gives
# each target its own report.
run_semgrep() {
    local dir
    local configs=()
    for dir in "${SEMGREP_RULE_DIRS[@]}"; do configs+=(--config "/rules/$dir"); done
    # No network and read-only mounts: nothing it reads can leave. As the runner's own user, so it can read the mounts.
    docker run --rm --network=none --user "$(id -u):$(id -g)" \
        -e HOME=/tmp -e SEMGREP_SEND_METRICS=off \
        -v "$ROOT:/src:ro" -v "$WORK/drill-sast:/drill:ro" -v "$WORK/rules:/rules:ro" -v "$WORK/semgrep-out:/out" -w /src \
        "$SEMGREP_IMAGE" \
        semgrep scan --metrics=off --disable-version-check --disable-nosem --no-git-ignore --json --output /out/both.json \
        "${configs[@]}" /src /drill
}

# split_semgrep <report>: semgrep.json holds what is under /src/, drill_sast.json what is under /drill/. An error with no
# path, such as a rule's own, goes in both. A field that isn't a list stays as it is, so the readers still refuse it.
split_semgrep() {
    node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const [file, raw] = process.argv.slice(1);
const report = JSON.parse(readFileSync(file, "utf8"));
const only = (list, keep) => (Array.isArray(list) ? list.filter(keep) : list);
for (const [name, prefix] of [["semgrep.json", "/src/"], ["drill_sast.json", "/drill/"]]) {
  const mine = (path) => typeof path === "string" && path.startsWith(prefix);
  const paths = report.paths ?? {};
  const split = {
    ...report,
    results: only(report.results, (finding) => mine(finding?.path)),
    errors: only(report.errors, (error) => error?.path == null || mine(error.path)),
    paths: { ...paths, scanned: only(paths.scanned, mine), ...("skipped" in paths ? { skipped: only(paths.skipped, (entry) => mine(entry?.path)) } : {}) },
  };
  writeFileSync(`${raw}/${name}`, JSON.stringify(split));
}' "$1" "$RAW"
}

fetch_semgrep_rules() {
    docker pull --quiet "$SEMGREP_IMAGE" || return 1
    git init --quiet "$WORK/rules" || return 1
    git -C "$WORK/rules" fetch --quiet --depth 1 "$SEMGREP_RULES_REPO" "$SEMGREP_RULES_COMMIT" || return 1
    git -C "$WORK/rules" checkout --quiet FETCH_HEAD || return 1
    [[ "$(git -C "$WORK/rules" rev-parse HEAD)" == "$SEMGREP_RULES_COMMIT" ]] || return 1
    rm -rf "$WORK/rules/.git"
}

# Its JSON goes to stdout and its progress to stderr, which step keeps in scorecard.log.
run_scorecard() {
    GITHUB_AUTH_TOKEN="${GH_TOKEN:-}" "$scorecard" \
        --repo="github.com/${GITHUB_REPOSITORY:?}" --format=json --show-details >"$RAW/scorecard.json"
}

# Semgrep's image and rules download in the background, behind the quicker scans: about 24 seconds, nearly all waiting.
step semgrep_setup fetch_semgrep_rules &
semgrep_setup_pid=$!

# The scan itself. Scorecard reads the default branch's newest commit, so it goes first: collect-scan.ts refuses its result if
# that is no longer the commit checked out here.
scorecard=""
fetch_binary scorecard scorecard "$SCORECARD_URL" "$SCORECARD_SHA256" || echo "::warning::scorecard did not download"
if [[ -n "$scorecard" ]]; then
    step scorecard run_scorecard
fi

step pull_heads fetch_pull_heads
git -C "$ROOT" for-each-ref refs/remotes/qs-pr | wc -l >"$RAW/pull_heads.count"
{
    git -C "$ROOT" rev-parse HEAD
    git -C "$ROOT" rev-parse --is-shallow-repository
    commits_with_text "$ROOT"
} >"$RAW/history.counts"
tracked | grep -E '(^|/)package-lock\.json$' >"$RAW/lockfiles.txt"
tracked | grep -cE '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|swift|html|ya?ml)$' >"$RAW/code_files.count"
step blinders list_blinders

step secrets secret_scan "$ROOT"
step added_paths added_paths "$ROOT"

osv=""
fetch_binary osv osv-scanner "$OSV_URL" "$OSV_SHA256" || echo "::warning::osv-scanner did not download"
if [[ -n "$osv" ]]; then
    step osv env -u GH_TOKEN "$osv" scan source --recursive --format json --output-file "$RAW/osv.json" "$ROOT"
fi

# The code-flaw drill sits beside the repository in the one Semgrep pass (run_semgrep), so it is planted first.
mkdir -p "$WORK/drill-sast" "$WORK/semgrep-out"
cat >"$WORK/drill-sast/planted.js" <<'EOF'
const { exec } = require('child_process');
function run(req, res) {
  eval(req.query.code);
  exec('ls ' + req.query.dir);
  res.send(req.query.code);
}
module.exports = { run };
EOF
wait "$semgrep_setup_pid"
if [[ "$(cat "$RAW/semgrep_setup.rc" 2>/dev/null)" == 0 ]]; then
    step semgrep run_semgrep
    step semgrep_split split_semgrep "$WORK/semgrep-out/both.json"
    # The drill ran in the scan's own pass, so it has the scan's exit code, or the split's if that failed.
    if [[ "$(cat "$RAW/semgrep_split.rc")" == 0 ]]; then cp "$RAW/semgrep.rc" "$RAW/drill_sast.rc"; else cp "$RAW/semgrep_split.rc" "$RAW/drill_sast.rc"; fi
fi

# The planted drills. The token is random and made here, so nothing credential-shaped sits in this file or any log.
planted_token="ghp_$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)"
allow_comment="gitleaks"":allow"
new_drill_repo "$WORK/drill-secret" config/settings.txt "token = $planted_token # $allow_comment" \
    && step drill_secrets secret_scan "$WORK/drill-secret"
unset planted_token

new_drill_repo "$WORK/drill-path" web/.dev.vars 'PLANTED=1' \
    && mkdir -p "$WORK/drill-path/CaseData" \
    && printf 'planted\n' >"$WORK/drill-path/CaseData/Résumé planted.pdf" \
    && git -C "$WORK/drill-path" add -A \
    && git -C "$WORK/drill-path" -c user.name=drill -c user.email=drill@example.invalid -c commit.gpgsign=false commit --quiet -m 'planted, with a name git would quote' \
    && step drill_added_paths added_paths "$WORK/drill-path"

mkdir -p "$WORK/drill-osv"
# A long-fixed advisory on an old release, so this keeps firing whatever the database gains.
cat >"$WORK/drill-osv/package-lock.json" <<'EOF'
{
  "name": "drill",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "drill", "version": "1.0.0", "dependencies": { "lodash": "4.17.4" } },
    "node_modules/lodash": { "version": "4.17.4", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz" }
  }
}
EOF
if [[ -n "$osv" ]]; then
    step drill_osv env -u GH_TOKEN "$osv" scan source --recursive --format json --output-file "$RAW/drill_osv.json" "$WORK/drill-osv"
fi

rm -rf "$WORK"
exit 0
