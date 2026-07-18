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

  describe("argument/transport injection guards", () => {
    it("rejects an ext:: transport remote in fetch/pull/push (no git invoked)", async () => {
      const runner = new StubProcessRunner();
      const repo = new GitRepository(".", runner);
      await expect(repo.fetch("ext::sh -c touch\\ pwned")).rejects.toThrow(/transport helper/);
      await expect(repo.pull("fd::7")).rejects.toThrow(/transport helper/);
      await expect(repo.push("ext::sh -c id")).rejects.toThrow(/transport helper/);
      expect(runner.calls).toHaveLength(0);
    });

    it("rejects option-like remotes and refs (no git invoked)", async () => {
      const runner = new StubProcessRunner();
      const repo = new GitRepository(".", runner);
      await expect(repo.fetch("--upload-pack=touch pwned")).rejects.toThrow(/command-line option/);
      await expect(repo.push("--receive-pack=x")).rejects.toThrow(/command-line option/);
      await expect(repo.log({ ref: "--output=/tmp/x" })).rejects.toThrow(/command-line option/);
      await expect(repo.diff({ from: "--output=/tmp/x" })).rejects.toThrow(/command-line option/);
      await expect(repo.checkout("--orphan")).rejects.toThrow(/command-line option/);
      expect(runner.calls).toHaveLength(0);
    });

    it("allows a normal remote and hardens git against the ext transport", async () => {
      const runner = new StubProcessRunner([""]);
      await new GitRepository(".", runner).fetch("origin");
      expect(runner.calls[0]!.args).toEqual([
        "-c",
        "protocol.ext.allow=never",
        "-C",
        expect.any(String),
        "--no-pager",
        "fetch",
        "--progress",
        "origin",
      ]);
    });
  });
});
