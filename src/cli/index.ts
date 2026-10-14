#!/usr/bin/env node
/**
 * schoolsoft-agent — CLI entry point (also what the skill's scripts call).
 */
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { runCli } from "./program.js";
import { loadContext } from "../shared/bootstrap.js";
import { PACKAGE_VERSION } from "../shared/version.js";

async function main(): Promise<void> {
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stderr })
    : null;
  const code = await runCli(process.argv.slice(2), {
    getContext: (overrides) =>
      loadContext({ env: process.env, home: homedir(), platform: process.platform, overrides })(),
    stdout: (s) => process.stdout.write(s + "\n"),
    stderr: (s) => process.stderr.write(s + "\n"),
    env: process.env,
    home: homedir(),
    platform: process.platform,
    version: PACKAGE_VERSION,
    isTTY: process.stdout.isTTY === true,
    columns: process.stdout.columns,
    prompt: rl ? (q) => rl.question(q) : undefined,
    detach: (argv) => {
      const child = spawn(process.execPath, [process.argv[1], ...argv], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      return child.pid ?? 0;
    },
  });
  rl?.close();
  process.exitCode = code;
  // A handle left open after the result (a CDP socket to the user's own
  // browser) must not keep the CLI alive. Unref'd: a clean exit is not delayed.
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
}

/** How long a finished CLI run may linger on open handles before it exits. */
const EXIT_GRACE_MS = 5000;

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : e}\n`);
  process.exitCode = 1;
});
