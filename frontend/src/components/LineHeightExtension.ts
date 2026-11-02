import { Extension } from "@tiptap/core";

const LINE_HEIGHT_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "tableCell",
  "tableHeader",
] as const;

export const LINE_HEIGHT_PRESETS: { label: string; value: string; key: string }[] = [
  { label: "紧凑", value: "1", key: "compact" },
  { label: "标准", value: "1.4", key: "normal" },
  { label: "舒适", value: "1.6", key: "comfortable" },
  { label: "宽松", value: "1.8", key: "loose" },
  { label: "双倍", value: "2", key: "double" },
];

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export function isValidLineHeight(raw: string): boolean {
  if (!raw || raw.length > 4) return false;
  if (!/^\d(?:\.\d{1,2})?$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 && value <= 3;
}

function findBlockPositions(state: any): Map<number, any> {
  const supported = new Set<string>(LINE_HEIGHT_TYPES);
  const { from, to, ranges } = state.selection;
  const positions = new Map<number, any>();

  state.doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (supported.has(node.type.name)) positions.set(pos, node);
    return true;
  });

  for (const range of ranges ?? []) {
    for (const $pos of [range.$from, range.$to]) {
      for (let depth = $pos.depth; depth > 0; depth--) {
        const node = $pos.node(depth);
        if (supported.has(node.type.name)) {
          positions.set($pos.before(depth), node);
        }
      }
    }
  }

  return positions;
}

function applyLineHeight(state: any, dispatch: any, value: string | null): boolean {
  const positions = findBlockPositions(state);
  if (positions.size === 0) return false;

  const tr = state.tr;
  let changed = false;
  positions.forEach((node, pos) => {
    const nextAttrs = { ...node.attrs, lineHeight: value };
    if ((node.attrs?.lineHeight ?? null) === value) return;
    tr.setNodeMarkup(pos, undefined, nextAttrs);
    changed = true;
  });

  if (changed && dispatch) dispatch(tr.scrollIntoView());
  return changed;
}

export const LineHeightExtension = Extension.create({
  name: "lineHeight",

  addGlobalAttributes() {
    return [
      {
        types: [...LINE_HEIGHT_TYPES],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => {
              const lineHeight = element.style.lineHeight || null;
              return lineHeight && isValidLineHeight(lineHeight) ? lineHeight : null;
            },
            renderHTML: (attrs) => {
              if (!attrs.lineHeight || !isValidLineHeight(attrs.lineHeight)) return {};
              return { style: `line-height: ${attrs.lineHeight}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value: string) =>
        ({ state, dispatch }: any) => {
          if (!isValidLineHeight(value)) return false;
          return applyLineHeight(state, dispatch, value);
        },
      unsetLineHeight:
        () =>
        ({ state, dispatch }: any) =>
          applyLineHeight(state, dispatch, null),
    };
  },
});
