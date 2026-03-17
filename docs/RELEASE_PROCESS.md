# Release Process

Cipher releases are driven by conventional commits and the `/release` Claude command.

## Prerequisites

- Clean git worktree
- `gh` authenticated against the repository
- `jq` available locally for PR analysis
- Conventional commit history since the last tag

## Release Inputs

The release process inspects changes since the most recent git tag.

- Preferred source: merged pull requests on `main`
- Fallback source: conventional commits when PR metadata is unavailable

## Version Bump Rules

- `feat` -> minor
- `fix`, `perf` -> patch
- `BREAKING CHANGE:` -> major

## Files Updated During a Release

- `electron/package.json`
- `electron/package-lock.json`
- `CHANGELOG.md`

## Manual Analysis

Preview the next release without changing files:

```bash
./scripts/release.sh --dry-run
```

## Slash Command

Typing `/release` in Claude Code should:

1. Analyze merged PRs or commits.
2. Generate user-facing changelog entries.
3. Show a preview for approval.
4. Bump the Electron app version.
5. Update `CHANGELOG.md`.
6. Commit, tag, push, and publish a GitHub Release.

## First Release

If no git tag exists yet, the current version is read from `electron/package.json` and the release includes the full conventional-commit history in the repository.
