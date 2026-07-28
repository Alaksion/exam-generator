import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ConflictError } from '../errors.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
} from '../repositories/certifications.js';
import { validateCertification, createCertification, CertificationLookup } from './certification.js';

vi.mock('../repositories/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  toPublicCertification: vi.fn(),
}));

const validCertification = {
  id: '11111111-1111-1111-1111-111111111111',
  provider: 'aws' as const,
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

const validInput = {
  provider: 'aws' as const,
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
  getByProviderCode: ReturnType<typeof vi.fn>;
} {
  const getByProviderCode = vi.fn().mockResolvedValue(exists ? validCertification : null);
  return { lookup: { getByProviderCode }, getByProviderCode };
}

describe('validateCertification', () => {
  it('returns a validated certification when all rules pass', async () => {
    const { lookup, getByProviderCode } = makeLookup(false);

    const result = await validateCertification(validCertification, lookup);

    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(getByProviderCode).toHaveBeenCalledWith('aws', 'CLF-C02');
  });

  it('throws when provider+code already exists', async () => {
    const { lookup } = makeLookup(true);

    await expect(validateCertification(validCertification, lookup)).rejects.toThrow(ConflictError);
  });

  it('throws for an invalid provider', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification({ ...validCertification, provider: 'invalid' }, lookup),
    ).rejects.toThrow(z.ZodError);
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
    ).rejects.toThrow(z.ZodError);
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
    ).rejects.toThrow(/Difficulty weights must sum to 1\.0/);
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
    ).rejects.toThrow(z.ZodError);
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
    ).rejects.toThrow(z.ZodError);
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
    ).rejects.toThrow(z.ZodError);
  });
});

describe('createCertification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a certification with a generated id', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);
    vi.mocked(createCertificationRecord).mockResolvedValue(undefined);

    const result = await createCertification(validInput);

    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(createCertificationRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'aws',
        code: 'CLF-C02',
      }),
    );
  });

  it('throws ConflictError when provider+code already exists', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(validCertification);

    await expect(createCertification(validInput)).rejects.toThrow(ConflictError);
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });

  it('throws ZodError for invalid input', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(createCertification({ ...validInput, provider: 'invalid' })).rejects.toThrow(z.ZodError);
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });
});
