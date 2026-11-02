
// opc/reader.ts —— Open Packaging Convention（OPC）读取层
//
// OOXML 文件（.docx / .xlsx / .pptx）本质是一个 zip，里面按规则放置 XML
// part 和资源。这里把 "zip + parts + 关系（rels）" 抽成 OpcPackage，让上
// 层 parser 不必关心 zip 细节。
//
// 复用项目已有的 jszip（package.json 里已存在），不引新依赖。
// 性能瓶颈出现后再换 fflate（体积小 5×、速度快 3×）。

import JSZip from "jszip";

/** 一个 OPC part：路径 + 内容（XML 给字符串，图片等给字节）。 */
export interface OpcPart {
  path: string;
  /** XML / 文本类 part；二进制 part 这里为 undefined，用 binary 字段。 */
  text?: string;
  binary?: Uint8Array;
}

/** OOXML 内"关系"条目（_rels/*.xml.rels）。Id → target 路径。 */
export interface OpcRelationship {
  id: string;
  type: string;
  target: string;
  /** External 关系（如超链接 URL），target 不是 zip 内路径。 */
  external?: boolean;
}

/**
 * 一个解析好的 OPC 包。
 *
 * 用法（W1.1 主路径）：
 *   const pkg = await OpcPackage.load(file);
 *   const docXml = pkg.getXml("word/document.xml");
 *   const rels   = pkg.getRels("word/document.xml");
 */
export class OpcPackage {
  private zip: JSZip;
  /** zip 内所有 part 的路径列表（小写归一化前的原始路径）。 */
  readonly entries: string[];

  private constructor(zip: JSZip, entries: string[]) {
    this.zip = zip;
    this.entries = entries;
  }

  static async load(input: File | Blob | ArrayBuffer | Uint8Array): Promise<OpcPackage> {
    const zip = await JSZip.loadAsync(input as any);
    const entries: string[] = [];
    zip.forEach((path) => {
      entries.push(path);
    });
    return new OpcPackage(zip, entries);
  }

  /** 取一个文本/XML part。不存在返回 undefined（让上层决定容错）。 */
  async getText(path: string): Promise<string | undefined> {
    const file = this.zip.file(this.normalize(path));
    if (!file) return undefined;
    return file.async("string");
  }

  /** 取一个二进制 part（图片等）。 */
  async getBinary(path: string): Promise<Uint8Array | undefined> {
    const file = this.zip.file(this.normalize(path));
    if (!file) return undefined;
    return file.async("uint8array");
  }

  /** 取 XML 并直接解析成 Document（用浏览器原生 DOMParser，零依赖）。 */
  async getXml(path: string): Promise<Document | undefined> {
    const text = await this.getText(path);
    if (text === undefined) return undefined;
    // OOXML 文件都是 application/xml；text/xml 也能解析中文不乱码。
    const doc = new DOMParser().parseFromString(text, "application/xml");
    // DOMParser 出错时不会 throw，会返回带 <parsererror> 的文档——这里
    // 做一次最起码的健康检查，让上层早失败。
    const err = doc.getElementsByTagName("parsererror")[0];
    if (err) {
      throw new Error(`OPC: XML parse error in ${path}: ${err.textContent || ""}`);
    }
    return doc;
  }

  /**
   * 取一个 part 对应的 rels 表。
   * 规则：part 路径 "word/document.xml" 的 rels 在 "word/_rels/document.xml.rels"。
   */
  async getRels(partPath: string): Promise<Map<string, OpcRelationship>> {
    const rels = new Map<string, OpcRelationship>();
    const relsPath = this.relsPathOf(partPath);
    const doc = await this.getXml(relsPath);
    if (!doc) return rels;
    // namespace 不强校验——OOXML 各家工具裁剪 ns 的方式略不同，按 localName 匹配最稳。
    const items = doc.getElementsByTagName("Relationship");
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const id = el.getAttribute("Id") || "";
      const type = el.getAttribute("Type") || "";
      const target = el.getAttribute("Target") || "";
      const mode = el.getAttribute("TargetMode");
      if (!id) continue;
      rels.set(id, {
        id,
        type,
        target,
        external: mode === "External",
      });
    }
    return rels;
  }

  // ---- private ----

  private normalize(path: string): string {
    // OOXML 内部路径不带前导斜杠；外部传进来 "/word/document.xml" 也兼容下。
    return path.replace(/^\/+/, "");
  }

  /** "word/document.xml" → "word/_rels/document.xml.rels" */
  private relsPathOf(partPath: string): string {
    const norm = this.normalize(partPath);
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return `_rels/${norm}.rels`;
    return `${norm.slice(0, slash)}/_rels/${norm.slice(slash + 1)}.rels`;
  }
}
