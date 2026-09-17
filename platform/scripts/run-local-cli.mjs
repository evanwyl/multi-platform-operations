import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [tool, ...args] = process.argv.slice(2);
const entries = {
  vinext: resolve(import.meta.dirname, "../node_modules/vinext/dist/cli.js"),
  wrangler: resolve(import.meta.dirname, "../node_modules/wrangler/bin/wrangler.js"),
};
const entry = entries[tool];
if (!entry) {
  process.stderr.write(`未知本地命令：${tool || "(empty)"}\n`);
  process.exit(2);
}
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: resolve(import.meta.dirname, ".."),
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH:
      process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
  },
});
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
