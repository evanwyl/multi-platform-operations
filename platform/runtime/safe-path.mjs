import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export function isPathInside(root, candidate) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const child = relative(normalizedRoot, normalizedCandidate);
  return Boolean(child) && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function resolveChildPath(root, ...segments) {
  const candidate = resolve(root, ...segments);
  if (!isPathInside(root, candidate)) throw new Error("路径超出安全目录");
  return candidate;
}

export function safeFilename(path) {
  return basename(resolve(path));
}

export function unsafeArchiveEntry(entry) {
  const normalized = String(entry || "").replaceAll("\\", "/");
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  );
}
