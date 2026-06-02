// v4-197-webhook.spec.js — Forge-197 embedded webhook receiver.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const SHOT_DIR = '/tmp/v4-197-webhook';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

function postJson(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      method: 'POST', hostname: '127.0.0.1', port,
      path: '/webhook',
      headers: { 'content-type': 'application/json',
                 'content-length': Buffer.byteLength(payload),
                 ...headers },
    }, (res) => {
      let out = '';
      res.on('data', (c) => out += c);
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

test.describe.serial('Forge-197 · webhook receiver', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 webhook bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.webhook?.start === 'function');
    expect(has).toBe(true);
  });

  test('02 open webhook panel + start listener', async () => {
    await page.evaluate(() => { window.__forgeOpenWebhookWorkbench?.(); });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="forge-webhook-panel"]')).toBeVisible();
    await page.locator('[data-testid="forge-webhook-port"]').fill('9598');
    await page.locator('[data-testid="forge-webhook-start"]').click();
    await page.waitForTimeout(500);
    const status = await page.locator('[data-testid="forge-webhook-status"]').innerText();
    expect(status).toMatch(/listening on 127\.0\.0\.1:9598/);
    await shot(page, 'listening');
  });

  test('03 POST a payload — log shows it', async () => {
    const r = await postJson(9598, { event: 'push', ref: 'refs/heads/main', sha: 'abc123' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    await page.waitForTimeout(500);
    const log = await page.locator('[data-testid="forge-webhook-log"]').innerText();
    expect(log).toContain('POST');
    expect(log).toContain('push');
    await shot(page, 'after-post');
  });

  test('04 status returns running + count', async () => {
    const s = await page.evaluate(() => window.forge.webhook.status());
    expect(s.running).toBe(true);
    expect(s.port).toBe(9598);
    expect(s.count).toBeGreaterThanOrEqual(1);
  });

  test('05 HMAC verification rejects unsigned payloads when secret set', async () => {
    await page.locator('[data-testid="forge-webhook-stop"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-webhook-secret"]').fill('s3cr3t');
    await page.locator('[data-testid="forge-webhook-start"]').click();
    await page.waitForTimeout(500);
    const r = await postJson(9598, { e: 't' });   // no signature header
    expect(r.status).toBe(401);
    await shot(page, 'rejected');
  });

  test('06 stop listener', async () => {
    await page.locator('[data-testid="forge-webhook-stop"]').click();
    await page.waitForTimeout(300);
    const status = await page.locator('[data-testid="forge-webhook-status"]').innerText();
    expect(status).toMatch(/stopped/);
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
