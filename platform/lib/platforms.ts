export const platforms = {
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    defaultContentType: "xiaohongshu_note",
    contentTypes: ["xiaohongshu_note", "xiaohongshu_video"],
  },
  zhihu: {
    id: "zhihu",
    label: "知乎",
    defaultContentType: "zhihu_article",
    contentTypes: ["zhihu_article", "zhihu_answer"],
  },
  wechat: {
    id: "wechat",
    label: "微信公众号",
    defaultContentType: "wechat_article",
    contentTypes: ["wechat_article"],
  },
  douyin: {
    id: "douyin",
    label: "抖音",
    defaultContentType: "douyin_video",
    contentTypes: ["douyin_image", "douyin_video"],
  },
  wechat_channels: {
    id: "wechat_channels",
    label: "视频号",
    defaultContentType: "wechat_channels_video",
    contentTypes: ["wechat_channels_video"],
  },
} as const;

export type PlatformId = keyof typeof platforms;
export type ContentType =
  | "xiaohongshu_note"
  | "xiaohongshu_video"
  | "zhihu_article"
  | "zhihu_answer"
  | "wechat_article"
  | "douyin_image"
  | "douyin_video"
  | "wechat_channels_video";

export function isPlatform(value: unknown): value is PlatformId {
  return typeof value === "string" && value in platforms;
}

export function platformForContentType(value: unknown): PlatformId | null {
  if (value === "xiaohongshu_note" || value === "xiaohongshu_video") return "xiaohongshu";
  if (value === "zhihu_article" || value === "zhihu_answer") return "zhihu";
  if (value === "wechat_article") return "wechat";
  if (value === "douyin_image" || value === "douyin_video") return "douyin";
  if (value === "wechat_channels_video") return "wechat_channels";
  return null;
}

export function contentTypeForPlatform(platform: PlatformId): ContentType {
  return platforms[platform].defaultContentType;
}

export function contentTypesForPlatform(platform: PlatformId): readonly ContentType[] {
  return platforms[platform].contentTypes;
}

export function isContentTypeForPlatform(value: unknown, platform: PlatformId): value is ContentType {
  return typeof value === "string" && contentTypesForPlatform(platform).includes(value as ContentType);
}

export function isVideoContentType(value: unknown) {
  return value === "xiaohongshu_video" || value === "douyin_video" || value === "wechat_channels_video";
}

export function isImageContentType(value: unknown) {
  return value === "xiaohongshu_note" || value === "douyin_image";
}

export function requiresReviewImages(contentType: unknown) {
  return isImageContentType(contentType);
}
