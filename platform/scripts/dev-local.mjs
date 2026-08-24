import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "runtime"], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", env: process.env }),
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
