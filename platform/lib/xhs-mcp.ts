export type McpContent = { type: string; text?: string; data?: string; mimeType?: string };

function friendlyError(message: string) {
  if (/context deadline exceeded|timed?\s*out/i.test(message)) return "小红书页面加载超时，实时状态暂时无法确认";
  if (/panic|internal error/i.test(message)) return "小红书 MCP 内部执行异常，请稍后重试";
  return message;
}

export async function callMcpTool(port: number, name: string, args: Record<string, unknown> = {}, timeoutMs?: number) {
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const commonHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  let initialize: Response;
  try {
    initialize = await fetch(endpoint, {
      method: "POST", headers: commonHeaders, signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hongshutai", version: "0.2.0" } } }),
    });
  } catch { throw new Error("小红书 MCP 连接已中断"); }
  if (!initialize.ok) throw new Error("小红书 MCP 没有响应");
  const sessionId = initialize.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("小红书 MCP 未返回会话标识");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST", headers: { ...commonHeaders, "mcp-session-id": sessionId }, signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch { throw new Error("小红书 MCP 执行中断，请稍后重试"); }
  if (!response.ok) throw new Error(`小红书 MCP 调用失败（${response.status}）`);
  const payload = await response.json() as { error?: { message?: string }; result?: { content?: McpContent[]; isError?: boolean } };
  if (payload.error || payload.result?.isError) {
    const detail = payload.result?.content?.filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\n");
    throw new Error(friendlyError(payload.error?.message || detail || "小红书 MCP 执行失败"));
  }
  return payload.result?.content ?? [];
}

export async function checkMcpLogin(port: number) {
  const content = await callMcpTool(port, "check_login_status");
  const text = content.filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\n");
  const online = /已登录|logged\s*in/i.test(text) && !/未登录|not\s*logged/i.test(text);
  const nickname = text.match(/(?:用户名|昵称|username)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim() || "";
  return { online, nickname, text: text || (online ? "已登录" : "未登录") };
}
