# Fancy Git

Framework-agnostic TypeScript contracts and local Git operations for the Fancy
Git package family.

```ts
import { GitRepository } from "@particle-academy/fancy-git";

const repository = new GitRepository(process.cwd());
console.log(await repository.status());
```

`NodeProcessRunner` runs the `git` it finds on an absolute `PATH` entry, once per
process. The current directory and the repository are never searched, and a
batch-file `git` is not run: if nothing else is on `PATH` you get a `GitError`
with code `not_found`. To use a particular git, give `GitRepository` your own
`ProcessRunner`, or call `NodeProcessRunner.run()` with an absolute path.

Mutations support `{ pendingMode: "propose" }`, returning a JSON-friendly
proposal without changing the repository. Provider integrations are separate
packages so the core has no GitHub, GitLab, or Bitbucket SDK dependency.
