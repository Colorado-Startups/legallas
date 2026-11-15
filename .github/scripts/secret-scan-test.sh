#!/usr/bin/env bash
# Tests for secret-scan.sh. Each case plants one way past the scan in a throwaway
# repository and runs the real script and the real gitleaks over it. The secret is
# random and built at run time, so this file never holds anything a scan would flag.
# Run with `.github/scripts/secret-scan-test.sh` (`checks` in ci.yml runs it when
# anything under .github/ changes). It downloads gitleaks once, so it belongs in CI.
set -uo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/secret-scan.sh"
root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
log="$work/scan.log"
secret="ghp_$(openssl rand -hex 18)"
# For the rule that judges a value by its words and entropy, where a random one is sometimes excused.
plain_value="7Qx""Zj9Kp2Vw8Rt4Ym6Nb3Lc5Hd7Fg1Sz"
failures=0
passes=0

# A new repository with one clean commit; base is that commit, and the shell is left inside.
new_repo() {
    cd "$(mktemp -d "$work/repo.XXXXXX")" || exit 1
    git init -q -b main
    git config user.name "Secret scan test"
    git config user.email "test@example.invalid"
    git config commit.gpgsign false
    echo "Nothing to see" >start.txt
    save "start"
    base="$(git rev-parse HEAD)"
}

save() {
    git add -A
    git commit -q -m "$1"
}

scan_pr() {
    EVENT_NAME=pull_request PR_BASE_SHA="${1:-$base}" PR_HEAD_SHA="$(git rev-parse HEAD)" bash "$script" >"$log" 2>&1
}

scan_all() {
    env -u EVENT_NAME bash "$script" >"$log" 2>&1
}

result() {
    if [[ "$2" == ok ]]; then
        passes=$((passes + 1))
        echo "ok    $1"
    else
        failures=$((failures + 1))
        echo "FAIL  $1: $2"
        sed 's/^/      /' "$log"
    fi
}

# found <name> <exit status>: the scan failed because gitleaks reported the planted secret.
found() {
    if [[ "$2" -eq 0 ]]; then result "$1" "the scan passed"
    elif ! grep -q 'leaks found' "$log"; then result "$1" "the scan failed for another reason"
    else result "$1" ok; fi
}

# refused <name> <exit status> <text>: the scan refused to run and said why.
refused() {
    if [[ "$2" -eq 0 ]]; then result "$1" "the scan passed"
    elif ! grep -qF "::error::" "$log" || ! grep -qF "$3" "$log"; then result "$1" "no refusal naming $3"
    else result "$1" ok; fi
}

# stopped <name> <exit status>: the scan failed, however it went about it.
stopped() {
    if [[ "$2" -eq 0 ]]; then result "$1" "the scan passed"
    else result "$1" ok; fi
}

# passed <name> <exit status> <text>: the scan passed and the log holds the text.
passed() {
    if [[ "$2" -ne 0 ]]; then result "$1" "the scan failed"
    elif ! grep -qF "$3" "$log"; then result "$1" "no $3 in the log"
    else result "$1" ok; fi
}

# What a clean scan has to do.
new_repo; echo "Still nothing" >notes.txt; save "notes"
scan_pr; passed "a clean pull request passes" $? "Read 1 commits"

new_repo; git rm -q start.txt; save "delete"
scan_pr; passed "a pull request that only deletes has nothing to read, and passes" $? "0 in this range"

new_repo; printf '\000binary\n' >picture.png; save "image"; image_base="$(git rev-parse HEAD)"; git mv picture.png moved.png; save "move"
scan_pr "$image_base"; passed "a pull request that only moves a binary passes" $? "0 in this range"

new_repo; printf '\000binary\n' >picture.png; save "image"; image_base="$(git rev-parse HEAD)"; chmod +x picture.png; save "mode"
scan_pr "$image_base"; passed "a pull request that only changes a binary's mode passes" $? "0 in this range"

new_repo; echo "*.riv binary" >.gitattributes; echo "Art" >art.riv; save "art"; image_base="$(git rev-parse HEAD)"; git mv art.riv moved.riv; save "move"
scan_pr "$image_base"; passed "a pull request that only moves a .riv passes" $? "0 in this range"

