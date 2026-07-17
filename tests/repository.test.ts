import { describe, expect, it } from "vitest";
import { GitRepository } from "../src/repository.js";
import { StubProcessRunner } from "../src/testing.js";

describe("GitRepository", () => {
  it("parses porcelain v2 status without parsing human output", async () => {
    const runner = new StubProcessRunner([
      "# branch.head main\x00# branch.upstream origin/main\x00# branch.ab +2 -1\x001 M. N... 100644 100644 100644 a b README.md\x00? new file.txt\x00",
    ]);
    const status = await new GitRepository(".", runner).status();
    expect(status).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1, clean: false });
    expect(status.files).toEqual([
      { path: "README.md", index: "modified", worktree: null },
      { path: "new file.txt", index: null, worktree: "untracked" },
    ]);
  });

  it("returns proposals without invoking Git", async () => {
    const runner = new StubProcessRunner();
    const proposal = await new GitRepository(".", runner).stage(["a.txt"], { pendingMode: "propose" });
    expect(proposal).toMatchObject({ operation: "stage" });
    expect(runner.calls).toHaveLength(0);
  });
});
