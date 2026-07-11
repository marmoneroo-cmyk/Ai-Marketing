import { asString, asStringArray, clamp, parseModelJson } from '@brandpilot/agent-runtime';
import type {
  BrandKitContext,
  CreativeItemContext,
  ImageSpec,
  Storyboard,
  StoryboardScene,
} from './types';

const MAX_LIST_ITEMS = 12;
const MAX_SCENES = 8;
const DEFAULT_SCENE_SECONDS = 3;
const MIN_SCENE_SECONDS = 1;
const MAX_SCENE_SECONDS = 60;

/** Compact a brand list (colors/fonts) for prompt injection (bounded, trimmed). */
function summarizeList(items: readonly string[]): string {
  const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, MAX_LIST_ITEMS);
  return cleaned.length > 0 ? cleaned.join(', ') : '(none provided)';
}

/** Clamp a raw scene duration into a sane [1,60]s window, defaulting non-finite values. */
export function clampDuration(value: unknown): number {
  return clamp(value, MIN_SCENE_SECONDS, MAX_SCENE_SECONDS, DEFAULT_SCENE_SECONDS);
}

/** Build the image-spec prompt. Instructs the model to return STRINGIFIED JSON. */
export function buildImagePrompt(input: {
  item: CreativeItemContext;
  brand: BrandKitContext;
}): string {
  const { item, brand } = input;
  const colorList = brand.colors.map((c) => `${c.hex} (${c.role})`);
  return [
    `Design a single on-brand ${item.kind} visual for a ${item.format} content item.`,
    item.pillar ? `Content pillar: ${item.pillar}` : '',
    item.brief ? `Brief / angle: ${item.brief}` : '',
    `BRAND COLORS: ${summarizeList(colorList)}`,
    `BRAND FONTS: ${summarizeList(brand.fonts)}`,
    brand.designNotes ? `DESIGN NOTES: ${brand.designNotes}` : '',
    'Respect the brand colors and fonts above. Keep the composition legible on mobile.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "imagePrompt": string, "altText": string }',
    '"imagePrompt" is a detailed text-to-image generation prompt.',
    '"altText" is a concise, accessible description of the resulting image.',
    'Do NOT invent logos, text overlays with specific prices, guarantees, or claims.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/** Build the reel-storyboard prompt for one content item, grounded in the brand kit. */
export function buildStoryboardPrompt(input: { item: CreativeItemContext; brand: BrandKitContext }): string {
  const { item, brand } = input;
  const colorList = brand.colors.map((c) => `${c.hex} (${c.role})`);
  return [
    `Storyboard a short-form vertical reel for a ${item.format} content item.`,
    item.pillar ? `Content pillar: ${item.pillar}` : '',
    item.brief ? `Brief / angle: ${item.brief}` : '',
    `BRAND COLORS: ${summarizeList(colorList)}`,
    `BRAND FONTS: ${summarizeList(brand.fonts)}`,
    brand.designNotes ? `DESIGN NOTES: ${brand.designNotes}` : '',
    'Respect the brand colors, fonts, and guidelines above throughout every scene.',
    'Put a STRINGIFIED JSON object in your "output" with this exact shape:',
    '{ "scenes": [{ "shot": string, "caption": string, "durationSec": number }] }',
    `Aim for 3-${MAX_SCENES} scenes. Each "shot" describes the visual; "caption" is on-screen text.`,
    '"durationSec" is a number of seconds (1-60) for each scene.',
    'Do NOT invent prices, offers, or guarantees.',
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/** Parse the image-spec model output defensively; never throws. */
export function parseImageSpec(output: string): ImageSpec {
  const obj = parseModelJson<Partial<ImageSpec>>(output, {});
  return {
    imagePrompt: asString(obj.imagePrompt),
    altText: asString(obj.altText),
  };
}

/** Parse the reel-storyboard model output defensively; never throws. */
export function parseStoryboard(output: string): Storyboard {
  const obj = parseModelJson<{ scenes?: unknown }>(output, {});
  const rawScenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  const scenes: StoryboardScene[] = rawScenes
    .map((sc) => {
      const record = (sc ?? {}) as Record<string, unknown>;
      return {
        shot: asString(record.shot),
        caption: asString(record.caption),
        durationSec: clampDuration(record.durationSec),
      };
    })
    .filter((sc) => sc.shot.length > 0 || sc.caption.length > 0)
    .slice(0, MAX_SCENES);
  return { scenes };
}

export { asStringArray };
