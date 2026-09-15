export const platforms = {
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    defaultContentType: "xiaohongshu_note",
    requiresReviewImages: true,
  },
  zhihu: {
    id: "zhihu",
    label: "知乎",
    defaultContentType: "zhihu_article",
    requiresReviewImages: false,
  },
  wechat: {
    id: "wechat",
    label: "微信公众号",
    defaultContentType: "wechat_article",
    requiresReviewImages: false,
  },
} as const;

export type PlatformId = keyof typeof platforms;
export type ContentType = "xiaohongshu_note" | "zhihu_article" | "zhihu_answer" | "wechat_article";

export function isPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && value in platforms;
}

export function platformForContentType(value: unknown): PlatformId | null {
  if (value === "xiaohongshu_note") return "xiaohongshu";
  if (value === "zhihu_article" || value === "zhihu_answer") return "zhihu";
  if (value === "wechat_article") return "wechat";
  return null;
}

export function contentTypeForPlatform(platform: PlatformId): ContentType {
  return platforms[platform].defaultContentType;
}

export function requiresReviewImages(contentType: unknown) {
  return platformForContentType(contentType) === "xiaohongshu";
}
