#!/usr/bin/env bash
# Tests for claude-settings.sh: the settings it writes for claude.yml never let a sandboxed command or a file tool write
# the runner's command files (later steps run what GITHUB_ENV and GITHUB_PATH say, outside the sandbox) or Claude's
# config folder. Reads only what it writes in a temp folder; needs jq. `checks` in ci.yml runs it when .github/ changes.
set -uo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/claude-settings.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0

# The layout of a GitHub-hosted job, as claude.yml sets it up.
temp="$work/_temp"
commands="$temp/_runner_file_commands"
workspace="$work/repo/repo"
config="$temp/home/.claude"
mkdir -p "$commands" "$workspace" "$config"
export RUNNER_TEMP="$temp" HOME="$temp/home" CLAUDE_CONFIG_DIR="$config"
export GITHUB_ENV="$commands/set_env_1" GITHUB_PATH="$commands/add_path_1"
export GITHUB_OUTPUT="$commands/set_output_1" GITHUB_STATE="$commands/save_state_1"
out="$work/settings.json"

check() {
  if [[ "$2" == 0 ]]; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

"${BASH:-bash}" "$script" agent "$workspace" "$out" >/dev/null
check "writes the settings" $?

# writable <path>: true when a sandboxed command may write it: under an allowWrite entry and under no denyWrite entry.
writable() {
  jq -e --arg p "$1" '
    def under($dirs): any($dirs[]; . as $d | $p == $d or ($p | startswith($d + "/")));
    .sandbox.filesystem as $fs | under($fs.allowWrite) and (under($fs.denyWrite // []) | not)' "$out" >/dev/null
}

for path in "$GITHUB_ENV" "$GITHUB_PATH" "$GITHUB_OUTPUT" "$GITHUB_STATE" "$commands/new_file" "$config/settings.json" "$config/CLAUDE.md"; do
  writable "$path"
  check "a sandboxed command can't write ${path#"$work"/}" "$(( $? == 0 ))"
done
for path in "$workspace/web/package.json" "$temp/claude-sandbox/npm-cache/index"; do
  writable "$path"
  check "a sandboxed command can write ${path#"$work"/}" $?
done
for path in "$temp/home/.npm/_cacache" "$temp/claude-settings.json"; do
  writable "$path"
  check "the rest of the job's temp folder stays read-only: ${path#"$work"/}" "$(( $? == 0 ))"
done

for dir in "$commands" "$config"; do
  jq -e --arg rule "Edit(/$dir/**)" '.permissions.deny | index($rule) != null' "$out" >/dev/null
  check "the file tools can't edit ${dir#"$work"/}" $?
done

test -d "$temp/claude-sandbox"
check "the sandbox's own folder exists" $?

# A checkout inside a folder no tool may write could never be edited: refused instead.
"${BASH:-bash}" "$script" agent "$config/repo" "$work/refused.json" >/dev/null 2>&1
check "refuses a workspace inside Claude's config folder" "$(( $? == 0 ))"

if [[ "$failures" != 0 ]]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all claude-settings.sh checks passed"
