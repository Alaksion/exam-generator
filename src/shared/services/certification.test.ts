import { describe, it, expect, vi } from 'vitest';
import { validateCertification, CertificationLookup } from './certification.js';

const validCertification = {
  id: '11111111-1111-1111-1111-111111111111',
  provider: 'aws',
  code: 'CLF-C02',
  name: 'AWS Certified Cloud Practitioner',
  version: 'v1',
  description: 'Entry-level AWS certification.',
  isActive: true,
  config: {
    questionCount: 10,
    difficultyDistribution: { easy: 0.2, medium: 0.5, hard: 0.3 },
    domains: ['Cloud Concepts'],
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    promptTemplate: 'Generate a {difficulty} question about {domain} for exam {code}.',
  },
};

function makeLookup(exists: boolean): {
  lookup: CertificationLookup;
  existsByProviderCode: ReturnType<typeof vi.fn>;
} {
  const existsByProviderCode = vi.fn().mockResolvedValue(exists);
  return { lookup: { existsByProviderCode }, existsByProviderCode };
}

describe('validateCertification', () => {
  it('returns a validated certification when all rules pass', async () => {
    const { lookup, existsByProviderCode } = makeLookup(false);

    const result = await validateCertification(validCertification, lookup);

    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(existsByProviderCode).toHaveBeenCalledWith('aws', 'CLF-C02');
  });

  it('throws when provider+code already exists', async () => {
    const { lookup } = makeLookup(true);

    await expect(validateCertification(validCertification, lookup)).rejects.toThrow(
      'Certification (aws, CLF-C02) already exists.',
    );
  });

  it('throws for an invalid provider', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification({ ...validCertification, provider: 'invalid' }, lookup),
    ).rejects.toThrow();
  });

  it('throws when questionCount is not positive', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...validCertification,
          config: { ...validCertification.config, questionCount: 0 },
        },
        lookup,
      ),
    ).rejects.toThrow();
  });

  it('throws when difficulty weights do not sum to 1.0', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...validCertification,
          config: {
            ...validCertification.config,
            difficultyDistribution: { easy: 0.5, medium: 0.5, hard: 0.1 },
          },
        },
        lookup,
      ),
    ).rejects.toThrow();
  });

  it('throws when domains are empty', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...validCertification,
          config: { ...validCertification.config, domains: [] },
        },
        lookup,
      ),
    ).rejects.toThrow();
  });

  it('throws when modelId is empty', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...validCertification,
          config: { ...validCertification.config, modelId: '' },
        },
        lookup,
      ),
    ).rejects.toThrow();
  });

  it('throws when promptTemplate is empty', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...validCertification,
          config: { ...validCertification.config, promptTemplate: '' },
        },
        lookup,
      ),
    ).rejects.toThrow();
  });
});
