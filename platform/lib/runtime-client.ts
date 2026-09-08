const MANAGER_ORIGIN = "http://127.0.0.1:18100";

function localToken() {
  const token = process.env.RUNTIME_MANAGER_TOKEN?.trim();
  if (!token) throw new Error("本机运行服务缺少访问令牌，请通过 npm run dev 或 npm start 启动完整平台");
  return token;
}

export function protectedHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("authorization", `Bearer ${localToken()}`);
  return result;
}

export function managerFetch(path: string, options: RequestInit = {}) {
  return fetch(`${MANAGER_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`, {
    ...options,
    headers: protectedHeaders(options.headers),
  });
}
