import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PROVIDERS } from '../frontend/src/ai/PlannerProviders.js';

/*
 * Verifies the Azure AI Foundry provider against the real endpoint,
 * through ArchDisc's own BYO-LLM provider abstraction. Credentials come
 * from the gitignored .llm-credentials.local.json — skips cleanly if it
 * is absent so CI without a key still passes.
 */

const CRED_PATH = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED_PATH) ? JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')) : null;

test.describe('BYO-LLM — Azure provider', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live LLM test');
  test.describe.configure({ timeout: 90000 });

  test('provider returns structured JSON from the real model', async () => {
    const provider = PROVIDERS[cred.provider];
    expect(provider, `unknown provider "${cred.provider}"`).toBeTruthy();
    const raw = await provider.generate({
      apiKey: cred.apiKey,
      baseUrl: cred.endpoint,
      model: cred.deployment,
      apiVersion: cred.apiVersion,
      system: 'You are a CAD planning assistant. Reply with ONLY a JSON object, no prose, no code fences.',
      userMessage: 'Return a JSON object with keys "tool" (string) and "ready" (boolean). '
        + 'Use tool="Extrude Boss" and ready=true.',
    });
    console.log(`\n  ${cred.model} reply: ${raw.slice(0, 200)}`);

    // The agents depend on parseable structured output — extract the JSON.
    const match = raw.match(/\{[\s\S]*\}/);
    expect(match, 'response should contain a JSON object').toBeTruthy();
    const obj = JSON.parse(match[0]);
    expect(obj.tool).toBe('Extrude Boss');
    expect(obj.ready).toBe(true);
    console.log('  ✓ Azure AI Foundry provider works through ArchDisc PROVIDERS abstraction');
  });
});
