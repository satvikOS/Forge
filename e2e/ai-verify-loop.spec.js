import { test, expect } from '@playwright/test';
import { buildVerifyPrompt, parseVerifyResponse } from '../frontend/src/ai/sculptor/PartVerifier.js';

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
