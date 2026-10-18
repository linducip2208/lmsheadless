// Shared stored-zip builder for E2E SCORM fixtures (no dependencies).
export function crc32(data: Uint8Array): number {
  let table: number[] | null = (crc32 as unknown as { t?: number[] }).t ?? null;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      (table as number[])[n] = c;
    }
    (crc32 as unknown as { t: number[] }).t = table;
  }
  let crc = 0xffffffff;
  for (const b of data) crc = (table as number[])[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new Uint8Array(30 + name.length + f.data.length);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, name.length, true);
    head.set(name, 30);
    head.set(f.data, 30 + name.length);
    chunks.push(head);
    // Central-directory header is 46 fixed bytes (APPNOTE 4.3.12).
    const cen = new Uint8Array(46 + name.length);
    const cd = new DataView(cen.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += head.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    chunks.push(c);
    cdSize += c.length;
  }
  const end = new Uint8Array(22);
  const ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, central.length, true);
  ed.setUint16(10, central.length, true);
  ed.setUint32(12, cdSize, true);
  ed.setUint32(16, cdStart, true);
  chunks.push(end);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function scorm12(tag: string, title: string): Uint8Array {
  const enc = new TextEncoder();
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest identifier="M-${tag}" version="1.2"><organizations default="O1"><organization identifier="O1"><title>${title}</title><item identifier="I1" identifierref="R1"><title>Lesson</title></item></organization></organizations><resources><resource identifier="R1" type="webcontent" href="index.html"><file href="index.html"/></resource></resources></manifest>`;
  return storedZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifest) },
    { name: 'index.html', data: enc.encode('<html><body>hi</body></html>') },
  ]);
}
