/** The visual deliverable kinds Creative Studio can generate for a content item. */
export type CreativeKind = 'image' | 'carousel' | 'story' | 'cover' | 'thumbnail' | 'ad';

/** A single brand-kit color swatch fed into the image prompt. */
export interface BrandColor {
  hex: string;
  role: string;
}

/** Compact brand-kit context injected into the image prompt (bounded, sanitized). */
export interface BrandKitContext {
  colors: BrandColor[];
  fonts: string[];
  designNotes: string;
}

/** Minimal facts about the content item fed into the image prompt. */
export interface CreativeItemContext {
  kind: CreativeKind;
  format: string;
  pillar: string;
  brief: string;
}

/** Structured image spec the model returns (parsed defensively; never throws). */
export interface ImageSpec {
  imagePrompt: string;
  altText: string;
}

/** A single reel scene the storyboard model returns for one content item. */
export interface StoryboardScene {
  shot: string;
  caption: string;
  durationSec: number;
}

/** Structured reel storyboard the model returns (parsed defensively; never throws). */
export interface Storyboard {
  scenes: StoryboardScene[];
}

/** Result of generating a still asset for a content item. */
export interface GenerateCreativeResult {
  jobId: string;
  assetId?: string;
}

/** An injected media adapter that renders a prompt into stored image bytes. */
export type RenderImage = (prompt: string) => Promise<{
  storageKey: string;
  width?: number;
  height?: number;
}>;
