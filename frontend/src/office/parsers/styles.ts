// parsers/styles.ts —— 解析 word/styles.xml
//
// 为什么单独一个文件：
//   document.xml 里段落用 <w:pStyle w:val="2"/> 这种内部 ID 引用样式，
//   只有读到 styles.xml 才能反查"这个 ID 实际叫什么"。
//   中文 Word 模板里 styleId 几乎都是数字或拼音缩写（"a3"、"af5"），
//   不解析 styles.xml 的话，所有标题都识别不出来。
//
// 当前范围（W1.3）：
//   ✅ 段落样式名 + basedOn 继承链
//   ✅ 标题级别推断（heading 1 / 标题 1 / toc 1 都算）
//   ❌ 字符样式、表格样式的属性继承——下个里程碑

export interface StyleDef {
  id: string;
  /** name 已小写化，匹配时直接 includes 即可。 */
  name: string;
  type: "paragraph" | "character" | "table" | "numbering" | "unknown";
  basedOn?: string;
}

export type StyleMap = Map<string, StyleDef>;

export function parseStyles(doc: XMLDocument | null): StyleMap {
  const map: StyleMap = new Map();
  if (!doc) return map;

  for (const child of childElements(doc.documentElement)) {
    if (child.localName !== "style") continue;

    const id = child.getAttribute("w:styleId") || child.getAttribute("styleId");
    if (!id) continue;

    const typeAttr = (
      child.getAttribute("w:type") ||
      child.getAttribute("type") ||
      "unknown"
    ).toLowerCase();
    const type: StyleDef["type"] =
      typeAttr === "paragraph" ||
      typeAttr === "character" ||
      typeAttr === "table" ||
      typeAttr === "numbering"
        ? typeAttr
        : "unknown";

    const nameEl = firstByLocalName(child, "name");
    const name = (
      nameEl?.getAttribute("w:val") ||
      nameEl?.getAttribute("val") ||
      ""
    ).toLowerCase();

    const basedOnEl = firstByLocalName(child, "basedOn");
    const basedOn =
      basedOnEl?.getAttribute("w:val") ||
      basedOnEl?.getAttribute("val") ||
      undefined;

    map.set(id, { id, name, type, basedOn });
  }

  return map;
}

/**
 * 给定段落 styleId，返回 1~6 标题级别；非标题返回 null。
 * 沿 basedOn 链最多走 8 层（防御循环引用，正常 docx 不会超过 3 层）。
 */
export function resolveHeadingLevel(
  styleId: string | undefined,
  styles: StyleMap,
): number | null {
  if (!styleId) return null;

  const seen = new Set<string>();
  let cur: string | undefined = styleId;
  for (let i = 0; i < 8 && cur && !seen.has(cur); i++) {
    seen.add(cur);
    const def = styles.get(cur);
    if (!def) {
      // styleId 直接没在表里，最后用 id 本身碰一下（应付 "Heading1" 这种自带语义的 ID）
      const lvl = headingLevelFromName(cur.toLowerCase());
      return lvl;
    }
    const lvl = headingLevelFromName(def.name) ?? headingLevelFromName(def.id.toLowerCase());
    if (lvl) return lvl;
    cur = def.basedOn;
  }
  return null;
}

function headingLevelFromName(s: string): number | null {
  if (!s) return null;
  // 英文：heading 1 / heading1 / heading-1
  let m = /heading\s*-?\s*(\d)/.exec(s);
  if (m) return clampLevel(parseInt(m[1], 10));
  // 中文：标题 1 / 标题1
  m = /标题\s*(\d)/.exec(s);
  if (m) return clampLevel(parseInt(m[1], 10));
  // 目录：toc 1（部分模板把目录项当作标题继承）—— 不当标题，避免误判
  return null;
}

function clampLevel(n: number): number | null {
  return n >= 1 && n <= 6 ? n : null;
}

// ---------------------------------------------------------------------------
// DOM helpers（和 docx-parser 同款，复制一份避免循环依赖）
// ---------------------------------------------------------------------------

function firstByLocalName(parent: Element, localName: string): Element | null {
  for (const child of childElements(parent)) {
    if (child.localName === localName) return child;
  }
  return null;
}

function childElements(parent: Element): Element[] {
  const out: Element[] = [];
  const list = parent.children;
  for (let i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}
