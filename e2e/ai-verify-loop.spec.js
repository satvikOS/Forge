import { test, expect } from '@playwright/test';
import { buildVerifyPrompt, parseVerifyResponse } from '../frontend/src/ai/sculptor/PartVerifier.js';
import { sculptAndVerify } from '../frontend/src/ai/sculptor/PartSculptor.js';

test.describe('PartVerifier — verify prompt', () => {
  test('the verify prompt asks for matches / feedback / revisedOperations', () => {
    const p = buildVerifyPrompt();
    expect(p).toContain('matches');
    expect(p).toContain('feedback');
    expect(p).toContain('revisedOperations');
  });
});

test.describe('PartVerifier — parseVerifyResponse', () => {
  test('parses a matches:true verdict', () => {
    const v = parseVerifyResponse('{"matches":true,"feedback":"looks right","revisedOperations":null}');
    expect(v.matches).toBe(true);
    expect(v.feedback).toBe('looks right');
    expect(v.revisedOperations).toBe(null);
  });

  test('parses a matches:false verdict with a revised plan', () => {
    const v = parseVerifyResponse(JSON.stringify({
      matches: false, feedback: 'hole missing',
      revisedOperations: [{ op: 'startSketch' }, { op: 'finishSketch' }],
    }));
    expect(v.matches).toBe(false);
    expect(Array.isArray(v.revisedOperations)).toBe(true);
    expect(v.revisedOperations.length).toBe(2);
  });

  test('strips a ```json markdown fence', () => {
    const v = parseVerifyResponse('```json\n{"matches":true}\n```');
    expect(v.matches).toBe(true);
    expect(v.revisedOperations).toBe(null);
  });

  test('rejects a response with no boolean "matches"', () => {
    expect(() => parseVerifyResponse('{"feedback":"hmm"}')).toThrow(/matches/);
  });

  test('rejects input that is not JSON', () => {
    expect(() => parseVerifyResponse('the part looks fine to me')).toThrow(/could not parse/);
  });
});

test.describe('PartSculptor — sculptAndVerify loop', () => {
  test('accepts on round 1 when the LLM verdict matches', async () => {
    const calls = [];
    const result = await sculptAndVerify({
      description: 'a plate',
      requestPlan: async () => { calls.push('requestPlan'); return [{ op: 'finishSketch' }]; },
      executePlan: async (plan) => { calls.push('executePlan'); return { volume: 1 }; },
      renderAndCapture: async () => { calls.push('render'); return 'data:image/png;base64,AAA'; },
      verify: async () => ({ matches: true, feedback: 'good', revisedOperations: null }),
      maxRounds: 3,
    });
    expect(result.accepted).toBe(true);
    expect(result.rounds.length).toBe(1);
    expect(calls).toEqual(['requestPlan', 'executePlan', 'render']);
  });

  test('revises and re-executes when the first verdict fails', async () => {
    let verifyCall = 0;
    let executes = 0;
    const result = await sculptAndVerify({
      description: 'a plate with a hole',
      requestPlan: async () => [{ op: 'extrude', distance: 8 }],
      executePlan: async () => { executes++; return { volume: executes }; },
      renderAndCapture: async () => 'data:image/png;base64,AAA',
      verify: async () => {
        verifyCall++;
        return verifyCall === 1
          ? { matches: false, feedback: 'hole missing', revisedOperations: [{ op: 'cut', distance: 12 }] }
          : { matches: true, feedback: 'fixed', revisedOperations: null };
      },
      maxRounds: 3,
    });
    expect(result.accepted).toBe(true);
    expect(executes).toBe(2);
    expect(result.rounds.length).toBe(2);
    expect(result.rounds[0].matches).toBe(false);
    expect(result.rounds[1].matches).toBe(true);
  });

  test('stops unaccepted at maxRounds if the LLM keeps rejecting', async () => {
    const result = await sculptAndVerify({
      description: 'an impossible part',
      requestPlan: async () => [{ op: 'extrude', distance: 8 }],
      executePlan: async () => ({ volume: 1 }),
      renderAndCapture: async () => 'data:image/png;base64,AAA',
      verify: async () => ({ matches: false, feedback: 'still wrong', revisedOperations: [{ op: 'extrude', distance: 9 }] }),
      maxRounds: 2,
    });
    expect(result.accepted).toBe(false);
    expect(result.rounds.length).toBe(2);
  });
});
