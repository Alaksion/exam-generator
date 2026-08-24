import { describe, it, expect, afterEach } from 'vitest';
import { config } from './config.js';

afterEach(() => {
  delete process.env.EXAM_GENERATION_V2;
});

describe('examGenerationV2', () => {
  it('reads true when the env var is "true"', () => {
    process.env.EXAM_GENERATION_V2 = 'true';
    expect(config.examGenerationV2).toBe(true);
  });

  it('defaults to false when unset', () => {
    delete process.env.EXAM_GENERATION_V2;
    expect(config.examGenerationV2).toBe(false);
  });

  it('reads false for any value other than the literal "true"', () => {
    process.env.EXAM_GENERATION_V2 = 'false';
    expect(config.examGenerationV2).toBe(false);
    process.env.EXAM_GENERATION_V2 = '1';
    expect(config.examGenerationV2).toBe(false);
  });
});