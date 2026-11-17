# Contributing to @particle-academy/fancy-git

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Layout

- `src/types.ts` — the normalized contracts (`GitProvider`, `IssueProvider`,
  models, `GitErrorCode`), also published as the `./types` subpath.
- `src/repository.ts` — `GitRepository`, local Git operations.
- `src/process.ts`, `src/executable.ts` — `NodeProcessRunner` and how it finds
  `git`.
- `src/errors.ts` — `GitError`, `classifyGitError`, `redactSecrets`.
- `src/provider-registry.ts` — `ProviderRegistry`.
- `src/testing.ts` — `StubProcessRunner`, published as the `./testing` subpath.
- `tests/` — the vitest suite, with fixtures in `tests/fixtures/`.

## Invariants

- These packages are agent-driven: refs and remotes can come from an untrusted
  caller. A value git would parse as an option (leading `-`) or a
  command-executing transport helper (`ext::`, `fd::`) must never reach git as a
  positional argument. `src/repository.ts` rejects both with `invalid_argument`.
- The core has no GitHub, GitLab or Bitbucket SDK dependency; provider
  integrations are separate adapter packages.

## Commands

```bash
npm run build   # tsup
npm run lint    # tsc --noEmit
npm test        # vitest run
```

`prepublishOnly` runs lint, test and build in that order.

## Changelog

Update `CHANGELOG.md` (Keep a Changelog) in the same commit as the change.
