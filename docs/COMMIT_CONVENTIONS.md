# Commit Conventions

Cipher uses [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, [Semantic Versioning](https://semver.org/) (major.minor.patch) for releases, and [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) for changelog formatting.

## Format

```text
type(scope): subject
```

The `scope` is optional but strongly recommended.

## Version Bumping

The `/release` command analyzes commits since the last git tag and bumps the version in `electron/package.json`:

| Commit type | Version bump | Changelog section |
|---|---|---|
| `feat` | **minor** (0.X.0) | Added |
| `fix` | **patch** (0.0.X) | Fixed |
| `perf` | **patch** (0.0.X) | Changed |
| `BREAKING CHANGE` footer or `!` after type | **major** (X.0.0) | _(noted in relevant section)_ |
| `docs`, `chore`, `refactor`, `style`, `test`, `ci` | no bump | _(omitted or Maintenance)_ |

Version bumps happen at release time, not on every build. `build.sh` reads the current version but does not change it.

## Valid Types

- `feat`: new user-facing features
- `fix`: bug fixes
- `perf`: performance improvements
- `docs`: documentation-only changes
- `chore`: maintenance and housekeeping
- `refactor`: code restructuring without behavior changes
- `style`: formatting or styling-only changes
- `test`: test additions or fixes
- `ci`: CI or automation changes

## Changelog Sections (Keep a Changelog)

Release notes in `CHANGELOG.md` use these sections:

- **Added** — new features (`feat`)
- **Changed** — changes to existing functionality (`refactor`, `perf`, `style`)
- **Deprecated** — features marked for future removal
- **Removed** — features that were removed
- **Fixed** — bug fixes (`fix`)
- **Security** — vulnerability patches

## Examples

```text
feat(messages): add drag-and-drop attachments
fix(pairing): recover after phone reconnects
perf(search): reduce conversation filter latency
docs(readme): add quick start instructions
chore(release): bump version to v1.1.0
```

## Breaking Changes

Use a `BREAKING CHANGE:` footer in the commit body, or append `!` after the type/scope, to trigger a major version bump:

```text
feat(api)!: redesign WebSocket event format
```

## Hook Installation

Run the following once per clone to enable the tracked commit hook:

```bash
./scripts/install-git-hooks.sh
```
