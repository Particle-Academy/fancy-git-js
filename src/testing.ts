export class StubProcessRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];

  constructor(private readonly outputs: string[] = []) {}

  async run(command: string, args: string[]) {
    this.calls.push({ command, args });
    return { stdout: this.outputs.shift() ?? "", stderr: "", exitCode: 0 };
  }
}
