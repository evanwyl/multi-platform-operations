import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import net from "node:net";

const appRoot = resolve(
  process.env.HONGSHUTAI_APP_ROOT || resolve(import.meta.dirname, ".."),
);
const dataRoot = resolve(process.env.HONGSHUTAI_DATA_ROOT || appRoot);
const archiveArg = process.argv.find(
  (value) =>
    !value.startsWith("--") &&
    value !== process.argv[0] &&
    value !== process.argv[1],
);
if (!archiveArg || !process.argv.includes("--confirm")) {
  throw new Error(
    "用法：npm run restore -- /备份路径/multi-platform-content-日期.tar.gz --confirm",
  );
}
const archive = resolve(archiveArg);
const managerPort = Number(process.env.HONGSHUTAI_BACKUP_MANAGER_PORT || 18100);
const workerPort = Number(process.env.HONGSHUTAI_BACKUP_WORKER_PORT || 3000);
if (!existsSync(archive)) throw new Error(`备份文件不存在：${archive}`);

function portOpen(port) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => resolvePort(false));
  });
}

if ((await portOpen(managerPort)) || (await portOpen(workerPort))) {
  throw new Error("请先完全退出多平台内容运营，再执行恢复");
}

const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
if (listing.status !== 0) throw new Error("备份包损坏或格式无法识别");
const entries = listing.stdout.split("\n").filter(Boolean);
if (
  entries.some(
    (entry) => entry.startsWith("/") || entry.split("/").includes(".."),
  )
)
  throw new Error("备份包包含不安全路径，已拒绝恢复");

const staging = mkdtempSync(join(tmpdir(), "hongshutai-restore-"));
const rollbackRoot = join(
  dataRoot,
  `restore-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
try {
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", staging], {
    stdio: "inherit",
  });
  if (extracted.status !== 0) throw new Error("无法解压备份包");
  const manifest = JSON.parse(
    readFileSync(join(staging, "manifest.json"), "utf8"),
  );
  if (
    manifest.format !== 1 ||
    !["红薯台", "多平台内容运营"].includes(manifest.product) ||
    !Array.isArray(manifest.contents)
  )
    throw new Error("这不是受支持的多平台内容运营备份包");
  const targets = [
    ["database", join(dataRoot, ".wrangler/state/v3/d1")],
    ["accounts", join(dataRoot, "runtime/accounts")],
    ["platform-accounts", join(dataRoot, "runtime/platform-accounts")],
    ["config", join(dataRoot, "runtime/config")],
    ["publish-assets", join(dataRoot, "runtime/publish-assets")],
  ].filter(
    ([name]) =>
      manifest.contents.includes(name) && existsSync(join(staging, name)),
  );
  if (!targets.some(([name]) => name === "database"))
    throw new Error("备份包不包含数据库");
  mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 });
  for (const [name, target] of targets) {
    if (existsSync(target)) {
      const rollback = join(rollbackRoot, name);
      cpSync(target, rollback, { recursive: true, preserveTimestamps: true });
      rmSync(target, { recursive: true, force: true });
    }
    cpSync(join(staging, name), target, {
      recursive: true,
      preserveTimestamps: true,
    });
  }
  process.stdout.write(
    `恢复完成。恢复前的数据保存在：${rollbackRoot}\n确认平台正常后可手动删除该回滚目录。\n`,
  );
} catch (error) {
  if (existsSync(rollbackRoot))
    process.stderr.write(`恢复未完成，原数据副本位于：${rollbackRoot}\n`);
  throw error;
} finally {
  rmSync(staging, { recursive: true, force: true });
}
