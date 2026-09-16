import { marked, Renderer } from "marked";
import sanitizeHtml from "sanitize-html";

export const wechatThemes = {
  default: { label: "经典", primary: "#3f6fd8", variant: "badge" },
  grace: { label: "优雅", primary: "#7b5a9e", variant: "grace" },
  simple: { label: "简洁", primary: "#1f7a6d", variant: "simple" },
  business: { label: "商务蓝", primary: "#2457a7", variant: "business" },
  ink: { label: "墨香国风", primary: "#5c5145", variant: "ink" },
  fresh: { label: "清新绿", primary: "#29966f", variant: "fresh" },
  magazine: { label: "暖色杂志", primary: "#c4653d", variant: "magazine" },
  tech: { label: "科技深色", primary: "#536dfe", variant: "tech" },
  monochrome: { label: "极简黑白", primary: "#222222", variant: "monochrome" },
  knowledge: { label: "卡片知识库", primary: "#5865a8", variant: "knowledge" },
  highlight: { label: "高亮重点型", primary: "#d45b73", variant: "highlight" },
};

export function normalizeWechatStyle(value = {}) {
  const fontSize = Math.min(19, Math.max(14, Number(value.fontSize) || 16));
  const lineHeight = Math.min(
    2.2,
    Math.max(1.5, Number(value.lineHeight) || 1.85),
  );
  const align = ["left", "justify"].includes(value.align)
    ? value.align
    : "justify";
  const primary = /^#[0-9a-f]{6}$/i.test(String(value.primary || ""))
    ? String(value.primary)
    : "";
  return { fontSize, lineHeight, align, primary };
}

