# Changelog

All notable changes to `@particle-academy/fancy-git` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0: breaking changes land in MINOR releases.** Read the entry, not the
> version number.

> **History before 0.2.0 is not recorded here.** This file starts at the release
> that introduced it; earlier versions are described by their git tags.

## [Unreleased]

### Security

- **`NodeProcessRunner` now runs `git` by absolute path.** On Windows a bare `git`
  could run a same-named executable from the current directory instead of the
  real program, so a repository could decide what ran when a process was started
  inside it. The runner now finds `git` on `PATH` once per process, reading only
  absolute entries, and never the current directory or the repository. If it
  finds none it fails with a `GitError` (`not_found`) rather than falling back.
  A batch-file `git` was already never run by this package and still is not; the
  error now says so when it is all that `PATH` holds.

  **What you must do:** nothing, unless the only `git` you have is in the current
  directory or on a relative `PATH` entry. Then add it to `PATH` by absolute path,
  or pass a `ProcessRunner` that calls your own copy. A custom `ProcessRunner`
  keeps working unchanged: it still receives the name `git`.

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
