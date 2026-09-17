import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const localEnv = {
  ...process.env,
  RUNTIME_MANAGER_TOKEN: process.env.RUNTIME_MANAGER_TOKEN || randomBytes(32).toString("hex"),
};

const children = [
  spawn(process.execPath, [resolve(import.meta.dirname, "../runtime/manager.mjs")], { stdio: "inherit", env: localEnv }),
  spawn(process.execPath, [resolve(import.meta.dirname, "run-local-cli.mjs"), "vinext", "dev", "--hostname", "127.0.0.1"], { stdio: "inherit", env: localEnv }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 4000).unref();
}

for (const child of children) child.once("exit", (code) => { if (!closing && code) shutdown(code); });
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