function escape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styles(themeName, styleOptions = {}) {
  const source = wechatThemes[themeName] || wechatThemes.default;
  const options = normalizeWechatStyle(styleOptions);
  const theme = { ...source, primary: options.primary || source.primary };
  const common = {
    p: `margin:0 0 18px;color:#333;font-size:${options.fontSize}px;line-height:${options.lineHeight};letter-spacing:.03em;text-align:${options.align}`,
    strong: `color:${theme.primary};font-weight:700`,
    em: "font-style:italic;color:#555",
    blockquote: `margin:22px 0;padding:14px 16px;border-left:4px solid ${theme.primary};background:#f7f8fa;color:#596273;font-size:15px;line-height:1.8`,
    ul: `margin:14px 0;padding-left:24px;color:#333;font-size:${options.fontSize}px;line-height:${options.lineHeight}`,
    ol: `margin:14px 0;padding-left:24px;color:#333;font-size:${options.fontSize}px;line-height:${options.lineHeight}`,
    li: "margin:6px 0",
    hr: `margin:30px auto;border:0;border-top:1px solid ${theme.primary};opacity:.35`,
    a: `color:${theme.primary};text-decoration:none;border-bottom:1px solid ${theme.primary}`,
    code: "padding:2px 5px;border-radius:4px;background:#f1f3f5;color:#c7254e;font-family:Menlo,monospace;font-size:14px",
    pre: "margin:20px 0;padding:14px 16px;overflow:auto;border-radius:8px;background:#20242b;color:#f4f4f2;font-size:13px;line-height:1.65",
    table:
      "width:100%;margin:20px 0;border-collapse:collapse;color:#333;font-size:14px",
    th: `padding:8px;border:1px solid #dfe3e8;background:${theme.primary};color:#fff;font-weight:700`,
    td: "padding:8px;border:1px solid #dfe3e8;line-height:1.6",
    img: "display:block;max-width:100%;height:auto;margin:24px auto;border-radius:6px",
  };
  if (theme.variant === "grace" || theme.variant === "magazine") {
    return {
      ...common,
      h1: `margin:30px 0 20px;padding:0 0 12px;border-bottom:2px solid ${theme.primary};color:#2f2635;font-size:24px;line-height:1.45;text-align:center;font-weight:700`,
      h2: `display:table;margin:32px auto 18px;padding:7px 18px;border-radius:8px;background:${theme.primary};color:#fff;font-size:20px;line-height:1.5;font-weight:700;box-shadow:0 4px 12px rgba(80,55,100,.15)`,
      h3: `margin:26px 0 14px;padding:5px 0 5px 12px;border-left:4px solid ${theme.primary};border-bottom:1px dashed ${theme.primary};color:#3a3040;font-size:18px;line-height:1.55;font-weight:700`,
    };
  }
  if (["simple", "business", "fresh"].includes(theme.variant)) {
    return {
      ...common,
      h1: "margin:28px 0 20px;color:#20242b;font-size:24px;line-height:1.45;text-align:center;font-weight:700",
      h2: `margin:30px 0 16px;padding:8px 14px;border-left:4px solid ${theme.primary};border-radius:4px;background:#f3f8f7;color:#20242b;font-size:20px;line-height:1.5;font-weight:700`,
      h3: `margin:24px 0 12px;color:${theme.primary};font-size:18px;line-height:1.55;font-weight:700`,
    };
  }
  if (theme.variant === "ink") {
    return {
      ...common,
      h1: `margin:30px 0 20px;color:${theme.primary};font-family:serif;font-size:25px;text-align:center`,
      h2: `margin:32px 0 18px;padding:0 0 8px;border-bottom:1px solid ${theme.primary};color:${theme.primary};font-family:serif;font-size:21px;text-align:center`,
      h3: `margin:24px 0 13px;color:${theme.primary};font-family:serif;font-size:18px`,
    };
  }
  if (["tech", "knowledge"].includes(theme.variant)) {
    return {
      ...common,
      h1: `margin:28px 0 20px;color:#17213c;font-size:25px;text-align:center`,
      h2: `margin:30px 0 16px;padding:10px 14px;border:1px solid ${theme.primary};border-radius:8px;background:#f3f5ff;color:${theme.primary};font-size:20px`,
      h3: `margin:24px 0 13px;padding-left:10px;border-left:4px solid ${theme.primary};color:#26304a;font-size:18px`,
    };
  }
  if (theme.variant === "monochrome") {
    return {
      ...common,
      h1: "margin:28px 0 20px;color:#111;font-size:25px;text-align:center",
      h2: "margin:30px 0 16px;padding-bottom:8px;border-bottom:2px solid #111;color:#111;font-size:20px",
      h3: "margin:24px 0 13px;color:#222;font-size:18px;text-decoration:underline;text-underline-offset:6px",
    };
  }
  if (theme.variant === "highlight") {
    return {
      ...common,
      h1: `margin:28px 0 20px;color:#222;font-size:25px;text-align:center`,
      h2: `display:table;margin:30px 0 16px;padding:5px 10px;background:linear-gradient(transparent 45%,${theme.primary}55%);color:#222;font-size:20px`,
      h3: `margin:24px 0 13px;color:${theme.primary};font-size:18px`,
    };
  }
  return {
    ...common,
    h1: `display:table;margin:30px auto 20px;padding:0 16px 8px;border-bottom:2px solid ${theme.primary};color:#20242b;font-size:24px;line-height:1.45;text-align:center;font-weight:700`,
    h2: `display:table;margin:32px auto 18px;padding:6px 16px;background:${theme.primary};color:#fff;font-size:20px;line-height:1.5;font-weight:700`,
    h3: `margin:25px 0 13px;padding-left:10px;border-left:3px solid ${theme.primary};color:#20242b;font-size:18px;line-height:1.5;font-weight:700`,
  };
}

export function renderWechatMarkdown(
  markdown,
  themeName = "default",
  imageUrls = [],
  styleOptions = {},
) {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escape(text);
  const raw = marked.parse(String(markdown || ""), {
    renderer,
    gfm: true,
    breaks: true,
  });
  const map = styles(themeName, styleOptions);
  let styled = String(raw);
  for (const [tag, style] of Object.entries(map)) {
    styled = styled.replace(
      new RegExp(`<${tag}(?![a-z0-9])([^>]*)>`, "gi"),
      `<${tag}$1 style="${style}">`,
    );
  }
  const images = imageUrls
    .map(
      (url) =>
        `<p style="margin:24px 0;text-align:center"><img src="${escape(url)}" style="${map.img}" /></p>`,
    )
    .join("");
  return sanitizeHtml(
    `<section style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#333;word-break:break-word">${styled}${images}</section>`,
    {
      allowedTags: [
        "section",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "strong",
        "em",
        "blockquote",
        "ul",
        "ol",
        "li",
        "hr",
        "a",
        "code",
        "pre",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "img",
      ],
      allowedAttributes: {
        "*": ["style"],
        a: ["href", "title", "style"],
        img: ["src", "alt", "title", "style"],
      },
      allowedSchemes: ["http", "https"],
      allowedSchemesByTag: { img: ["http", "https"] },
      disallowedTagsMode: "discard",
    },
  );
}
