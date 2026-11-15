#!/usr/bin/env bash
# Writes web=, office=, sync=, swift=, workflows= and quality_speed= (true or false) to $GITHUB_OUTPUT
# for the files this CI run changes, so each job skips work it has no reason to
# do. base= is the commit this run compares with, empty when that's unknown, for
# the Quality and Speed goal check.
#
# office= covers what web/scripts/office-index.test.ts and docx-side.test.ts load, because that test runs on the Mac, whose
# minutes cost about 10x Linux minutes. sync= covers what the sync-windows job's tests load, because
# Windows minutes cost more than Linux's. Both follow the imports to the end, and sync= adds the files
# those read (migrations, the npm lockfile). web/scripts/job-inputs.test.ts fails when either list
# misses a file its tests load, so add the file it names.
# Every area counts as changed when the base commit is unknown (manual runs,
# a new branch, a force push, a merge group whose head is not what's checked
# out), so a gap in history never skips a check.
#
# `changed-paths.sh inputs office|sync` instead prints the regex of every file that job's result
# depends on: its list, and job_files below. inputs_passed.py hashes them to decide whether the job
# already passed on this pull request on the same files.
set -euo pipefail

office_files='web/scripts/(checkindex|diff|extract|guard|indexjob|indexparts|iwa|iwork|iwork-table|mcp-constants|mcp-oauth|office|docx-side\.test|office-index\.test|office-read|ooxml|pii|pool|report|snapshot|text-file|wrangler)\.ts|web/scripts/law/(docx)\.ts|web/src/scripts/(eml|formd)\.ts|web/worker/(agent-files|doc-kinds|files-catalog|matter-types|room-settings|stored-name)\.ts'
sync_files='web/scripts/(active-scan|apply|checkindex|config|dev-pdf|diff|extract|extract-windows|extract-windows-api\.test|extract-windows\.test|guard|indexjob|indexparts|iwa|iwork|iwork-table|iwork\.test|load-module|local-r2|mcp-constants|mcp-oauth|office|office-read|office-read\.test|ooxml|pii|pii-hash|pii-scan|pool|pull|report|room-preload|room-sync|room-sync\.test|saveback|snapshot|snapshot\.test|spend-guard|sqlplan|sync|sync-windows\.test|text-file|visual-ai|wrangler)\.ts|web/scripts/law/(docx|plan|replica)\.ts|web/src/scripts/(eml|formd)\.ts|web/worker/(active-content|agent-files|audit|budget|doc-kinds|draft-text|email|files-catalog|files-upload|full-notice|http|law-cite|matter-types|notice-fixtures|room-names|room-settings|router|side-files|spend|sql|sqlite-d1|stored-name|sync|sync-fixtures|sync-rules|sync-saveback\.test)\.ts|web/worker/routes/(sync)\.ts|web/migrations/[^/]+\.sql|web/package(-lock)?\.json'

# What decides how those files run, so a change to one runs the job again: this workflow and this script,
# .gitattributes (checkout applies it to every file the tests read) and web/package.json (Node reads it to
# load each .ts file). inputs_passed.py too, so a change to the skip runs both jobs once. Review is still what
# guards that script: the copy a run checks out is the one that decides.
job_files='\.github/workflows/ci\.yml|\.github/scripts/(changed-paths\.sh|inputs_passed\.py)|(.*/)?\.gitattributes|web/package\.json'

if [[ "${1:-}" == inputs ]]; then
    case "${2:-}" in
        office) echo "$office_files|$job_files" ;;
        sync) echo "$sync_files|$job_files" ;;
        *) echo "usage: changed-paths.sh inputs office|sync" >&2; exit 2 ;;
    esac
    exit 0
fi

