/**
 * Shared enums used across every module. Defined as readonly tuples so they can
 * be used both as runtime values (validation, iteration) and as union types.
 */

export const ROLES = ['owner', 'admin', 'marketer', 'sales', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** How much the platform is allowed to act without human approval. */
export const AUTONOMY_MODES = ['observe', 'suggest', 'auto_scoped', 'auto_broad'] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const SOCIAL_PROVIDERS = [
  'instagram',
  'facebook',
  'tiktok',
  'google_business',
  'whatsapp',
  'youtube',
  'linkedin',
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const CONVERSATION_CHANNELS = [
  'ig_comment',
  'ig_dm',
  'fb_comment',
  'messenger',
  'whatsapp',
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONTENT_FORMATS = [
  'post',
  'carousel',
  'story',
  'reel',
  'article',
  'email',
  'gbp_post',
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const PUBLISH_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'linkedin',
  'pinterest',
  'gbp',
  'email',
  'blog',
] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export const ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Kinds of actions that can require human approval before execution. */
export const APPROVAL_KINDS = ['content', 'publish', 'quote', 'payment', 'reply', 'workflow'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
