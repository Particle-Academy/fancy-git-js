# Using @particle-academy/fancy-git — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm install @particle-academy/fancy-git
```

- **Node:** `>=22`. No runtime dependencies; it runs the system `git`.
- Hosted-provider access is in separate adapters, each with fancy-git as a peer:
  `@particle-academy/fancy-git-github`, `@particle-academy/fancy-git-gitlab`,
  `@particle-academy/fancy-git-bitbucket`.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). This package is the registry entry `fancy-git-js`; the
adapters are `fancy-git-github-js`, `fancy-git-gitlab-js` and
`fancy-git-bitbucket-js`. Server-side packages are found with
`search-backend-packages` (stack `node`); `install-instructions` gives the exact
commands for a slug. The UI surfaces for this data are in
`@particle-academy/fancy-git-ui` (`search-components`).

## API essentials

```ts
import { GitRepository, ProviderRegistry } from "@particle-academy/fancy-git";

const repository = new GitRepository(process.cwd());
const status = await repository.status();

// An agent proposes; nothing changes until it is applied.
const proposal = await repository.commit("Fix typo", { pendingMode: "propose" });
```

- `GitRepository` reads: `info`, `status`, `log`, `diff`, `branches`. Mutations:
  `stage`, `unstage`, `commit`, `checkout`, `fetch`, `pull`, `push`. Every call
  takes `signal` / `timeoutMs`.
- Mutations accept `pendingMode: "propose"` (default `"apply"`) and then return
  an `OperationProposal` (`operation`, `arguments`, `summary`, all JSON) instead
  of changing the repository.
- `ProviderRegistry` holds `GitProvider` adapters: `register(provider)`,
  `get(kind)`, and `identify(remote)`, which returns the first adapter that
  recognises the remote together with its repository ref.
- Contract types only: `@particle-academy/fancy-git/types`. A test double:
  `StubProcessRunner` from `@particle-academy/fancy-git/testing`.
- Failures are `GitError` with a `code` (`auth`, `conflict`, `dirty_worktree`,
  `not_found`, `non_fast_forward`, `rate_limited`, ...).

## Traps

- **Which `git` runs.** `NodeProcessRunner` runs the `git` it finds on an
  absolute `PATH` entry. The current directory and the repository are never
  searched, and a batch-file `git` is not run; if nothing else is on `PATH` you
  get `GitError` code `not_found`. To use a particular git, pass your own
  `ProcessRunner` to `GitRepository`, or call `NodeProcessRunner.run()` with an
  absolute path.
- **Option-shaped input is refused.** A ref or remote starting with `-`, or a
  remote using the `ext::` / `fd::` transport helpers, throws `invalid_argument`
  rather than reaching git.