base=""
range=""
case "${EVENT_NAME:-}" in
    pull_request)
        # A pull request run checks out GitHub's test merge: the PR head
        # (second parent) merged into the base branch (first parent). The
        # event's base.sha can be older than that first parent when main moved
        # first, and a diff from it also lists what main gained (a ci.yml change
        # there ran every job), so diff from the first parent. Only when the
        # second parent is this PR's head; anything else keeps base.sha.
        base="${PR_BASE_SHA:-}"
        if [[ -n "${PR_HEAD_SHA:-}" && "$(git rev-parse -q --verify 'HEAD^2' || true)" == "$PR_HEAD_SHA" ]]; then
            base="$(git rev-parse 'HEAD^1')"
        fi
        range="$base...HEAD" ;;
    merge_group)
        # The merge queue checks out the group's head: main (the base) with
        # this pull request, and any ahead of it in the queue, squashed on top.
        # Only when the checkout is that head; anything else checks every area.
        if [[ -n "${MERGE_GROUP_HEAD_SHA:-}" && "$(git rev-parse HEAD)" == "$MERGE_GROUP_HEAD_SHA" ]]; then
            base="${MERGE_GROUP_BASE_SHA:-}"
        fi
        range="$base..HEAD" ;;
    push) base="${PUSH_BEFORE:-}"; range="$base..HEAD" ;;
esac

all=false
if [[ -z "$base" || "$base" =~ ^0+$ ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    all=true
    files=""
else
    # --no-renames lists both sides of a move, so moving a file out of an area
    # still counts as a change to that area.
    files="$(git diff --name-only --no-renames "$range")"
fi

# changed <regex>: true when any changed path matches.
changed() {
    if [[ "$all" == true ]] || grep -qE "$1" <<<"$files"; then echo true; else echo false; fi
}

# ci.yml and this script decide what runs, so editing either runs the Linux checks. The Mac jobs stay
# off: a manual run of CI checks every area, and is how to test a change to one.
# docs/checklist/ is the source of files under web/, and a web test reads docs/legal/product-notices.md and
# the templates the checklist links to, so a change to any of them runs the web tests (web/scripts/checklist/generate.test.ts).
# The gold set's test reads the notices and the checklist and builds on the fixture, its PDF maker, the catalog, the
# eval parser, the matter build, the case guard and the room config, so a change to any of them, or to what they import,
# runs the site's tests too. gold_inputs is kept by hand: when the test's imports change, update it, or a change to a new
# import won't run the test.
gate='\.github/workflows/ci\.yml$|\.github/scripts/changed-paths\.sh$'
web="$(changed "^(web/|docs/checklist/|docs/legal/product-notices\.md$|templates/founders/|$gate)")"
office="$(changed "^(${office_files})$")"
sync="$(changed "^(${sync_files})$")"
swift="$(changed "^(Package\\.(swift|resolved)$|Sources/|Tests/|LegallasApp/|\\.swiftlint\\.yml$|\\.github/ci/|quality-speed/pages/data-room/extract-cache/)")"
workflows="$(changed '^\.github/')"
gold_inputs='docs/legal/product-notices\.md$|docs/checklist/baseline\.toml$|web/fixtures/|web/scripts/matter/|web/scripts/dev-fixture|web/scripts/dev-pdf\.ts$'
gold_inputs+='|web/scripts/(ask-eval-(score|checks)|case-guard|config|diff|mcp-constants|mcp-oauth|sqlplan|wrangler)\.ts$'
gold_inputs+='|web/src/scripts/(formd\.test-data|sanitize)\.ts$'
gold_inputs+='|web/worker/(citations|doc-facts|doc-kinds|files-catalog|law-cite|matter|matter-fields|matter-types|passages|room-settings|sql|stored-name)\.ts$'
# web/package-lock.json: the site's TypeScript and Node types pins follow web's (quality-speed/core/pins.test.ts, #872), so
# the bump that drifts them fails its own pull request.
quality_speed="$(changed "^(quality-speed/|web/package-lock\.json$|$gold_inputs|$gate)")"

{
    echo "web=$web"
    echo "office=$office"
    echo "sync=$sync"
    echo "swift=$swift"
    echo "workflows=$workflows"
    echo "quality_speed=$quality_speed"
    if [[ "$all" == true ]]; then echo "base="; else echo "base=$base"; fi
} >> "$GITHUB_OUTPUT"
echo "Changed areas: web=$web office=$office sync=$sync swift=$swift workflows=$workflows quality_speed=$quality_speed (all=$all)"
