import { test, expect } from '@playwright/test';
import { planFor, registryContextBlock, buildUserMessage, parsePlanFromLLMText, validateAndNormalize } from '../frontend/src/ai/Planner.js';
import { TOOL_REGISTRY } from '../frontend/src/ai/ToolRegistry.js';
import { PROVIDERS, COMPATIBLE_PRESETS } from '../frontend/src/ai/PlannerProviders.js';

test.describe('BYO-LLM Planner', () => {
  test.describe.configure({ timeout: 120000 });

  test('Provider catalogue covers cloud + local', () => {
    const keys = Object.keys(PROVIDERS);
    console.log(`\nProviders: ${keys.join(', ')}`);
    expect(keys).toEqual(expect.arrayContaining(['anthropic', 'openai', 'google', 'compatible']));
    // Compatible presets must cover at least one local + several cloud
    const localPresets = COMPATIBLE_PRESETS.filter(p => p.baseUrl.includes('localhost'));
    const cloudPresets = COMPATIBLE_PRESETS.filter(p => p.baseUrl.startsWith('https://'));
    console.log(`Compatible presets: ${localPresets.length} local, ${cloudPresets.length} cloud`);
    expect(localPresets.length).toBeGreaterThanOrEqual(3);     // ollama, lmstudio, vllm, llamafile
    expect(cloudPresets.length).toBeGreaterThanOrEqual(4);     // openrouter, together, groq, fireworks, mistral, deepinfra
  });

  test('Fallback when no provider configured: canonical engine plan', async () => {
    const r = await planFor({ userPrompt: 'Design a turbofan for an A350 successor.', domain: 'engine' });
    expect(r.source).toBe('fallback-canonical');
    expect(r.plan.length).toBeGreaterThanOrEqual(10);
    expect(r.plan[0].tool).toBe('Mission');
  });

  test('Domain-specific fallback for structure / gearbox', async () => {
    const s = await planFor({ userPrompt: 'A bracket', domain: 'structure' });
    expect(s.plan.some(p => p.tool === 'Linear Static FEA')).toBe(true);
    const g = await planFor({ userPrompt: 'A reducer', domain: 'gearbox' });
    expect(g.plan.some(p => p.tool === 'Gear Mesh')).toBe(true);
  });

  test('Prompt construction: registry context covers every tool', () => {
    const ctx = registryContextBlock();
    for (const t of TOOL_REGISTRY) {
      expect(ctx).toContain(t.name);
    }
    const msg = buildUserMessage('Design a heat exchanger', { effectiveness_target: 0.85, hot_inlet_K: 800 });
    expect(msg).toContain('heat exchanger');
    expect(msg).toContain('effectiveness_target: 0.85');
    expect(msg).toContain('hot_inlet_K: 800');
  });

  test('parsePlanFromLLMText handles raw JSON, fenced JSON, and prose-wrapped JSON', () => {
    const raw = '{"plan":[{"tool":"Brayton Cycle","comment":"start cycle"}]}';
    const fenced = "Here you go:\n```json\n" + raw + "\n```\nHope this helps.";
    const messy = "Sure, here's the plan: " + raw + " — let me know!";

    for (const candidate of [raw, fenced, messy]) {
      const p = parsePlanFromLLMText(candidate);
      expect(Array.isArray(p)).toBe(true);
      expect(p[0].tool).toBe('Brayton Cycle');
    }
    expect(parsePlanFromLLMText('not json at all')).toBe(null);
  });

  test('validateAndNormalize rejects unknown tools, accepts good plans', () => {
    const good = [
      { tool: 'Brayton Cycle', comment: 'cycle' },
      { tool: 'Combustor',     comment: 'burn' },
    ];
    const bad = [
      { tool: 'Brayton Cycle' },
      { tool: 'FakeTool',      comment: 'oops' },
    ];
    const g = validateAndNormalize(good);
    expect(g.ok).toBe(true);
    expect(g.normalized).toHaveLength(2);
    const b = validateAndNormalize(bad);
    expect(b.ok).toBe(false);
    expect(b.errors[0]).toContain('FakeTool');
  });

  test('Mock provider: planFor uses LLM output when generate() succeeds', async () => {
    const mockProvider = {
      label: 'Mock',
      defaultModel: 'mock-1',
      async generate({ userMessage }) {
        // Pretend we read the user message and produce a 3-step plan
        expect(userMessage).toContain('Goal:');
        return '```json\n{"plan":[' +
          '{"tool":"Brayton Cycle","comment":"start cycle"},' +
          '{"tool":"Combustor","comment":"size combustor"},' +
          '{"tool":"Turbine Stage","comment":"HPT mean-line"}' +
          ']}\n```';
      },
    };
    const r = await planFor({
      userPrompt: 'Design a small turbofan',
      clarifications: { bypass_ratio: 8 },
      domain: 'engine',
      providerOverride: mockProvider,
    });
    expect(r.source).toBe('llm');
    expect(r.plan).toHaveLength(3);
    expect(r.plan.map(s => s.tool)).toEqual(['Brayton Cycle', 'Combustor', 'Turbine Stage']);
  });

  test('Mock provider returning garbage: falls back gracefully', async () => {
    const mockBad = {
      label: 'Mock-bad',
      defaultModel: 'mock-bad',
      async generate() { return 'completely not json'; },
    };
    const r = await planFor({
      userPrompt: 'whatever',
      domain: 'engine',
      providerOverride: mockBad,
    });
    expect(r.source).toBe('fallback-error');
    expect(r.plan.length).toBeGreaterThan(0); // fallback engine plan
  });

  test('Mock provider returning unknown tool: falls back gracefully', async () => {
    const mockUnknown = {
      label: 'Mock-unknown',
      defaultModel: 'mock-unknown',
      async generate() {
        return '{"plan":[{"tool":"WidgetGenerator-9000","comment":"oops"}]}';
      },
    };
    const r = await planFor({
      userPrompt: 'whatever',
      domain: 'engine',
      providerOverride: mockUnknown,
    });
    expect(r.source).toBe('fallback-error');
    expect(r.errors.join(' ')).toContain('WidgetGenerator-9000');
  });
});

