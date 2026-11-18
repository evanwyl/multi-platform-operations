import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  contentIdentity,
  metricNumber,
  collectionInterval,
  interactionRate,
  metricLeaseSql,
  reviewSnapshot,
} from "../runtime/platforms/operations-core.mjs";

test("normalizes measured numbers without turning missing values into zero", () => {
  for (const [input, expected] of [
    ["1.2万", 12000],
    ["6,017", 6017],
    ["5.3K", 5300],
    [0, 0],
    [null, null],
    ["--", null],
    ["暂无", null],
    ["", null],
    [-1, null],
    [Infinity, null],
  ])
    assert.equal(metricNumber(input), expected);
});
test("accepts only platform-specific content links, never creator management pages", () => {
  assert.equal(
    contentIdentity("douyin", "https://www.douyin.com/video/123456789")?.id,
    "123456789",
  );
  assert.equal(
    contentIdentity("zhihu", "https://zhuanlan.zhihu.com/p/123456")?.id,
    "123456",
  );
  assert.ok(contentIdentity("wechat", "https://mp.weixin.qq.com/s/abc123"));
  for (const [platform, url] of [
    ["douyin", "https://creator.douyin.com/creator-micro/content/manage"],
    ["douyin", "https://douyin.com.evil.test/video/123"],
    ["douyin", "https://user:pass@www.douyin.com/video/123"],
    ["zhihu", "http://zhuanlan.zhihu.com/p/123"],
    ["wechat_channels", "https://channels.weixin.qq.com/platform/post/list"],
    ["wechat", "https://mp.weixin.qq.com/cgi-bin/appmsg"],
  ])
    assert.equal(contentIdentity(platform, url), null);
});
test("uses age-based sampling and refuses incomplete interaction denominators", () => {
  const now = Date.parse("2026-11-18T12:00:00+08:00");
  assert.equal(
    collectionInterval("2026-11-17T12:00:00+08:00", now),
    6 * 3600e3,
  );
  assert.equal(
    collectionInterval("2026-11-01T12:00:00+08:00", now),
    24 * 3600e3,
  );
  assert.equal(
    interactionRate({
      views: 100,
      likes: 2,
      comments: 1,
      favorites: 3,
      shares: 1,
    }),
    0.07,
  );
  assert.equal(
    interactionRate({
      views: 100,
      likes: 2,
      comments: null,
      favorites: 3,
      shares: 1,
    }),
    null,
  );
  assert.equal(
    interactionRate({
      views: 0,
      likes: 0,
      comments: 0,
      favorites: 0,
      shares: 0,
    }),
    null,
  );
});
test("serializes real SQLite queue leases and releases interrupted work safely", () => {
  const source = readFileSync(
    new URL("../lib/database.ts", import.meta.url),
    "utf8",
  );
  const db = new DatabaseSync(":memory:");
  try {
    for (const sql of source.matchAll(
      /`(CREATE TABLE IF NOT EXISTS metric_jobs[\s\S]*?)`/g,
    ))
      db.exec(sql[1]);
    const insert = db.prepare(
      "INSERT INTO metric_jobs(id,account_id,claim_id,status,requested_by,created_at) VALUES (?,?,?,'pending','tester',?)",
    );
    insert.run("first", "account-one", "claim-one", "2026-11-18T01:00:00Z");
    insert.run("second", "account-two", "claim-two", "2026-11-18T02:00:00Z");
    const lease = db.prepare(metricLeaseSql);
    assert.equal(lease.get("2026-11-18T03:00:00Z").id, "first");
    assert.equal(lease.get("2026-11-18T03:00:00Z"), undefined);
    db.prepare("UPDATE metric_jobs SET status='failed' WHERE id='first'").run();
    assert.equal(lease.get("2026-11-18T03:01:00Z").id, "second");
    assert.equal(
      db.prepare("SELECT account_id FROM metric_jobs WHERE id='second'").get()
        .account_id,
      "account-two",
    );
  } finally {
    db.close();
  }
});
test("never invents 3-day or 7-day history from a 1-day sample", () => {
  const published = "2026-11-01T00:00:00Z";
  const samples = [
    { views: 100, collected_at: "2026-11-01T12:00:00Z" },
    { views: 400, collected_at: "2026-11-03T22:00:00Z" },
  ];
  assert.equal(reviewSnapshot(samples, published, 1).views, 100);
  assert.equal(reviewSnapshot(samples, published, 3).views, 400);
  assert.equal(reviewSnapshot(samples, published, 7), null);
});
