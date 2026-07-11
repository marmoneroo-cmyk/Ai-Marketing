import type { Platform } from "./types";

/**
 * Single source of truth for platform presentation (labels + brand dot colors).
 * Imported by PlatformBadge, SocialConnectButton, and the Settings channel list
 * so platform metadata lives in exactly one place and can never drift.
 */

/** Human-readable platform name. */
export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  google: "Google",
  email: "Email",
};

/** Tailwind `bg-*` class for the platform's brand dot (vendor-neutral, no logos). */
export const PLATFORM_DOT_COLOR: Record<Platform, string> = {
  instagram: "bg-pink-500",
  facebook: "bg-blue-600",
  tiktok: "bg-zinc-900 dark:bg-zinc-100",
  youtube: "bg-red-600",
  google: "bg-amber-500",
  email: "bg-brand-500",
};
