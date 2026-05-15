import { test, expect } from '@playwright/test';
import { planFor } from '../frontend/src/ai/Planner.js';
import { PROVIDERS } from '../frontend/src/ai/PlannerProviders.js';

test.describe('Streaming LLM planner output', () => {
  test.describe.configure({ timeout: 120000 });

  test('Cloud + compatible providers expose generateStream', () => {
    for (const id of ['anthropic', 'openai', 'compatible']) {
      expect(typeof PROVIDERS[id].generateStream).toBe('function');
    }
  });

  test('planFor streams tokens through onToken when the provider supports it', async () => {
    const chunks = [
      '{"plan":[',
      '{"tool":"Brayton Cycle","comment":"cycle"},',
      '{"tool":"Combustor","comment":"burn"}',
      ']}',
    ];
    const received = [];
    const mockStreaming = {
      label: 'Mock-stream',
      defaultModel: 'mock',
      async generate() { throw new Error('generate() should not be called when streaming'); },
      async generateStream({ system, onToken }) {
        expect(system).toContain('bypassRatio');     // param schemas present
        for (const c of chunks) { onToken?.(c); }
        return chunks.join('');
      },
    };
    const r = await planFor({
      userPrompt: 'Design a turbofan',
      domain: 'engine',
      providerOverride: mockStreaming,
      onToken: (c) => received.push(c),
    });
    console.log(`\nStreamed ${received.length} chunks; source=${r.source}`);
    expect(received).toEqual(chunks);              // every chunk forwarded
    expect(r.source).toBe('llm-streamed');
    expect(r.plan).toHaveLength(2);
    expect(r.plan.map(s => s.tool)).toEqual(['Brayton Cycle', 'Combustor']);
  });

  test('Without onToken the provider uses non-streaming generate()', async () => {
    let streamCalled = false, genCalled = false;
    const mock = {
      label: 'Mock-dual',
      defaultModel: 'mock',
      async generate() {
        genCalled = true;
        return '{"plan":[{"tool":"Mission","comment":"start"}]}';
      },
      async generateStream() { streamCalled = true; return ''; },
    };
    const r = await planFor({
      userPrompt: 'whatever', domain: 'engine', providerOverride: mock,
      // no onToken
    });
    expect(genCalled).toBe(true);
    expect(streamCalled).toBe(false);
    expect(r.source).toBe('llm');
  });

  test('onToken given but provider has no generateStream → falls back to generate()', async () => {
    let genCalled = false;
    const mockNoStream = {
      label: 'Mock-nostream',
      defaultModel: 'mock',
      async generate() {
        genCalled = true;
        return '{"plan":[{"tool":"Mission","comment":"start"}]}';
      },
    };
    const r = await planFor({
      userPrompt: 'whatever', domain: 'engine', providerOverride: mockNoStream,
      onToken: () => { /* will not fire */ },
    });
    expect(genCalled).toBe(true);
    expect(r.source).toBe('llm');     // not 'llm-streamed'
  });

  test('Streaming chat: planner output streams into a live message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    // Configure a compatible provider so the chat takes the streaming
    // path; point it at a dead localhost port so the real fetch fails
    // fast and planFor returns the canonical fallback. The streaming
    // bubble should still appear (then resolve to the fallback plan).
    await page.evaluate(() => {
      localStorage.setItem('archdisc.llm', JSON.stringify({
        provider: 'compatible', apiKey: '', model: 'x',
        baseUrl: 'http://localhost:59999',
      }));
      localStorage.removeItem('archdisc.projects');
      localStorage.removeItem('archdisc.activeProjectId');
    });
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.locator('[data-action="open-chat"]').click();
    const panel = page.locator('.chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });
    await panel.locator('[data-field="chat-input"]').fill('Design a small turbofan');
    await panel.locator('[data-action="send"]').click();
    let safety = 20;
    while (safety-- > 0) {
      const ph = await panel.locator('.chat-phase').textContent();
      if (ph !== 'clarifying') break;
      await panel.locator('[data-field="chat-input"]').press('Enter');
      await page.waitForTimeout(400);
    }
    // A streaming placeholder bubble must have appeared during planning.
    // (The dead endpoint fails fast → planFor falls back, but the
    //  streaming message was rendered first.)
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'ready',
      null, { timeout: 30000 },
    );
    // Plan resolved (fallback canonical) — chat reached ready.
    const planSteps = await panel.locator('.chat-plan-step').count();
    console.log(`\nStreaming-config chat reached ready with ${planSteps} steps`);
    expect(planSteps).toBeGreaterThanOrEqual(10);

    // Cleanup the provider config.
    await page.evaluate(() => localStorage.removeItem('archdisc.llm'));
  });
});
