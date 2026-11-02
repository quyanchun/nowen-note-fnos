/**
 * Build XMind content.json from MindMapData
 */
export function buildXmindContent(data: { root: { id: string; text: string; children: any[] } }, title: string) {
  const convertNode = (node: { id: string; text: string; children: any[] }): Record<string, unknown> => {
    const result: Record<string, unknown> = { id: node.id, title: node.text };
    if (node.children && node.children.length > 0) {
      result.children = { attached: node.children.map(convertNode) };
    }
    return result;
  };
  return [{ id: "sheet-1", title, rootTopic: convertNode(data.root) }];
}

/**
 * Build a minimal ZIP (no compression) from named Uint8Array buffers
 */
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    return table;
  })();
  function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const header = new ArrayBuffer(30 + nameBytes.length);
    const hView = new DataView(header);
    hView.setUint32(0, 0x04034b50, true);
    hView.setUint16(4, 20, true);
    hView.setUint16(6, 0, true);
    hView.setUint16(8, 0, true);
    hView.setUint16(10, 0, true);
    hView.setUint16(12, 0, true);
    const crc = crc32(file.data);
    hView.setUint32(14, crc, true);
    hView.setUint32(18, file.data.length, true);
    hView.setUint32(22, file.data.length, true);
    hView.setUint16(26, nameBytes.length, true);
    hView.setUint16(28, 0, true);
    new Uint8Array(header).set(nameBytes, 30);
    const headerBytes = new Uint8Array(header);
    parts.push(headerBytes);
    parts.push(file.data);

    const cde = new ArrayBuffer(46 + nameBytes.length);
    const cView = new DataView(cde);
    cView.setUint32(0, 0x02014b50, true);
    cView.setUint16(4, 20, true);
    cView.setUint16(6, 20, true);
    cView.setUint16(8, 0, true);
    cView.setUint16(10, 0, true);
    cView.setUint16(12, 0, true);
    cView.setUint16(14, 0, true);
    cView.setUint32(16, crc, true);
    cView.setUint32(20, file.data.length, true);
    cView.setUint32(24, file.data.length, true);
    cView.setUint16(28, nameBytes.length, true);
    cView.setUint16(30, 0, true);
    cView.setUint16(32, 0, true);
    cView.setUint16(34, 0, true);
    cView.setUint16(36, 0, true);
    cView.setUint32(38, 0, true);
    cView.setUint32(42, offset, true);
    new Uint8Array(cde).set(nameBytes, 46);
    centralDir.push(new Uint8Array(cde));
    offset += headerBytes.length + file.data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  centralDir.forEach((cd) => { parts.push(cd); centralDirSize += cd.length; });

  const eocd = new ArrayBuffer(22);
  const eView = new DataView(eocd);
  eView.setUint32(0, 0x06054b50, true);
  eView.setUint16(4, 0, true);
  eView.setUint16(6, 0, true);
  eView.setUint16(8, files.length, true);
  eView.setUint16(10, files.length, true);
  eView.setUint32(12, centralDirSize, true);
  eView.setUint32(16, centralDirOffset, true);
  eView.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd));

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const zipData = new Uint8Array(totalLen);
  let pos = 0;
  parts.forEach((p) => { zipData.set(p, pos); pos += p.length; });
  return zipData;
}

/**
 * Trigger download of a Blob as a file
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
