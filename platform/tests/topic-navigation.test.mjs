import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app/PlatformApp.tsx", import.meta.url), "utf8");
const trends = readFileSync(new URL("../app/api/trends/route.ts", import.meta.url), "utf8");

test("opens the exact topic from the operations asset center", () => {
  assert.match(app, /topicId: topic\.id/);
  assert.match(app, /id={`topic-\${topic\.id}`}/);
  assert.match(app, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(app, /focusedTopicId === topic\.id \? "focused"/);
});

test("limits Xiaohongshu research targets to Xiaohongshu accounts", () => {
  assert.match(trends, /platform='xiaohongshu'/);
  assert.match(trends, /FROM accounts WHERE is_demo=0 AND platform='xiaohongshu'/);
  assert.match(app, /candidates\.includes\(result\.settings\.target_account_id\)/);
});
