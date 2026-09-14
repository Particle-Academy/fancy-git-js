import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GitError, classifyGitError, redactSecrets } from "../src/errors.js";

/**
 * Error-message redaction, in both directions.
 *
 * The cases live in `tests/fixtures/redaction-cases.json`, a byte-for-byte copy
 * of the one fancy-git-php's RedactionTest reads, so the two runtimes are held
 * to the same table. `{}` splits token-shaped fakes so secret scanners do not
 * flag the file, and is removed here before use.
 */

interface Case {
  id: string;
  input: string;
  expected?: string;
}

const table = JSON.parse(readFileSync(new URL("./fixtures/redaction-cases.json", import.meta.url), "utf8")) as { redacts: Case[]; keeps: Case[] };
const unsplit = (value: string) => value.replaceAll("{}", "");

describe("redactSecrets", () => {
  it.each(table.redacts.map((c) => [c.id, c] as const))("redacts a real secret: %s", (_, c) => {
    const redacted = redactSecrets(unsplit(c.input));

    expect(redacted).toBe(unsplit(c.expected!));
    expect(redacted).toContain("[REDACTED]");
  });

  it.each(table.keeps.map((c) => [c.id, c] as const))("keeps ordinary provider text intact: %s", (_, c) => {
    expect(redactSecrets(unsplit(c.input))).toBe(unsplit(c.input));
  });

  it("is applied to every GitError message", () => {
    const token = unsplit("gl{}pat-FAKEfakeFAKEfake1234");

    expect(new GitError("auth", `PRIVATE-TOKEN: ${token}`).message).toBe("PRIVATE-TOKEN: [REDACTED]");
    expect(classifyGitError(`fatal: Authentication failed for 'https://oauth2:${token}@gitlab.com/a/b.git/'`).message).not.toContain(token);
    expect(new GitError("auth", "Token scope insufficient").message).toBe("Token scope insufficient");
  });
});