new_repo; printf '\000binary\n' >picture.png; save "image"; image_base="$(git rev-parse HEAD)"; git mv picture.png moved.png; save "move"; echo "Still nothing" >notes.txt; save "notes"
scan_pr "$image_base"; passed "moving a binary beside a text commit counts only the text commit" $? "Read 1 commits"

new_repo; ln -s start.txt link.txt; save "link"; link_base="$(git rev-parse HEAD)"; rm link.txt; : >link.txt; save "link to empty file"
scan_pr "$link_base"; passed "a pull request that only turns a symlink into an empty file passes" $? "0 in this range"

# A secret is found wherever an ordinary commit puts it.
new_repo; echo "$secret" >notes.txt; save "secret"
scan_pr; found "a pull request's secret" $?

new_repo; echo "$secret" >notes.txt; save "secret"; git rm -q notes.txt; save "removed again"
scan_pr; found "a secret added and removed inside the pull request" $?

new_repo; echo "$secret" >notes.txt; save "secret"; git rm -q notes.txt; save "removed again"
scan_all; found "a secret in old history, on a whole-history scan" $?

new_repo; echo "$secret" >notes.txt; save "secret"
EVENT_NAME=push PUSH_BEFORE="$base" bash "$script" >"$log" 2>&1; found "a push's secret" $?

# A comment or a file in the pull request can't excuse it.
new_repo; echo "token = \"$secret\" # gitleaks"":allow" >notes.txt; save "secret"
scan_pr; found "an inline allow comment" $?

new_repo; echo "api_key = \"$plain_value\" # --mount=type=secret," >notes.txt; save "a comment one rule's allow-list reads"
scan_pr; found "a comment that satisfies a rule's allow-list for the line" $?

new_repo; echo "api_key = \"$plain_value\" # import {x} from 'y'" >notes.txt; save "another"
scan_pr; found "a comment shaped like an import, the same way" $?

new_repo; echo "$secret" >notes.txt; save "secret"
echo "$(git rev-parse HEAD):notes.txt:github-pat:1" >.gitleaksignore; save "ignore"
scan_pr; refused "a .gitleaksignore with the fingerprint" $? ".gitleaksignore"

new_repo; echo "$secret" >notes.txt; echo 'title = "x"' >.gitleaks.toml; save "secret and config"
scan_pr; refused "a .gitleaks.toml" $? ".gitleaks.toml"

new_repo; mkdir folder; echo "x" >folder/.gitleaksignore; save "ignore in a folder"
scan_pr; refused "a .gitleaksignore in a folder" $? ".gitleaksignore"

# A pull request can't mark a file so that a review diff skips it.
new_repo; echo "notes.txt -diff" >.gitattributes; echo "$secret" >notes.txt; save "hidden"
scan_pr; refused "a .gitattributes -diff line" $? "notes.txt -diff"

new_repo; echo "notes.txt -diff=x" >.gitattributes; echo "$secret" >notes.txt; save "hidden"
scan_pr; refused "a .gitattributes -diff=x line, which git reads as -diff" $? "notes.txt -diff=x"

new_repo; echo "notes.txt binary" >.gitattributes; echo "$secret" >notes.txt; save "hidden"
scan_pr; refused "a .gitattributes binary line" $? "notes.txt binary"

new_repo; printf '[attr]quiet -diff\nnotes.txt quiet\n' >.gitattributes; echo "$secret" >notes.txt; save "hidden"
scan_pr; refused "a .gitattributes macro" $? "[attr]quiet -diff"

new_repo; mkdir folder; echo "notes.txt -diff" >folder/.gitattributes; echo "$secret" >folder/notes.txt; save "hidden"
scan_pr; refused "a .gitattributes in a folder" $? "notes.txt -diff"

new_repo; folder="$(printf 'caf\303\251')"; mkdir "$folder"; echo "notes.txt -diff" >"$folder/.gitattributes"; echo "$secret" >"$folder/notes.txt"; save "hidden"
scan_pr; refused "a .gitattributes in a folder with a non-ASCII name" $? "notes.txt -diff"

new_repo; mkdir -- -x; echo "notes.txt -diff" >-x/.gitattributes; echo "$secret" >-x/notes.txt; save "hidden"
scan_pr; refused "a .gitattributes in a folder whose name starts with a dash" $? "notes.txt -diff"

