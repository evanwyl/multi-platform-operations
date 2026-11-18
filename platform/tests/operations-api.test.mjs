import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";

test(
  "operations API enforces authentication, account ACL and role boundaries against an isolated database",
  { timeout: 90_000 },
  async () => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((done) => listener.close(done));
    const work = await mkdtemp(resolve(tmpdir(), "operations-api-"));
    const root = resolve(import.meta.dirname, "..");
    const token = crypto.randomUUID();
    const child = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/wrangler/bin/wrangler.js"),
        "dev",
        "--config",
        resolve(root, "dist/server/wrangler.json"),
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--persist-to",
        work,
        "--log-level",
        "error",
        "--show-interactive-dev-session=false",
        "--var",
        `RUNTIME_MANAGER_TOKEN:${token}`,
        "--var",
        "TEAM_MODE:standalone",
      ],
      {
        cwd: root,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    child.stdout.on("data", (value) => {
      log += value;
    });
    child.stderr.on("data", (value) => {
      log += value;
    });
    const origin = `http://127.0.0.1:${port}`;
    const post = (path, payload, cookie = "") =>
      fetch(origin + path, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin },
        body: JSON.stringify(payload),
      });
    try {
      let ready = false;
      for (let i = 0; i < 120; i++) {
        try {
          if ((await fetch(origin + "/api/auth")).ok) {
            ready = true;
            break;
          }
        } catch {
          /* Wait for isolated worker readiness. */
        }
        await new Promise((done) => setTimeout(done, 200));
      }
      assert.ok(ready, log.slice(-2500));
      const shell = await fetch(origin + "/", {
        headers: { accept: "text/html" },
      });
      assert.equal(shell.status, 200);
      const html = await shell.text();
      assert.match(html, /<title>多平台内容运营<\/title>/);
      assert.match(html, /正在启动多平台内容运营/);
      assert.doesNotMatch(html, /codex-preview/);
      assert.equal((await fetch(origin + "/api/operations")).status, 401);
      const password = crypto.randomUUID();
      const setup = await post("/api/auth", {
        action: "setup",
        name: "测试管理员",
        username: "test_admin",
        password,
      });
      assert.equal(setup.status, 201);
      const admin = setup.headers.get("set-cookie").split(";")[0];
      const tick = await fetch(origin + "/api/operations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(tick.status, 200);
      assert.equal((await tick.json()).idle, true);
      assert.equal(
        (
          await fetch(origin + "/api/publish", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "execute_plan",
              plan_id: "missing",
            }),
          })
        ).status,
        409,
      );
      const first = await post(
        "/api/app",
        { action: "create_account", name: "测试账号一", platform: "douyin" },
        admin,
      );
      const second = await post(
        "/api/app",
        { action: "create_account", name: "测试账号二", platform: "douyin" },
        admin,
      );
      const a = await first.json(),
        b = await second.json();
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      const created = await post(
        "/api/app",
        {
          action: "create_user",
          name: "测试运营",
          username: "test_operator",
          role: "operator",
          password,
          account_ids: [a.id],
        },
        admin,
      );
      assert.equal(created.status, 201);
      const login = await post("/api/auth", {
        action: "login",
        username: "test_operator",
        password,
      });
      const operator = login.headers.get("set-cookie").split(";")[0];
      const adminInfo = await (
        await fetch(origin + "/api/auth", { headers: { cookie: admin } })
      ).json();
      const files = await readdir(work, { recursive: true });
      const sqlite = files.find(
        (file) => /[a-f0-9]{64}\.sqlite$/.test(file) && file.includes("d1"),
      );
      assert.ok(sqlite);
      const fixtureDb = new DatabaseSync(resolve(work, sqlite));
      const topicId = crypto.randomUUID(),
        claimId = crypto.randomUUID(),
        createdAt = new Date().toISOString();
      try {
        fixtureDb
          .prepare(
            "INSERT INTO topics(id,title,created_by,created_at,platform) VALUES (?,'测试选题',?,?,'douyin')",
          )
          .run(topicId, adminInfo.user.id, createdAt);
        fixtureDb
          .prepare(
            "INSERT INTO claims(id,topic_id,account_id,owner_id,status,content_type,title,body,snapshot,created_at,updated_at) VALUES (?,?,?,?,'approved','douyin_video','测试稿件','测试正文','{\"title\":\"测试稿件\",\"body\":\"测试正文\"}',?,?)",
          )
          .run(claimId, topicId, a.id, adminInfo.user.id, createdAt, createdAt);
      } finally {
        fixtureDb.close();
      }
      const plan = {
        action: "schedule_publish",
        claim_id: claimId,
        execute_at: new Date(Date.now() + 86400e3).toISOString(),
      };
      assert.equal((await post("/api/operations", plan, operator)).status, 403);
      assert.equal((await post("/api/operations", plan, admin)).status, 200);
      assert.equal((await post("/api/operations", plan, admin)).status, 409);
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "cancel_schedule", claim_id: claimId },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "settings", enabled: false },
            operator,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "collect", account_id: b.id },
            operator,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "collect", account_id: a.id },
            operator,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "collect", account_id: a.id },
            operator,
          )
        ).status,
        429,
      );
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "collect", account_id: b.id },
            admin,
          )
        ).status,
        200,
      );
      const state = await (
        await fetch(origin + "/api/operations", {
          headers: { cookie: operator },
        })
      ).json();
      assert.equal(state.jobs.length, 1);
      assert.equal(state.jobs[0].account_id, a.id);
      assert.equal(state.notifications, null);
      assert.equal(
        (
          await fetch(origin + "/api/operations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "sec-fetch-site": "cross-site",
              cookie: admin,
            },
            body: JSON.stringify({ action: "settings", enabled: false }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            "/api/operations",
            { action: "settings", enabled: false },
            admin,
          )
        ).status,
        200,
      );
    } finally {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((done) =>
          setTimeout(() => {
            child.kill("SIGKILL");
            done();
          }, 5000),
        ),
      ]);
      await rm(work, { recursive: true, force: true });
    }
  },
);
