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
  douyin: {
    id: "douyin",
    label: "抖音",
    defaultContentType: "douyin_video",
    requiresReviewImages: false,
  },
  wechat_channels: {
    id: "wechat_channels",
    label: "视频号",
    defaultContentType: "wechat_channels_video",
    requiresReviewImages: false,
  },
} as const;

export type PlatformId = keyof typeof platforms;
export type ContentType =
  | "xiaohongshu_note"
  | "zhihu_article"
  | "zhihu_answer"
  | "wechat_article"
  | "douyin_video"
  | "wechat_channels_video";

export function isPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && value in platforms;
}

export function platformForContentType(value: unknown): PlatformId | null {
  if (value === "xiaohongshu_note") return "xiaohongshu";
  if (value === "zhihu_article" || value === "zhihu_answer") return "zhihu";
  if (value === "wechat_article") return "wechat";
  if (value === "douyin_video") return "douyin";
  if (value === "wechat_channels_video") return "wechat_channels";
  return null;
}

export function contentTypeForPlatform(platform: PlatformId): ContentType {
  return platforms[platform].defaultContentType;
}

export function requiresReviewImages(contentType: unknown) {
  const platform = platformForContentType(contentType);
  return platform ? platforms[platform].requiresReviewImages : false;
}
