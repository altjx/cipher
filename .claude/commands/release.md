# Release Command

Execute the automated release process for Cipher. This command should:

1. Check for uncommitted changes and stop if the worktree is dirty.
2. Analyze merged PRs since the last tag using `./scripts/release.sh`.
3. Fall back to conventional commit analysis when PR data is unavailable.
4. Build user-facing release notes.
5. Update `electron/package.json`, `electron/package-lock.json`, and `CHANGELOG.md`.
6. Commit the release, create a git tag, push both, and publish a GitHub Release.

## Instructions for Claude

You are executing Cipher's release process. Follow these steps.

### Step 1: Verify Repository State

Run:

```bash
git status --porcelain
```

If the output is not empty, stop and ask the user how to proceed. Do not release from a dirty worktree.

### Step 2: Run Release Analysis

Run:

```bash
./scripts/release.sh
```

Parse the output between `RELEASE_DATA_START` and `RELEASE_DATA_END`.

Extract:
- `CURRENT_VERSION`
- `NEW_VERSION`
- `BUMP_TYPE`
- `DATA_SOURCE`
- `CHANGELOG_ENTRY`
- `COMMITS`
- `RICH_COMMIT_DATA`
- `PR_DATA`

If `BUMP_TYPE=none`, stop and tell the user there is nothing releasable since the last tag.

### Step 3: Humanize the Changelog

Use `.claude/agents/changelog-humanizer.md`.

If `DATA_SOURCE=prs`, prefer `PR_DATA`. Each PR should produce a single changelog entry.

Map types to sections:
- `feat` -> `### Added`
- `fix` -> `### Fixed`
- `perf` -> `### Performance`
- `docs` -> `### Documentation`
- `refactor`, `style` -> `### Changed`
- `chore`, `test`, `ci` -> `### Maintenance`

If the humanizer returns `SKIP: Internal change with no user-facing impact`, omit it.

Construct the final changelog block in this format:

```md
## [NEW_VERSION] - YYYY-MM-DD

### Added
- ...

### Fixed
- ...
```

### Step 4: Show Preview and Confirm

Show the version bump and the final changelog block. Ask the user for approval before writing files or creating a release.

### Step 5: Update Version Files

From the repository root, run:

```bash
npm --prefix electron version NEW_VERSION --no-git-tag-version
```

This updates both `electron/package.json` and `electron/package-lock.json`.

Update `CHANGELOG.md` by:
- keeping the `## [Unreleased]` section at the top
- inserting the new release entry immediately after `## [Unreleased]`
- updating comparison links at the bottom

### Step 6: Commit Release Changes

Run:

```bash
git add CHANGELOG.md electron/package.json electron/package-lock.json
git commit -m "chore(release): bump version to vNEW_VERSION"
```

### Step 7: Tag and Push

Run:

```bash
git tag -a vNEW_VERSION -m "Release vNEW_VERSION"
git push origin main
git push origin vNEW_VERSION
```

### Step 8: Publish GitHub Release

Run:

```bash
gh release create vNEW_VERSION \
  --title "Release vNEW_VERSION" \
  --notes-file /tmp/cipher-release-notes.md \
  --latest
```

Write the final changelog block to `/tmp/cipher-release-notes.md` before invoking `gh release create`.

If `gh` is unavailable or unauthenticated, stop after pushing the tag and tell the user the GitHub Release must be created manually.

### Step 9: Confirm Success

Report:
- old version -> new version
- release tag
- commit SHA
- whether the GitHub Release was published successfully
