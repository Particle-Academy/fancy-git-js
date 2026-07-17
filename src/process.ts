import { spawn } from "node:child_process";
import type { CommandOptions } from "./types.js";
import { GitError, classifyGitError } from "./errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: CommandOptions): Promise<ProcessResult>;
}

export class NodeProcessRunner implements ProcessRunner {
  async run(command: string, args: string[], options: CommandOptions = {}): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs)
        : undefined;
      const abort = () => child.kill();
      options.signal?.addEventListener("abort", abort, { once: true });
      child.on("error", reject);
      child.on("close", (code) => {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        if (options.signal?.aborted) return reject(new GitError("cancelled", "Git operation cancelled."));
        if (timedOut) return reject(new GitError("cancelled", "Git operation timed out."));
        const exitCode = code ?? 1;
        if (exitCode !== 0) return reject(classifyGitError(stderr || stdout, exitCode));
        resolve({ stdout, stderr, exitCode });
      });
    });
  }
}
