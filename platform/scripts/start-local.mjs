import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workerConfig = "dist/server/wrangler.json";
if (!existsSync(workerConfig)) {
  console.error("未找到生产构建，请先运行 npm run build");
  process.exit(1);
}

const localEnv = {
  ...process.env,
  NODE_ENV: "production",
  HONGSHUTAI_APP_ROOT: process.env.HONGSHUTAI_APP_ROOT || process.cwd(),
  HONGSHUTAI_DATA_ROOT: process.env.HONGSHUTAI_DATA_ROOT || process.cwd(),
  RUNTIME_MANAGER_TOKEN: process.env.RUNTIME_MANAGER_TOKEN || randomBytes(32).toString("hex"),
};
const persistenceRoot = resolve(localEnv.HONGSHUTAI_DATA_ROOT, ".wrangler/state");
const teamMode = process.env.HONGSHUTAI_TEAM_MODE || "standalone";
const teamAccessToken = process.env.HONGSHUTAI_TEAM_TOKEN || "";
const bindIp = teamMode === "host" ? "0.0.0.0" : "127.0.0.1";

const children = [
  spawn(process.execPath, [resolve(import.meta.dirname, "../runtime/manager.mjs")], { stdio: "inherit", env: localEnv }),
  spawn(
    process.execPath,
    [
      resolve(import.meta.dirname, "run-local-cli.mjs"),
      "wrangler",
      "dev",
      "--config",
      workerConfig,
      "--ip",
      bindIp,
      "--port",
      "3000",
      "--persist-to",
      persistenceRoot,
      "--log-level",
      "warn",
      "--show-interactive-dev-session=false",
      "--var",
      `RUNTIME_MANAGER_TOKEN:${localEnv.RUNTIME_MANAGER_TOKEN}`,
      "--var",
      `TEAM_MODE:${teamMode}`,
      "--var",
      `TEAM_ACCESS_TOKEN:${teamAccessToken}`,
    ],
    { stdio: "inherit", env: localEnv },
  ),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 4000).unref();
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error.message);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!closing && (code !== 0 || signal)) shutdown(code || 1);
  });
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