test.describe('AI Settings panel persists provider config', () => {
  test.describe.configure({ timeout: 120000 });

  test('Open panel, save provider+key, re-open recovers from localStorage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Open the AI launcher pill
    await page.locator('.ai-settings-launcher').click();
    const dlg = page.locator('.ai-settings-dialog');
    await expect(dlg).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);   // human dwell

    // Pick a compatible provider + Ollama preset
    await dlg.locator('[data-field="provider"]').selectOption('compatible');
    await page.waitForTimeout(1000);
    await dlg.locator('[data-field="preset"]').selectOption('ollama');
    await page.waitForTimeout(1000);

    // baseUrl + model should auto-fill from the preset
    const url = await dlg.locator('[data-field="baseUrl"]').inputValue();
    const model = await dlg.locator('[data-field="model"]').inputValue();
    console.log(`\nOllama preset filled: ${url} / ${model}`);
    expect(url).toContain('localhost:11434');
    expect(model).toContain('llama');

    // Stamp a fake API key + save
    await dlg.locator('[data-field="apiKey"]').fill('sk-test-1234');
    await dlg.locator('[data-action="save"]').click();
    await page.waitForTimeout(2000);

    // Close + re-open → fields recover
    await page.locator('.ai-settings-close').click();
    await expect(dlg).not.toBeVisible();
    await page.locator('.ai-settings-launcher').click();
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(1500);

    const recoveredKey = await dlg.locator('[data-field="apiKey"]').inputValue();
    const recoveredUrl = await dlg.locator('[data-field="baseUrl"]').inputValue();
    expect(recoveredKey).toBe('sk-test-1234');
    expect(recoveredUrl).toContain('localhost:11434');

    // Cleanup
    await page.evaluate(() => localStorage.removeItem('archdisc.llm'));
  });
});