new_repo; mkdir -p x/web; echo "web/package-lock.json -diff" >x/.gitattributes; echo "$secret" >x/web/package-lock.json; save "hidden"
scan_pr; refused "a known line in a folder's .gitattributes, where it means another file" $? "web/package-lock.json -diff"

new_repo; mkdir x; ln -s nowhere x/.gitattributes; save "unreadable"
scan_pr; refused "a .gitattributes that can't be read" $? "Couldn't read"

new_repo; echo ".gitattributes -diff" >.gitattributes; save "hides itself"
scan_pr; refused "a .gitattributes marking itself" $? ".gitattributes -diff"

# The lines that are allowed still don't hide anything from the scan.
new_repo; mkdir web; echo "web/package-lock.json linguist-generated=true -diff" >.gitattributes
echo "$secret" >web/package-lock.json; save "secret in the lockfile"
scan_pr; found "the real lockfile's -diff line" $?

new_repo; echo "*.riv binary" >.gitattributes; echo "$secret" >art.riv; save "secret in art"
scan_pr; found "the *.riv binary line" $?

# Its bytes or its name can't take a file out of the scan.
new_repo; printf '\000%s\n' "$secret" >notes.dat; save "leading NUL"
scan_pr; found "a leading NUL byte" $?

new_repo; printf '\211PNG\r\n\032\n\000\000\000\r%s\n' "$secret" >picture.png; save "image"
scan_pr; found "an image with a real PNG header" $?

new_repo; echo "$secret" >package-lock.json; save "lockfile"
scan_pr; found "a package-lock.json" $?

new_repo; mkdir -p node_modules/x; echo "$secret" >node_modules/x/index.js; save "vendored"
scan_pr; found "a node_modules folder" $?

new_repo; echo "$secret" >report.pdf; save "pdf"
scan_pr; found "a .pdf" $?

new_repo; mkdir -p x/@octokit/auth-token; echo "$secret" >x/@octokit/auth-token/README.md; save "a name one rule skips"
scan_pr; found "a path on one rule's own allow-list" $?

new_repo; echo "SRC_API_KEY = \"$plain_value\"" >recipe.inc; save "a recipe"
scan_pr; found "a path and line that one rule's allow-list excuses together" $?

# Nor can how it got into history.
new_repo; git switch -q -c side; echo "side" >side.txt; save "side"; git switch -q main
echo "main" >main.txt; save "main"; git merge -q --no-commit --no-ff side
echo "$secret" >notes.txt; save "merge with a secret of its own"
scan_pr; found "a secret only in a merge commit" $?

new_repo; git switch -q -c side; echo "side" >side.txt; save "side"; git switch -q main
echo "main" >main.txt; save "main"; git merge -q --no-commit --no-ff side
echo "$secret" >notes.txt; save "merge with a secret of its own"
scan_all; found "a secret only in a merge commit, on a whole-history scan" $?

new_repo; ln -s start.txt notes.txt; save "a link"; link_base="$(git rev-parse HEAD)"
rm notes.txt; echo "$secret" >notes.txt; save "the link becomes a file"
scan_pr "$link_base"; found "a link turned into a file" $?

new_repo; ln -s start.txt notes.txt; save "a link"
rm notes.txt; echo "$secret" >notes.txt; save "the link becomes a file"; git rm -q notes.txt; save "gone"
scan_all; found "a link turned into a file, on a whole-history scan" $?

# Nor is a diff the only place a commit can hold one.
new_repo; echo "Still nothing" >notes.txt; git add -A; git commit -q -m "Notes" -m "$secret"
scan_pr; found "a secret in a commit message" $?

new_repo; echo "Still nothing" >notes.txt; git add -A; git commit -q -m "%PDF-1.7" -m "$secret"
scan_pr; found "a secret in a commit message that opens like a PDF" $?

new_repo; echo "Still nothing" >notes.txt; git add -A; git commit -q -m "$(printf '%256s' '' | tr ' ' a)ustar" -m "$secret"
scan_pr; found "a secret in a commit message shaped like a tar file" $?

