import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";

function settings(root) {
  try {
    return JSON.parse(
      readFileSync(resolve(root, "operations-notifications.json"), "utf8"),
    );
  } catch {
    return {};
  }
}
export function notificationStatus(root) {
  const value = settings(root);
  return {
    configured: Boolean(value.webhook),
    enabled: Boolean(value.enabled),
  };
}
export function saveNotifications(root, payload) {
  const prior = settings(root);
  const webhook = String(payload.webhook || prior.webhook || "").trim();
  if (webhook) {
    const url = new URL(webhook);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "open.feishu.cn" ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new Error("请填写飞书自定义机器人 Webhook 地址");
  }
  if (payload.enabled && !webhook) throw new Error("请先填写飞书机器人地址");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = resolve(root, "operations-notifications.json");
  const temp = `${target}.tmp`;
  writeFileSync(
    temp,
    JSON.stringify({ webhook, enabled: Boolean(payload.enabled) }),
    { mode: 0o600 },
  );
  renameSync(temp, target);
  return notificationStatus(root);
}
export async function notifyOperations(root, event) {
  if (!existsSync(resolve(root, "operations-notifications.json")))
    return { skipped: true };
  const value = settings(root);
  if (!value.enabled || !value.webhook) return { skipped: true };
  const response = await fetch(value.webhook, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: {
          title: {
            tag: "plain_text",
            content:
              "多平台内容运营 · " +
              String(event.action || "运营提醒").slice(0, 80),
          },
          template: /失败|异常|退回/.test(String(event.action))
            ? "orange"
            : "blue",
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "plain_text",
              content: String(event.detail || "请打开平台查看任务详情").slice(
                0,
                1000,
              ),
            },
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok || result.code)
    throw new Error("飞书通知发送失败，请检查机器人设置");
  return { ok: true };
}
