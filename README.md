# pi-diff-review

This is pure slop, see: https://pi.dev/session/#d4ce533cedbd60040f2622dc3db950e2

It is my hope, that someone takes this idea and makes it gud.

Native diff review window for pi, powered by [Glimpse](https://github.com/hazat/glimpse) and Monaco.

```
pi install git:https://github.com/badlogic/pi-diff-review
```

## What it does

Adds a `/diff-review` command to pi.

The command:

1. opens a native review window
2. lets you switch between `git diff`, `last commit`, `PR diff`, and `all files` scopes
3. shows a collapsible sidebar with fuzzy file search
4. shows git status markers in the sidebar for changed files and untracked files
5. supports stacked-PR review with full PR diff, per-commit patch review, and cumulative commit review against a base branch
6. lazy-loads file contents on demand as you switch files and scopes
7. lets you draft comments on the original side, modified side, or whole file
8. inserts the resulting feedback prompt into the pi editor when you submit

## Base branch selection

`/diff-review` computes PR/base-branch scopes against a base ref.

- Auto-detection fallback order: `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`
- Explicit override (preferred when your repo uses a different integration branch):
  - `/diff-review --base develop`
  - `/diff-review --base-ref release/1.2`
  - `/diff-review develop` (single positional ref)

If you provide an explicit base ref and it cannot be resolved (or has no merge base with `HEAD`), the command fails with an error instead of silently falling back.

## Requirements

- macOS, Linux, or Windows
- Node.js 20+
- `pi` installed
- internet access for the Tailwind and Monaco CDNs used by the review window

### Windows notes

Glimpse now supports Windows. To build the native host during install you need:

- .NET 8 SDK
- Microsoft Edge WebView2 Runtime
