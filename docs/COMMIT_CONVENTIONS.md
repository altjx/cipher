# Commit Conventions

Cipher uses Conventional Commits so release automation can determine version bumps and build changelogs consistently.

## Format

```text
type(scope): subject
```

The `scope` is optional but strongly recommended.

## Valid Types

- `feat`: user-facing feature work, triggers a minor release
- `fix`: bug fixes, triggers a patch release
- `perf`: performance improvements, triggers a patch release
- `docs`: documentation-only changes
- `chore`: maintenance and housekeeping
- `refactor`: code restructuring without intended behavior changes
- `style`: formatting or styling-only changes
- `test`: test additions or fixes
- `ci`: CI or automation changes

## Examples

```text
feat(messages): add drag-and-drop attachments
fix(pairing): recover after phone reconnects
perf(search): reduce conversation filter latency
docs(readme): add quick start instructions
chore(release): bump version to v1.1.0
```

## Breaking Changes

Use a `BREAKING CHANGE:` footer in the commit body when a change requires a major version bump.

## Hook Installation

Run the following once per clone to enable the tracked commit hook:

```bash
./scripts/install-git-hooks.sh
```