new_repo; echo "Still nothing" >notes.txt; git add -A; GIT_AUTHOR_NAME="$secret" git commit -q -m "Notes"
scan_pr; found "a secret as the author's name" $?

new_repo; echo "Still nothing" >notes.txt; git add -A; GIT_COMMITTER_EMAIL="$secret@example.invalid" git commit -q -m "Notes"
scan_pr; found "a secret in the committer's email" $?

new_repo; touch "$secret.txt"; save "an empty file"
scan_pr; found "a secret in the name of an empty file" $?

new_repo; git switch -q -c side; echo "side" >side.txt; save "side"; git switch -q main
echo "main" >main.txt; save "main"; git merge -q --no-commit --no-ff side
touch "$secret.txt"; save "merge"
scan_pr; found "a secret in a file name only a merge commit adds" $?

# A scan that read too little fails.
new_repo; echo "Still nothing" >notes.txt; save "notes"
EVENT_NAME=pull_request PR_BASE_SHA="0123456789012345678901234567890123456789" PR_HEAD_SHA="$(git rev-parse HEAD)" bash "$script" >"$log" 2>&1
refused "a pull request's base that doesn't resolve" $? "isn't a commit"

new_repo; echo "Still nothing" >notes.txt; save "notes"
EVENT_NAME=pull_request PR_BASE_SHA="$base" PR_HEAD_SHA="0123456789012345678901234567890123456789" bash "$script" >"$log" 2>&1
refused "a pull request's head that doesn't resolve" $? "isn't a commit"

# die_on <text>: a folder holding a git that dies when its arguments hold the text.
real_git="$(command -v git)"
die_on() {
    local dir
    dir="$(mktemp -d "$work/shim.XXXXXX")"
    cat >"$dir/git" <<EOF
#!/usr/bin/env bash
if [[ " \$* " == *" $1 "* ]]; then
    echo "fatal: planted by secret-scan-test.sh" >&2
    exit 128
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$dir/git"
    echo "$dir"
}

new_repo; echo "Still nothing" >notes.txt; save "notes"
PATH="$(die_on "ls-files -z"):$PATH" scan_pr; stopped "the list of .gitattributes files failing" $?

# gitleaks is the only caller of `git log -p -U0`, so this makes only its read of history die.
shim="$(die_on -U0)"
new_repo; echo "Still nothing" >notes.txt; save "notes"
PATH="$shim:$PATH" scan_pr; refused "gitleaks exiting 0 when git log dies" $? "scanned 0 commits"

new_repo; printf '\000%s\n' "Still nothing" >notes.dat; save "only a binary"
PATH="$shim:$PATH" scan_pr; refused "the same, when the pull request only adds a file with a NUL byte" $? "scanned 0 commits"

new_repo; echo "*.riv binary" >.gitattributes; save "attributes"; riv_base="$(git rev-parse HEAD)"; echo "Still nothing" >art.riv; save "only art"
PATH="$shim:$PATH" scan_pr "$riv_base"; refused "the same, when it only adds a .riv" $? "scanned 0 commits"

new_repo; git switch -q -c side; git commit -q --allow-empty -m "an empty side"; git switch -q main
git merge -q --no-commit --no-ff side; echo "Still nothing" >notes.txt; save "only a merge holds text"
PATH="$shim:$PATH" scan_pr; refused "the same, when only a merge commit holds text" $? "scanned 0 commits"

new_repo; ln -s start.txt notes.txt; save "a link"; link_base="$(git rev-parse HEAD)"; rm notes.txt; echo "Still nothing" >notes.txt; save "the link becomes a file"
PATH="$shim:$PATH" scan_pr "$link_base"; refused "the same, when it only turns a link into a file" $? "scanned 0 commits"

# A rule or a read added to the scan that flags what's already on this branch shows here,
# not on the next whole-history scan. One range from the first commit, so another session's
# branch can't fail this one.
cd "$root" || exit 1
EVENT_NAME=pull_request PR_BASE_SHA="$(git rev-list --max-parents=0 HEAD | tail -n 1)" PR_HEAD_SHA="$(git rev-parse HEAD)" bash "$script" >"$log" 2>&1
passed "this repository's own history reads clean" $? "no leaks found"

echo
echo "$passes passed, $failures failed"
[[ "$failures" -eq 0 ]]
