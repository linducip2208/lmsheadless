import { describe, it, expect } from 'vitest';
import { setup, mkOrg, mkUser, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { ...authHeader(tok) };
}

async function makeZip(files: Record<string, string>): Promise<ArrayBuffer> {
  const { default: JSZip } = (await import('jszip')) as unknown as {
    default: new () => {
      file(n: string, d: string): unknown;
      generateAsync(o: { type: 'arraybuffer' }): Promise<ArrayBuffer>;
    };
  };
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const MANIFEST_2004_SEQ = `<?xml version="1.0"?>
<manifest identifier="M1" xmlns="http://www.imscc.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
<metadata><schemaversion>2004 4th Edition</schemaversion></metadata>
<organizations default="O1"><organization identifier="O1"><title>Seq Course</title>
<item identifier="I1" identifierref="R1"><title>Lesson 1</title>
<sequencing><controlMode choice="true" flow="true"/><deliveryControls tracked="true"/></sequencing>
</item>
<item identifier="I2" identifierref="R1"><title>Lesson 2</title>
<sequencing><controlMode choice="false" flow="true"/></sequencing>
</item>
</organization></organizations>
<resources><resource identifier="R1" type="webcontent" adlcp:scormType="sco" href="index.html">
<file href="index.html"/></resource></resources></manifest>`;

describe('round8: h5p native + scorm 2004 sequencing', () => {
  it('h5p: upload validates manifest, lists, tracks attempt + score', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'h5p8');
    await mkUser(db, 't@h5p8.test', 'teacher', org);
    await mkUser(db, 's@h5p8.test', 'student', org);
    const tokT = (await login(app, 't@h5p8.test')).access_token;
    const tokS = (await login(app, 's@h5p8.test')).access_token;
    const buf = await makeZip({
      'h5p.json': JSON.stringify({ title: 'Drag the words', mainLibrary: 'H5P.DragText' }),
      'content/content.json': JSON.stringify({}),
    });
    const form = new FormData();
    form.set('organization_id', org);
    form.set('file', new File([buf], 'drag.h5p', { type: 'application/octet-stream' }));
    const up = await app.request('/api/v1/h5p/upload', {
      method: 'POST',
      headers: H(tokT),
      body: form,
    });
    expect(up.status).toBe(201);
    const pid = ((await up.json()) as { data: { id: string } }).data.id;
    const list = await app.request(`/api/v1/h5p/packages?organization_id=${org}`, {
      headers: H(tokT),
    });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: { id: string }[] }).data.some((p) => p.id === pid)).toBe(
      true
    );
    // Non-h5p rejected honestly.
    const badZip = await makeZip({ 'h5p.json': 'x' });
    const bad = new FormData();
    bad.set('organization_id', org);
    bad.set('file', new File([badZip], 'bad.zip', { type: 'application/zip' }));
    const badRes = await app.request('/api/v1/h5p/upload', {
      method: 'POST',
      headers: H(tokT),
      body: bad,
    });
    expect(badRes.status).toBe(400);
    // Attempt lifecycle.
    const att = await app.request('/api/v1/h5p/attempts', {
      method: 'POST',
      headers: { ...H(tokS), 'content-type': 'application/json' },
      body: JSON.stringify({ package_id: pid }),
    });
    expect(att.status).toBe(201);
    const aid = ((await att.json()) as { data: { id: string } }).data.id;
    const commit = await app.request(`/api/v1/h5p/attempts/${aid}/commit`, {
      method: 'POST',
      headers: { ...H(tokS), 'content-type': 'application/json' },
      body: JSON.stringify({ score: 8, max_score: 10, completed: true }),
    });
    expect(commit.status).toBe(200);
  });

  it('scorm 2004: sequencing nodes counted + exposed as linear-flow', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'seq8');
    await mkUser(db, 't@seq8.test', 'teacher', org);
    const tokT = (await login(app, 't@seq8.test')).access_token;
    const buf = await makeZip({
      'imsmanifest.xml': MANIFEST_2004_SEQ,
      'index.html': '<html><body>hi</body></html>',
    });
    const form = new FormData();
    form.set('organization_id', org);
    form.set('file', new File([buf], 'seq.zip', { type: 'application/zip' }));
    const up = await app.request('/api/v1/scorm/upload', {
      method: 'POST',
      headers: H(tokT),
      body: form,
    });
    expect(up.status).toBe(201);
    const pid = ((await up.json()) as { data: { id: string } }).data.id;
    const det = await app.request(`/api/v1/scorm/packages/${pid}`, {
      headers: H(tokT),
    });
    expect(det.status).toBe(200);
    const j = (await det.json()) as {
      data: { version: string; sequencing: { nodes: number; enforced: string } | string };
    };
    expect(j.data.version).toBe('2004');
    expect(typeof j.data.sequencing).toBe('object');
    if (typeof j.data.sequencing === 'object') {
      expect(j.data.sequencing.nodes).toBe(2);
      expect(j.data.sequencing.enforced).toBe('linear-flow');
    }
  });
});
