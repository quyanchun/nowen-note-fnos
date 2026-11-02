// parsers/numbering.ts —— 解析 word/numbering.xml
//
// 为什么单独成文件：
//   numbering.xml 的结构（<w:num> 引用 <w:abstractNum>）是 OOXML 里独立
//   的一套继承体系，跟 styles.xml 完全无关。塞进 docx-parser 会让主流程
//   被 80 行无关解析淹没。
//
// 当前范围（W1.4-B）：
//   ✅ <w:abstractNum> 收集（id → 多 level 数组）
//   ✅ <w:num> → abstractNumId 映射（不解析 lvlOverride，罕见）
//   ✅ 每个 level 的 numFmt / lvlText / start / 缩进
//   ✅ Wingdings 私有码点映射成可见 Unicode（实心圆点 / 方块 / 菱形）
//   ✅ marker 模板渲染（"%1." / "%2)" / "%1.%2."）
//   ❌ chineseCounting / ideographDigital 等中文格式（有需要再加）
//   ❌ <w:lvlOverride>、<w:numStyleLink>（边角）
//
// 设计纪律：
//   - 解析层只生产数据，不做"当前是第几个" —— 那是 docx-parser 的事。
//   - 计数与重置发生在文档主流（按段落顺序遍历），不在这里。

/** 单个 abstract 列表的一个 level 定义。 */
export interface NumLevelDef {
  ilvl: number;
  /** 起始值（默认 1）。 */
  start: number;
  /**
   * decimal / lowerLetter / upperLetter / lowerRoman / upperRoman / bullet / ...
   * 不在白名单内的 numFmt 会按 decimal 兜底。
   */
  numFmt: string;
  /**
   * lvlText 模板，含 %1 %2 占位符（指代各级当前值）。
   * 例："%1." / "%2)" / "%1.%2." / "" (Wingdings 圆点)
   */
  lvlText: string;
  /** 缩进左偏移（pt），来自 lvl/pPr/ind/@w:left。 */
  indentLeft?: number;
  /** 悬挂缩进（pt）。 */
  indentHanging?: number;
}

/** numId → 该列表所有 level 定义（按 ilvl 顺序填充，索引 = ilvl）。 */
export type NumberingMap = Map<number, NumLevelDef[]>;

const TWIP_TO_PT = 1 / 20;

/**
 * 解析 numbering.xml。null / undefined / 解析失败 都返回空 map（调用方按"无列表"处理）。
 */
export function parseNumbering(doc: Document | null | undefined): NumberingMap {
  const map: NumberingMap = new Map();
  if (!doc) return map;

  // 第一遍：abstractNumId → levels
  const abstracts = new Map<number, NumLevelDef[]>();
  for (const child of childElements(doc.documentElement)) {
    if (child.localName !== "abstractNum") continue;
    const idRaw =
      child.getAttribute("w:abstractNumId") ||
      child.getAttribute("abstractNumId");
    const aid = parseInt(idRaw || "", 10);
    if (!Number.isFinite(aid)) continue;

    const levels: NumLevelDef[] = [];
    for (const lvl of childElements(child)) {
      if (lvl.localName !== "lvl") continue;
      const ilvl = parseInt(
        lvl.getAttribute("w:ilvl") || lvl.getAttribute("ilvl") || "",
        10,
      );
      if (!Number.isFinite(ilvl)) continue;
      levels.push(parseLvl(lvl, ilvl));
    }
    // 按 ilvl 排序后塞进数组（绝大多数文档已经有序，但稳一点）
    levels.sort((a, b) => a.ilvl - b.ilvl);
    abstracts.set(aid, levels);
  }

  // 第二遍：num → abstractNumId（同一 abstract 可能被多个 num 引用，各自独立计数）
  for (const child of childElements(doc.documentElement)) {
    if (child.localName !== "num") continue;
    const numIdRaw = child.getAttribute("w:numId") || child.getAttribute("numId");
    const numId = parseInt(numIdRaw || "", 10);
    if (!Number.isFinite(numId)) continue;
    const aRef = firstByLocalName(child, "abstractNumId");
    if (!aRef) continue;
    const aid = parseInt(
      aRef.getAttribute("w:val") || aRef.getAttribute("val") || "",
      10,
    );
    if (!Number.isFinite(aid)) continue;
    const levels = abstracts.get(aid);
    if (levels) map.set(numId, levels);
  }

  return map;
}

