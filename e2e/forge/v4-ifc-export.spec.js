// v4-ifc-export.spec.js — Forge-121 headed verification of the IFC4
// (ISO 16739) exporter.
//
// Flow:
//   01 launch headed Electron, confirm window.__forgeOpenIfcExport exists
//   02 seed two synthetic bodies on window.__forgeBodies
//   03 open the panel via window.__forgeOpenIfcExport()
//   04 stub forge.dialog.saveFile() so the export writes to /tmp/forge-test.ifc
//   05 click "Export IFC"
//   06 assert the file:
//        - starts with "ISO-10303-21;"
//        - contains FILE_SCHEMA(('IFC4'))
//        - contains IFCPROJECT
//        - contains IFCBUILDINGELEMENTPROXY
//        - contains at least two valid 22-char IfcGloballyUniqueIds
//        - ends with "END-ISO-10303-21;"
//
// Manual button clicks must NOT post to Archie's thread — this spec
// runs the panel cold (no Archie input).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-ifc';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);
const IFC_PATH = '/tmp/forge-test.ifc';

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · IFC4 exporter (Forge-121) headed', () => {
  let app, page;

  test.beforeAll(async () => {
    // Clean any stale artefact from a previous run so a stale IFC can't
    // make a broken export pass.
    try { fs.unlinkSync(IFC_PATH); } catch {}

    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // The shell + every panel host need a beat to mount.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 host is mounted and __forgeOpenIfcExport is callable', async () => {
    await shot(page, 'initial');
    const ok = await page.evaluate(
      () => typeof window.__forgeOpenIfcExport === 'function'
    );
    expect(ok, 'window.__forgeOpenIfcExport should be installed').toBe(true);
  });

  test('02 seed two bodies on window.__forgeBodies', async () => {
    // Seed synthetic bodies with spec.kind = box so meshForBody falls
    // back to the in-renderer mesh (no native kernel required for the
    // test). If the native kernel has tessellate, both work — the
    // exporter tries native first, then synthetic.
    const seeded = await page.evaluate(() => {
      const bodies = [
        {
          id: 'bdy-01',
          kind: 'synthetic',
          name: 'Column A1',
          spec: { kind: 'box', dx: 200, dy: 200, dz: 3000 },
          toolId: 'col-200',
          material: 'Concrete C30',
          mass: 144.0,
          xform: { x: 0, y: 0, z: 0 },
        },
        {
          id: 'bdy-02',
          kind: 'synthetic',
          name: 'Beam B1',
          spec: { kind: 'box', dx: 4000, dy: 300, dz: 500 },
          toolId: 'beam-300x500',
          material: 'Steel S355',
          mass: 471.0,
          xform: { x: 2000, y: 0, z: 3000 },
        },
      ];
      window.__forgeBodies = bodies;
      return bodies.length;
    });
    expect(seeded).toBe(2);
  });

  test('03 open the panel via window.__forgeOpenIfcExport()', async () => {
    await page.evaluate(() => {
      window.__forgeOpenIfcExport({
        projectName: 'Forge-121 Test',
        bodies: window.__forgeBodies,
      });
    });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-ifc-panel"]')).toBeVisible();
    await shot(page, 'panel-open');

    const v = await page.locator('[data-testid="forge-ifc-name"]').inputValue();
    expect(v).toBe('Forge-121 Test');

    // Both bodies should appear as rows in the storey-assignment table.
    await expect(page.locator('[data-testid="forge-ifc-row-bdy-01"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-ifc-row-bdy-02"]')).toBeVisible();
  });

  test('04 stub saveFile to /tmp/forge-test.ifc and click Export IFC', async () => {
    await page.evaluate((target) => {
      const f = window.forge || {};
      f.dialog = f.dialog || {};
      f.dialog.saveFile = async () => target;
      window.forge = f;
    }, IFC_PATH);

    await page.click('[data-testid="forge-ifc-export"]');
    await page.waitForSelector('[data-testid="forge-ifc-result"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    await shot(page, 'exported');

    const resultText = await page
      .locator('[data-testid="forge-ifc-result"]')
      .innerText();
    expect(resultText.startsWith('OK'), `expected OK result, got: ${resultText}`).toBe(true);
  });

  test('05 IFC file on disk parses as a valid IFC4 STEP21', async () => {
    // Give the main-process write a moment to flush.
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(IFC_PATH)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(IFC_PATH), `${IFC_PATH} should exist`).toBe(true);

    const text = fs.readFileSync(IFC_PATH, 'utf8');
    expect(text.length, 'ifc must be non-empty').toBeGreaterThan(512);

    // STEP21 envelope.
    expect(text.startsWith('ISO-10303-21;'),
           'must start with ISO-10303-21;').toBe(true);
    expect(text.trimEnd().endsWith('END-ISO-10303-21;'),
           'must end with END-ISO-10303-21;').toBe(true);

    // IFC4 schema declaration in HEADER.
    expect(text).toMatch(/FILE_SCHEMA\s*\(\s*\(\s*'IFC4'\s*\)\s*\)\s*;/);

    // Spatial backbone — every IFC consumer requires this exact set.
    expect(text).toMatch(/IFCPROJECT\(/);
    expect(text).toMatch(/IFCSITE\(/);
    expect(text).toMatch(/IFCBUILDING\(/);
    expect(text).toMatch(/IFCBUILDINGSTOREY\(/);

    // Per-body element type — default is the proxy class.
    expect(text).toMatch(/IFCBUILDINGELEMENTPROXY\(/);

    // Geometry — IFC4 faceted brep.
    expect(text).toMatch(/IFCFACETEDBREP\(/);
    expect(text).toMatch(/IFCSHAPEREPRESENTATION\(/);
    expect(text).toMatch(/IFCCLOSEDSHELL\(/);

    // Units block.
    expect(text).toMatch(/IFCSIUNIT\(/);
    expect(text).toMatch(/\.LENGTHUNIT\./);
    expect(text).toMatch(/\.METRE\./);

    // Owner / authoring chain.
    expect(text).toMatch(/IFCOWNERHISTORY\(/);
    expect(text).toMatch(/IFCAPPLICATION\(/);

    // Property set wired in via IfcRelDefinesByProperties — both seeded
    // bodies carry material + mass so the relationship must exist.
    expect(text).toMatch(/IFCPROPERTYSET\(/);
    expect(text).toMatch(/IFCRELDEFINESBYPROPERTIES\(/);

    // Aggregation: project → site → building → storeys.
    expect(text).toMatch(/IFCRELAGGREGATES\(/);
    expect(text).toMatch(/IFCRELCONTAINEDINSPATIALSTRUCTURE\(/);

    // 22-char buildingSMART IfcGloballyUniqueIds. The alphabet is
    // exactly [0-9A-Za-z_$]. We require at least 4 (project + site +
    // building + storey + 2 bodies + ownerhistory-by-derived). Scan
    // single-quoted tokens of length 22 from that alphabet.
    const guidRe = /'([0-9A-Za-z_$]{22})'/g;
    const guids = new Set();
    let m;
    while ((m = guidRe.exec(text)) !== null) guids.add(m[1]);
    expect(guids.size,
           `expected ≥4 IfcGloballyUniqueIds, found ${guids.size}`).toBeGreaterThanOrEqual(4);

    // Sanity-check the entity numbering is monotonic — no gaps in #N
    // ordering would prove the writer's id allocator works.
    const ids = [];
    const idRe = /^#(\d+)=\s/gm;
    while ((m = idRe.exec(text)) !== null) ids.push(parseInt(m[1], 10));
    expect(ids.length, 'must contain numbered entities').toBeGreaterThan(20);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBe(ids[i - 1] + 1);
    }

    // Material string from the seeded property set must show up
    // verbatim — confirms our s21 escape pipeline.
    expect(text).toContain('Concrete C30');
    expect(text).toContain('Steel S355');
  });
});
