# Changelog

All notable changes to `@particle-academy/fancy-git` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0: breaking changes land in MINOR releases.** Read the entry, not the
> version number.

> **History before 0.2.0 is not recorded here.** This file starts at the release
> that introduced it; earlier versions are described by their git tags.

## [Unreleased]

### Fixed

- **`CHANGELOG.md` is now in the published tarball.** `files` did not whitelist it, so npm never shipped it — and this package puts breaking changes in MINOR releases and tells you in the README to read the entry before taking one. The instruction existed for the author, who has the file, and not for the consumer, who is the only one being instructed. Nothing for you to do; the file simply arrives from this release on.

## [0.3.1] — 2026-09-13

### Fixed

- **Error-message redaction no longer blanks ordinary provider text.** It removed
  the word after any "token", "password" or "Bearer", so GitLab's
  "Token scope insufficient" reached you as "[REDACTED] insufficient", and
  "use a token instead of a password" lost half its words. Redaction now matches
  credentials by their shape or their context instead.

  **What you must do:** nothing, unless you matched on the old output. A redacted
  header now keeps its name and scheme — `Authorization: Bearer [REDACTED]`
  rather than `Authorization: [REDACTED]` — so a test asserting the old string
  needs the new one.

### Security

- **Redaction now catches secrets it used to let through:** a `PRIVATE-TOKEN:`,
  `JOB-TOKEN:` or `DEPLOY-TOKEN:` header whose value has no `glpat-` prefix,
  `Authorization: Basic …`, credentials in a query string or assignment
  (`private_token=`, `access_token=`, `password=`, `client_secret=`), GitHub
  fine-grained PATs (`github_pat_…`), and GitLab's other token kinds (`glcbt-`,
  `gldt-`, `gloas-`, `glrt-`, `glptt-`, `glft-` and the rest). Classic GitHub
  tokens, `glpat-`, bearer values and URL userinfo are still caught.

  **What you must do:** nothing. The cases are pinned in
  `tests/fixtures/redaction-cases.json`, shared byte-for-byte with
  `particle-academy/fancy-git` 0.3.1 so the PHP and Node runtimes redact
  identically.

## [0.3.0] — 2026-08-07

### Changed

- **BREAKING — Node 20 is no longer supported.** `engines.node` moves from `>=20` to `>=22`.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.


## [0.2.0] - 2026-07-31

### Added

- **`IssueProvider` — issue tracking, as an OPTIONAL capability.**
  `listIssues`, `getIssue`, `createIssue`, `updateIssue`, `commentOnIssue`, plus
  the `Issue` / `IssueDetails` / `CreateIssueInput` / `UpdateIssueInput` /
  `IssueQuery` types and a `supportsIssues()` guard.

  **No action required, and nothing breaks.** It is deliberately a *separate*
  interface rather than five methods added to `GitProvider`: that interface is
  implemented by every provider, including ones outside this package, and adding
  to it would break each of them at compile time for a capability many hosts do
  not offer. A self-hosted remote with no tracker is a perfectly good
  `GitProvider`.

  An adapter opts in, and a caller asks before reaching for it:

  ```ts
  import { supportsIssues } from "@particle-academy/fancy-git";

  if (supportsIssues(provider)) {
    await provider.createIssue(ref, { title: "Broken" });
  }
  ```

  The normalized shape is thinner than any one host's model on purpose. GitHub
  has milestones and state reasons, GitLab has weights and epics, Bitbucket has
  kinds and priorities — none of which survive a move between hosts. What they
  all agree on is normalized; the rest belongs in `extensions`, where a consumer
  that knows its host can reach it without the contract pretending it is
  portable.

  Implemented by `@particle-academy/fancy-git-github` 0.2.0. The GitLab and
  Bitbucket adapters do not implement it yet, and `supportsIssues()` reports
  that honestly rather than failing at call time.

[0.2.0]: https://github.com/Particle-Academy/fancy-git-js/releases/tag/v0.2.0
