import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import net from "node:net";

const appRoot = resolve(
  process.env.HONGSHUTAI_APP_ROOT || resolve(import.meta.dirname, ".."),
);
const dataRoot = resolve(process.env.HONGSHUTAI_DATA_ROOT || appRoot);
const backupRoot = resolve(dataRoot, "backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = resolve(
  process.argv[2] ||
    join(backupRoot, `multi-platform-content-${timestamp}.tar.gz`),
);
const managerPort = Number(process.env.HONGSHUTAI_BACKUP_MANAGER_PORT || 18100);
const workerPort = Number(process.env.HONGSHUTAI_BACKUP_WORKER_PORT || 3000);

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
  throw new Error(
    "请先完全退出多平台内容运营，再执行备份，避免复制到不一致的数据库状态",
  );
}

const sources = [
  ["database", join(dataRoot, ".wrangler/state/v3/d1")],
  ["accounts", join(dataRoot, "runtime/accounts")],
  ["platform-accounts", join(dataRoot, "runtime/platform-accounts")],
  ["config", join(dataRoot, "runtime/config")],
  ["publish-assets", join(dataRoot, "runtime/publish-assets")],
].filter(([, source]) => existsSync(source));

if (!sources.some(([name]) => name === "database"))
  throw new Error("没有找到本地数据库，请先启动并初始化平台");

mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
const staging = mkdtempSync(join(tmpdir(), "hongshutai-backup-"));
try {
  for (const [name, source] of sources)
    cpSync(source, join(staging, name), {
      recursive: true,
      preserveTimestamps: true,
    });
  const packageJson = JSON.parse(
    readFileSync(join(appRoot, "package.json"), "utf8"),
  );
  writeFileSync(
    join(staging, "manifest.json"),
    `${JSON.stringify(
      {
        format: 1,
        product: "多平台内容运营",
        appVersion: packageJson.version,
        createdAt: new Date().toISOString(),
        contents: sources.map(([name]) => name),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  mkdirSync(resolve(destination, ".."), { recursive: true, mode: 0o700 });
  const result = spawnSync("tar", ["-czf", destination, "-C", staging, "."], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("系统 tar 命令未能生成备份包");
  process.stdout.write(
    `备份完成：${destination}\n文件：${basename(destination)}\n`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
