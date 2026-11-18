import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(new URL("../runtime/platforms/ima-openapi.mjs", import.meta.url), "utf8");
const manager = readFileSync(new URL("../runtime/manager.mjs", import.meta.url), "utf8");
const sync = readFileSync(new URL("../lib/ima-sync.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
const publish = readFileSync(new URL("../app/api/publish/route.ts", import.meta.url), "utf8");

test("stores IMA credentials only in a private runtime config and sends them only to ima.qq.com", () => {
  assert.match(runtime, /https:\/\/ima\.qq\.com\/openapi/);
  assert.match(runtime, /ima-openapi-clientid/);
  assert.match(runtime, /ima-openapi-apikey/);
  assert.match(runtime, /mode: 0o600/);
  assert.doesNotMatch(sync, /apiKey|clientId/);
});

test("mirrors topic creation, logical deletion, and successful publishing", () => {
  assert.match(app, /syncTopicToIma\(db, id, "created"\)/);
  assert.match(app, /syncTopicToIma\(db, topic\.id, "deleted"\)/);
  assert.match(sync, /已从平台删除/);
  assert.match(publish, /syncPublishedToIma\(db, claim\.id\)/);
  assert.match(manager, /url\.pathname === "\/ima\/sync"/);
});
