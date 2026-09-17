import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(process.env.HONGSHUTAI_APP_ROOT || resolve(import.meta.dirname, ".."));
const dataRoot = resolve(process.env.HONGSHUTAI_DATA_ROOT || appRoot);
const version = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")).version;
const cacheParent = resolve(dataRoot, "runtime-cache");
const workerRoot = resolve(cacheParent, version);
const cacheMarker = resolve(workerRoot, ".ready");
if (!existsSync(cacheMarker)) {
  const staging = resolve(cacheParent, `.${version}.staging-${process.pid}`);
  mkdirSync(cacheParent, { recursive: true, mode: 0o700 });
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { mode: 0o700 });
  try {
    cpSync(resolve(appRoot, "dist"), resolve(staging, "dist"), { recursive: true });
    cpSync(resolve(appRoot, "node_modules"), resolve(staging, "node_modules"), { recursive: true, verbatimSymlinks: true });
    writeFileSync(resolve(staging, ".ready"), `${version}\n`, { mode: 0o600 });
    if (existsSync(workerRoot)) rmSync(workerRoot, { recursive: true, force: true });
    renameSync(staging, workerRoot);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
const token = randomBytes(32).toString("hex");
const environment = {
  ...process.env,
  NODE_ENV: "production",
  HONGSHUTAI_APP_ROOT: appRoot,
  HONGSHUTAI_DATA_ROOT: dataRoot,
  RUNTIME_MANAGER_TOKEN: token,
  XHS_MCP_BINARY: resolve(
    appRoot,
    "runtime/bin",
    process.platform === "win32"
      ? "xiaohongshu-mcp-windows-amd64.exe"
      : "xiaohongshu-mcp-darwin-arm64",
  ),
  WRANGLER_SEND_METRICS: "false",
};
const teamMode = process.env.HONGSHUTAI_TEAM_MODE || "standalone";
const teamAccessToken = process.env.HONGSHUTAI_TEAM_TOKEN || "";
const bindIp = teamMode === "host" ? "0.0.0.0" : "127.0.0.1";

mkdirSync(resolve(dataRoot, ".wrangler/state"), { recursive: true, mode: 0o700 });
const node = process.execPath;
const children = [
  spawn(node, [resolve(appRoot, "runtime/manager.mjs")], { cwd: appRoot, env: environment, stdio: "inherit" }),
  spawn(node, [
    resolve(workerRoot, "node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--config", resolve(workerRoot, "dist/server/wrangler.json"),
    "--ip", bindIp,
    "--port", "3000",
    "--persist-to", resolve(dataRoot, ".wrangler/state"),
    "--log-level", "warn",
    "--show-interactive-dev-session=false",
    "--var", `RUNTIME_MANAGER_TOKEN:${token}`,
    "--var", `TEAM_MODE:${teamMode}`,
    "--var", `TEAM_ACCESS_TOKEN:${teamAccessToken}`,
  ], { cwd: workerRoot, env: environment, stdio: "inherit" }),
];

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  const deadline = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    process.exit(code);
  }, 5000);
  deadline.unref();
  Promise.all(children.map((child) => child.exitCode === null
    ? new Promise((done) => child.once("exit", done))
    : Promise.resolve())).then(() => process.exit(code));
}

for (const child of children) {
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!closing && (code !== 0 || signal)) shutdown(code || 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
