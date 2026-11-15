#!/usr/bin/env bash
# Writes the Claude Code settings that confine @claude (claude.yml) to the
# checkout. It runs on GitHub-hosted Ubuntu runners, where the fence keeps a
# Claude job out of the runner's own files. The same settings confine a run on
# a Mac (claude-confinement-check.sh, run as the owner's macOS user), where without
# them Claude could read anything its account can (case files, SSH and signing
# keys, logins) and quote it into a comment or commit.
#
# Usage: claude-settings.sh agent <workspace> <output.json>
#
# - permissions.blockReadsOutsideWorkingDirectories: Read, Grep, Glob and
#   read-only Bash commands refuse every path outside the working directories
#   (the checkout plus any --add-dir), in every permission mode.
# - deny rules for the sensitive folders of the real home as a second fence
#   (HOME points at the job's private folder, so they use absolute paths).
# - hooks off.
# - the Bash sandbox (@claude may run tests): shell commands cannot read the
#   real home outside the checkout and the runner's temp folder, write anywhere
#   else, or reach any host but the npm registry; a command the sandbox blocks
#   fails instead of retrying unsandboxed.
set -euo pipefail

mode="${1:?mode: agent}"
workspace="${2:?workspace path}"
out="${3:?output path}"
temp="${RUNNER_TEMP:?RUNNER_TEMP is not set}"

case "$mode" in agent) ;; *) echo "::error::unknown mode $mode"; exit 1 ;; esac

# The account's home from the user database, not $HOME (the jobs point HOME
# at a private folder). Any other system leaves it empty and stops below.
case "$(uname -s)" in
    Darwin) real_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory | awk '{print $2}')" ;;
    Linux) real_home="$(getent passwd "$(id -un)" | cut -d: -f6)" ;;
    *) real_home="" ;;
esac
if [[ -z "$real_home" || "$real_home" == / ]]; then
    echo "::error::could not resolve the runner account's home folder"
    exit 1
fi
case "$workspace/" in
    "$real_home"/.*|"$real_home"/Library/*|"$real_home"/Documents/*|"$real_home"/Developer/*)
        echo "::error::workspace $workspace sits inside a denied folder"; exit 1 ;;
esac

# Folders of the real home a Claude job never needs. A self-hosted runner's own
# workspace (~/Runners/actions-runner-*/_work or ~/actions-runner-*/_work) stays
# outside this list; its credentials do
# not.
sensitive=(
    ".ssh/**" ".gnupg/**" ".config/**" ".claude/**" ".claude.json" ".wrangler/**"
    ".aws/**" ".npmrc" ".netrc" ".gitconfig" ".git-credentials" ".zsh_history" ".bash_history"
    "Library/**" "Documents/**" "Desktop/**" "Downloads/**" "Claude/**" "Developer/**"
    "actions-runner-*/.credentials*" "actions-runner-*/.runner" "actions-runner-*/.env"
    "Runners/actions-runner-*/.credentials*" "Runners/actions-runner-*/.runner" "Runners/actions-runner-*/.env"
)
deny=()
for path in "${sensitive[@]}"; do
    deny+=("Read(/$real_home/$path)" "Edit(/$real_home/$path)")
done
deny+=("Read(//Users/Shared/**)" "Edit(//Users/Shared/**)")

jq -n \
    --arg home "$real_home" \
    --arg workspace "$workspace" \
    --arg temp "$temp" \
    --args '{
        disableAllHooks: true,
        permissions: {
            blockReadsOutsideWorkingDirectories: true,
            deny: $ARGS.positional
        },
        sandbox: {
            enabled: true,
            failIfUnavailable: true,
            allowUnsandboxedCommands: false,
            filesystem: {
                denyRead: [$home],
                allowRead: [$workspace, $temp],
                allowWrite: [$workspace, $temp]
            },
            network: { allowedDomains: ["registry.npmjs.org"] }
        }
    }' \
    "${deny[@]}" > "$out"

echo "Claude settings ($mode) written to $out"
