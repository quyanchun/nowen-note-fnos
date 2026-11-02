import Image from "@tiptap/extension-image";
import TurndownService from "turndown";

export type ImageRotation = 0 | 90 | 180 | 270;

const INSTALL_KEY = "__NOWEN_IMAGE_TRANSFORM_ATTRS_V1__";
const TURNDOWN_INSTALL_KEY = "__NOWEN_IMAGE_TRANSFORM_TURNDOWN_V1__";

export function normalizeImageRotation(value: unknown): ImageRotation {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((((Math.round(numeric / 90) * 90) % 360) + 360) % 360) as ImageRotation;
}

export function normalizeImageFlipX(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  return typeof value === "string" && value.toLowerCase() === "true";
}

export function getPersistentImageTransform(rotationValue: unknown, flipValue: unknown): string {
  const rotation = normalizeImageRotation(rotationValue);
  const flipX = normalizeImageFlipX(flipValue);
  const transforms: string[] = [];
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);
  if (flipX) transforms.push("scaleX(-1)");
  return transforms.join(" ");
}

function parseRotation(element: HTMLElement): ImageRotation {
  const dataValue = element.getAttribute("data-image-rotation");
  if (dataValue != null) return normalizeImageRotation(dataValue);
  const match = (element.style.transform || "").match(/rotate\((-?\d+(?:\.\d+)?)deg\)/i);
  return normalizeImageRotation(match?.[1]);
}

function parseFlipX(element: HTMLElement): boolean {
  const dataValue = element.getAttribute("data-image-flip-x");
  if (dataValue != null) return normalizeImageFlipX(dataValue);
  return /scaleX\(\s*-1\s*\)/i.test(element.style.transform || "");
}

/**
 * Install persistent, non-destructive image transform attributes on Tiptap's shared Image
 * extension before any editor/import/export schema is created. Existing Image.extend()
 * callers inherit these attributes through `this.parent?.()`.
 */
export function installPersistentImageTransformAttributes(): void {
  const extension = Image as any;
  if (extension[INSTALL_KEY]) return;

  const config = extension.config as {
    addAttributes?: (...args: any[]) => Record<string, any>;
  };
  const originalAddAttributes = config.addAttributes;
  config.addAttributes = function patchedImageAttributes(this: any) {
    const inherited = originalAddAttributes?.call(this) || {};
    return {
      ...inherited,
      rotation: {
        default: 0,
        parseHTML: parseRotation,
        renderHTML: (attributes: Record<string, unknown>) => {
          const rotation = normalizeImageRotation(attributes.rotation);
          const flipX = normalizeImageFlipX(attributes.flipX);
          const transform = getPersistentImageTransform(rotation, flipX);
          return {
            ...(rotation === 0 ? {} : { "data-image-rotation": String(rotation) }),
            ...(transform ? { style: `transform:${transform};transform-origin:center center;` } : {}),
          };
        },
      },
      flipX: {
        default: false,
        parseHTML: parseFlipX,
        renderHTML: (attributes: Record<string, unknown>) =>
          normalizeImageFlipX(attributes.flipX)
            ? { "data-image-flip-x": "true" }
            : {},
      },
    };
  };
  extension[INSTALL_KEY] = true;
}

/** Preserve transformed images as CommonMark-compatible raw HTML islands. */
export function installImageTransformTurndownGuard(): void {
  const prototype = TurndownService.prototype as any;
  if (prototype[TURNDOWN_INSTALL_KEY]) return;
  const originalTurndown = prototype.turndown;
  prototype.turndown = function guardedTurndown(input: unknown): string {
    if (typeof input !== "string" || !/data-image-(?:rotation|flip-x)\s*=/i.test(input)) {
      return originalTurndown.call(this, input);
    }
    const preserved: string[] = [];
    const prepared = input.replace(/<img\b[^>]*>/gi, (tag) => {
      if (!/data-image-(?:rotation|flip-x)\s*=/i.test(tag)) return tag;
      const token = `NOWENIMAGETRANSFORM${preserved.length}TOKEN`;
      preserved.push(tag);
      return token;
    });
    let markdown = String(originalTurndown.call(this, prepared));
    preserved.forEach((tag, index) => {
      markdown = markdown.split(`NOWENIMAGETRANSFORM${index}TOKEN`).join(tag);
    });
    return markdown;
  };
  prototype[TURNDOWN_INSTALL_KEY] = true;
}

installPersistentImageTransformAttributes();
installImageTransformTurndownGuard();
