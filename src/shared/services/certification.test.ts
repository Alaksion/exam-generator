import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ConflictError, InvalidRequestError, NotFoundError } from '../errors.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../repositories/certifications.js';
import {
  validateCertification,
  createCertification,
  updateCertificationById,
  CertificationLookup,
} from './certification.js';
import { certification, certificationInput } from '../../test/fixtures/certification.js';

vi.mock('../repositories/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  getCertificationById: vi.fn(),
  updateCertification: vi.fn(),
}));

const mockedGetById = vi.mocked(getCertificationById);
const mockedUpdateRecord = vi.mocked(updateCertificationRecord);

const updateInput = {
  name: 'Updated AWS Certified Cloud Practitioner',
  description: 'Updated description.',
  version: 'v2',
  isActive: false,
  config: certificationInput.config,
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

    const result = await validateCertification(certification, lookup);

    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(existsByProviderCode).toHaveBeenCalledWith('aws', 'CLF-C02');
  });

  it('throws when provider+code already exists', async () => {
    const { lookup } = makeLookup(true);

    await expect(validateCertification(certification, lookup)).rejects.toThrow(ConflictError);
  });

  it('throws for an invalid provider', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification({ ...certification, provider: 'invalid' }, lookup),
    ).rejects.toThrow(z.ZodError);
  });

  it('throws when questionCount is not positive', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...certification,
          config: { ...certification.config, questionCount: 0 },
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
          ...certification,
          config: {
            ...certification.config,
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
          ...certification,
          config: { ...certification.config, domains: [] },
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
          ...certification,
          config: { ...certification.config, modelId: '' },
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
          ...certification,
          config: { ...certification.config, promptTemplate: '' },
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

    const result = await createCertification(certificationInput);

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
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(certification);

    await expect(createCertification(certificationInput)).rejects.toThrow(ConflictError);
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });

  it('throws ZodError for invalid input', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(createCertification({ ...certificationInput, provider: 'invalid' })).rejects.toThrow(
      z.ZodError,
    );
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });
});

describe('updateCertificationById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates mutable fields and keeps id, provider, code', async () => {
    mockedGetById.mockResolvedValue(certification);
    mockedUpdateRecord.mockResolvedValue(undefined);

    const result = await updateCertificationById(certification.id, updateInput);

    expect(result.id).toBe(certification.id);
    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(result.name).toBe(updateInput.name);
    expect(result.isActive).toBe(updateInput.isActive);
    expect(mockedUpdateRecord).toHaveBeenCalledWith(certification.id, updateInput);
  });

  it('throws InvalidRequestError when provider is in the body', async () => {
    await expect(
      updateCertificationById(certification.id, { ...updateInput, provider: 'azure' }),
    ).rejects.toThrow(InvalidRequestError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });

  it('throws InvalidRequestError when code is in the body', async () => {
    await expect(
      updateCertificationById(certification.id, { ...updateInput, code: 'SAA-C03' }),
    ).rejects.toThrow(InvalidRequestError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when id does not exist', async () => {
    mockedGetById.mockResolvedValue(null);

    await expect(updateCertificationById(certification.id, updateInput)).rejects.toThrow(NotFoundError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });

  it('throws ZodError when config is invalid', async () => {
    mockedGetById.mockResolvedValue(certification);

    await expect(
      updateCertificationById(certification.id, { ...updateInput, config: { ...updateInput.config, questionCount: 0 } }),
    ).rejects.toThrow(z.ZodError);
  });
});