function parseLvl(lvl: Element, ilvl: number): NumLevelDef {
  const startEl = firstByLocalName(lvl, "start");
  const start = startEl
    ? parseInt(startEl.getAttribute("w:val") || startEl.getAttribute("val") || "1", 10)
    : 1;

  const fmtEl = firstByLocalName(lvl, "numFmt");
  const numFmt = (
    fmtEl?.getAttribute("w:val") ||
    fmtEl?.getAttribute("val") ||
    "decimal"
  ).toLowerCase();

  const txtEl = firstByLocalName(lvl, "lvlText");
  const lvlText =
    txtEl?.getAttribute("w:val") || txtEl?.getAttribute("val") || "";

  // pPr/ind 给 left/hanging
  let indentLeft: number | undefined;
  let indentHanging: number | undefined;
  const pPr = firstByLocalName(lvl, "pPr");
  if (pPr) {
    const ind = firstByLocalName(pPr, "ind");
    if (ind) {
      const left = readTwip(ind, ["w:left", "left", "w:start", "start"]);
      const hang = readTwip(ind, ["w:hanging", "hanging"]);
      if (left !== undefined) indentLeft = left;
      if (hang !== undefined) indentHanging = hang;
    }
  }

  return {
    ilvl,
    start: Number.isFinite(start) ? start : 1,
    numFmt,
    lvlText,
    indentLeft,
    indentHanging,
  };
}

function readTwip(el: Element, keys: string[]): number | undefined {
  for (const k of keys) {
    const raw = el.getAttribute(k);
    if (raw == null || raw === "") continue;
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return n * TWIP_TO_PT;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Marker 渲染：把 lvlText 模板 + 当前各级计数 → 可显示字符串
// ---------------------------------------------------------------------------

/**
 * 渲染 marker：替换 lvlText 里的 %N 为对应级别的当前值（按 numFmt 转字符串）。
 *
 * @param def       当前段落所在 ilvl 的 level 定义
 * @param counters  按 ilvl 索引的当前计数（counters[i] 是 ilvl=i 当前值）
 * @param levels    整个列表的所有 level 定义（用于把 %N 转成对应级的格式）
 *
 * 注意 lvlText 里的 N 是 1-based（%1 = ilvl=0），OOXML 标准如此。
 */
export function renderMarker(
  def: NumLevelDef,
  counters: number[],
  levels: NumLevelDef[],
): string {
  // bullet 不依赖计数，直接做 Wingdings 映射
  if (def.numFmt === "bullet") {
    return mapWingdings(def.lvlText);
  }
  // 模板替换 %1..%9
  return def.lvlText.replace(/%([1-9])/g, (_, d: string) => {
    const targetIlvl = parseInt(d, 10) - 1;
    const value = counters[targetIlvl] ?? 0;
    const fmt = levels[targetIlvl]?.numFmt ?? "decimal";
    return formatNumber(value, fmt);
  });
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "decimal":
    case "decimalzero":
      return String(n);
    case "lowerletter":
      return toLetter(n, false);
    case "upperletter":
      return toLetter(n, true);
    case "lowerroman":
      return toRoman(n).toLowerCase();
    case "upperroman":
      return toRoman(n);
    // 其它格式（chineseCounting / ideographDigital / ordinalText...）暂兜底
    default:
      return String(n);
  }
}

/** 1→a, 2→b, ..., 26→z, 27→aa（Excel 列名规则）。 */
function toLetter(n: number, upper: boolean): string {
  if (n <= 0) return "";
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode((upper ? 65 : 97) + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const pairs: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let s = "";
  let x = n;
  for (const [v, sym] of pairs) {
    while (x >= v) { s += sym; x -= v; }
  }
  return s;
}

/**
 * Wingdings 私有码点 → 可见 Unicode。
 * Word 的 lvlText 里塞这些字符 + rFonts="Wingdings"，
 * 但浏览器没装 Wingdings 字体就会显示豆腐块。映射成 Unicode 最稳。
 *
 * 覆盖最常见的几个码点；落网的私有字符（U+F000~U+F0FF 区间）
 * 兜底为 "•"，避免方框。普通 ASCII（如 "o" / "*"）原样保留。
 *
 * 为什么不全表映射：Wingdings 共 ~200 字形，多数是图标（电话/信封/星星…），
 * 在文档主体里当 bullet 用时只有"圆/方/菱"这几种，更冷门的字形真要遇到
 * 也不该用 Unicode 硬塞 —— 直接 • 兜底比错配字符更安全。
 */
function mapWingdings(s: string): string {
  if (!s) return "•";
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    switch (code) {
      // 常用映射（高频）
      case 0xf0b7: out += "•"; break;       // BULLET（默认 list bullet）
      case 0xf06c: out += "●"; break;       // 'l' → 实心圆（你这份样本就是它）
      case 0xf06e: out += "■"; break;       // 'n' → 实心方块
      case 0xf075: out += "◆"; break;       // 'u' → 菱形
      case 0xf0a7: out += "▪"; break;       // BLACK SMALL SQUARE
      case 0xf0a8: out += "▫"; break;       // WHITE SMALL SQUARE
      case 0xf076: out += "❖"; break;       // 装饰菱形
      case 0xf06f: out += "○"; break;       // 'o' → 空心圆
      case 0xf0d8: out += "▶"; break;       // 右三角
      case 0xf0fc: out += "✓"; break;       // 勾
      case 0xf0fb: out += "✗"; break;       // 叉
      default:
        // 私有区（Wingdings/Symbol）落网 → 统一兜底 "•"
        if (code >= 0xe000 && code <= 0xf8ff) out += "•";
        else out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOM helpers（与 styles.ts / docx-parser.ts 同款，复制避免循环依赖）
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
