// office/serializers/docx-blank.ts —— 生成最小可用空白 .docx
//
// 用途：阶段 1 的"新建 Word 文档"入口需要一份能直接被 Microsoft Word /
// WPS / LibreOffice 打开的空白 docx。我们不依赖 W2 完整序列化器，先用
// 一个硬编码的 OOXML 模板包成 zip 即可——只产出最骨架的结构：
//
//   [Content_Types].xml       内容类型声明
//   _rels/.rels               package 级关系（指向 word/document.xml）
//   word/_rels/document.xml.rels  document 级关系（暂为空）
//   word/document.xml         一个空段落 + sectPr（A4 页面）
//   docProps/core.xml         核心元数据（title / author / 时间）
//   docProps/app.xml          应用元数据
//
// 不做的事：
//   - 不写 styles.xml / numbering.xml / fontTable.xml —— 这些都是可选的，
//     缺了 Word 打开时会自动用默认样式渲染，最小可用即可。
//   - 不写主题（theme1.xml）—— 同上。
//   - 不嵌任何字体 —— 商用字体版权坑深，依赖客户端默认。
//
// 最小化好处：生成的文件只有 ~1.5KB，比 Word 自己 New Document 的 6KB 还小，
// 但合法。后续 W2 的完整 serializer 会替换掉这里。
//
// 为什么不静态打包一份 blank.docx 进 bundle？
//   - 静态二进制不便注入 title/author 的元数据
//   - 后续 W2 完整 serializer 落地时这套 OOXML 模板还可复用为骨架

import JSZip from "jszip";

/** XML 转义最小集——title/author 走这里。 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ISO 8601 时间，docProps/core.xml 用。 */
function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface BlankDocxOptions {
  /** 写入 docProps/core.xml 的 title。默认 "新建 Word 文档"。 */
  title?: string;
  /** 写入 docProps/core.xml 的 author。默认 "Nowen Note"。 */
  author?: string;
  /**
   * 文档体内的初始段落文本。默认为空（即一个空段落，光标可直接落入）。
   * 多段用 \n 分隔。每段都会变成一个独立 <w:p>。
   */
  initialText?: string;
}

/**
 * 生成空白 .docx 的二进制 Blob。
 *
 * 调用方拿到 Blob 后可以：
 *   - new File([blob], "新建文档.docx", { type: ... }) 然后走 attachments.upload
 *   - URL.createObjectURL(blob) 直接挂到 <a download> 让用户离线获取
 */
export async function createBlankDocx(
  opts: BlankDocxOptions = {},
): Promise<Blob> {
  const title = opts.title ?? "新建 Word 文档";
  const author = opts.author ?? "Nowen Note";
  const created = nowIso();

  // 段落体：把 initialText 按 \n 切成多个段落；空字符串/undefined 就给一个空段
  // 让 Word 打开后光标能直接落进去（完全没段落 Word 会报"文档损坏"）。
  const paragraphs = (() => {
    if (!opts.initialText) return ['<w:p/>'];
    const lines = opts.initialText.split(/\r?\n/);
    return lines.map((line) => {
      if (!line) return '<w:p/>';
      return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
    });
  })();

  // ---------- word/document.xml ----------
  // sectPr 给 A4 (11906 × 16838 twip) + 标准边距 (1440 twip = 1 inch)
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ---------- [Content_Types].xml ----------
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  // ---------- _rels/.rels ----------
  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  // ---------- word/_rels/document.xml.rels ----------
  // 暂时空——没有引用图片/超链接/样式表之类。
  const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  // ---------- docProps/core.xml ----------
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>${xmlEscape(author)}</dc:creator>
  <cp:lastModifiedBy>${xmlEscape(author)}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;

  // ---------- docProps/app.xml ----------
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Nowen Note</Application>
</Properties>`;

  // ---------- 打包 ----------
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("_rels/.rels", packageRelsXml);
  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", documentRelsXml);
  zip.file("docProps/core.xml", coreXml);
  zip.file("docProps/app.xml", appXml);

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/**
 * 把 Blob 包装成 File，便于直接喂给 api.attachments.upload。
 * 文件名会被规范成带 .docx 后缀。
 */
export function blankDocxFile(filename: string, blob: Blob): File {
  const safeName = /\.docx$/i.test(filename) ? filename : `${filename}.docx`;
  return new File([blob], safeName, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    lastModified: Date.now(),
  });
}
