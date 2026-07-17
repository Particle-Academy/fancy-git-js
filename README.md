# Fancy Git

Framework-agnostic TypeScript contracts and local Git operations for the Fancy
Git package family.

```ts
import { GitRepository } from "@particle-academy/fancy-git";

const repository = new GitRepository(process.cwd());
console.log(await repository.status());
```

Mutations support `{ pendingMode: "propose" }`, returning a JSON-friendly
proposal without changing the repository. Provider integrations are separate
packages so the core has no GitHub, GitLab, or Bitbucket SDK dependency.
