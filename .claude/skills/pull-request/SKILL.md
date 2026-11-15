---
name: pull-request
description: Open, update or merge a pull request in the Legallas repo safely when several agent sessions work in parallel. Use before the first push of a branch, before every follow-up push, and when asked to merge.
---

# Pull requests in Legallas

Several sessions push to this repo at once, and pull requests can merge minutes
after they open. Each step below prevents a mistake that has already happened.

## Before starting

```bash
git fetch origin
gh pr list -R Colorado-Startups/legallas --state open --json number,headRefName,files --jq '.[] | "\(.number) \(.headRefName) \([.files[].path] | join(","))"'
```

If an open pull request touches the same files, coordinate or wait; do not
build a competing change. Work in your own worktree (`CLAUDE.md`, "Start here").

## Branch and commit

- Branch from `origin/main` as `claude/<topic>`. Never commit to `main`; the
  ruleset rejects direct pushes.
- Commit with `git commit -s`: `dco` needs a `Signed-off-by` line on every commit.
  Commits are signed automatically. Never pass `--no-gpg-sign`,
  `-c commit.gpgsign=false` or `--no-verify`. If signing fails or the hook refuses
  a push, stop and read why.
- To catch up with `main` or squash your own commits, use `git rebase` onto a
  fresh `origin/main`. Don't use `gh pr update-branch`: GitHub's commit carries no
  `Signed-off-by` line. Don't use `git reset --soft origin/main`: when
  `origin/main` has moved, that turns your commit into a revert of other people's
  pull requests.
- No em dashes in code, comments, docs, commit messages or PR text.
- End commit messages with the `Co-Authored-By` line the session gives you, and its
  `Claude-Session` line when it gives one: it tells one session's follow-up to its own
  work apart from another session's planned change to the same lines.

## Before every push

```bash
git diff --stat origin/main...HEAD
```

The list must contain only your files. CI minutes are limited: batch your
commits, push when you expect green, and don't rerun jobs without a reason. Then
confirm the pull request is still open; pushing to a merged branch recreates it
as an orphan:

```bash
gh pr view <n> -R Colorado-Startups/legallas --json state --jq .state
```

If it says `MERGED` or `CLOSED`, open a new branch from `origin/main` instead.

## Opening

Fill in `.github/pull_request_template.md` (what, why, how it was verified). The Verified
row shows each check run and its output, never "done" alone: the Claude Code page counts
an empty row as a broken rule. Write `Closes #<n>` for each issue the pull request fixes,
one per line, so the merge closes it. Never close a fixed issue by hand: the Issues page
counts each completed close whose last close names no merged commit (`closed_by_hand`).
If one slipped through, reopen it and close it from a pull request.

Describe the need in general terms, with no case detail. The pre-push hook never
sees pull request, issue or comment text, so write it to a file, scan it, and post
that file. The scan prints counts, never the words; exit 1 means a match: reword.

```bash
node web/scripts/case-text-scan.ts draft <file>
gh pr create -R Colorado-Startups/legallas --body-file <file>   # or gh pr edit <n> --body-file, gh issue comment <n> --body-file
```

Keep its two lines filled in, because the Insights page reads them:

- `Issue:` what the change works toward: `#<n>` for a bug or quick fix, or the
  link to the card on the org's Project board for a feature or improvement
  (`CLAUDE.md`, "Start here").
- `Repairs: #<n>` when the change fixes or reverts a pull request that has
  already merged; `Repairs: a bug` for any other bug fix; otherwise `Repairs: none`.

## Token line

The Claude Code page reads each session's token count from its pull request. Run this
once, after your last push and before you hand the pull request over or queue the merge
(`--pr <n>` when your branch isn't the pull request's). It costs two API calls:

```bash
node quality-speed/pages/claude-code/session-line.ts
```

It adds or updates this session's one line in the description. Leave the line as it is.

## Checks

Required checks: `ci-ok` (`.github/workflows/ci.yml`; a Mac job skipped because
nothing in its area changed counts as passed) and `dco`. It need not be up to date
with `main`: the merge queue tests it merged onto `main`. Rebase onto a fresh
`origin/main` when it conflicts.

## Waiting for checks

Every session on this Mac shares one login's 5,000 GitHub API calls an hour,
and polling can use them all. Check a run once, when it should be
done (CI takes about 3 minutes); never `gh run watch`,
`gh pr checks --watch` or a `sleep` loop. To read the same thing again soon,
use `gh api --cache 5m <path>`, which answers from a local copy.

## Merging

Merge rule (`CLAUDE.md`): required checks (`ci-ok`, `dco`) green on the head, then
the merge queue (squash). Queue it with the head pinned, so a push in between fails
instead of slipping in:

```bash
gh pr merge <n> --squash --match-head-commit <sha>
```

The queue runs CI on the pull request merged onto `main`, with any pull requests
ahead of it, and merges only when that passes. A push to the head drops it from the
queue. If the queue's run fails, or it can't merge cleanly, it leaves the queue:
rebase onto a fresh `origin/main` and queue it again.

A failing required check is never merged around, by `--admin` or otherwise.

## Never

Deploy, publish, sync or change repository settings, rulesets or secrets from a
pull request task, unless your task says to. Creating a key or token is the
owner's step.
