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
import { certification, certificationInput, certificationUpdate } from '../../test/fixtures/certification.js';

vi.mock('../repositories/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  getCertificationById: vi.fn(),
  updateCertification: vi.fn(),
}));

const mockedGetById = vi.mocked(getCertificationById);
const mockedUpdateRecord = vi.mocked(updateCertificationRecord);

const structuredDomains = certification.config.domains;

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

  it('throws when difficulty weights do not sum to 100', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...certification,
          config: {
            ...certification.config,
            difficultyDistribution: { easy: 50, medium: 50, hard: 10 },
          },
        },
        lookup,
      ),
    ).rejects.toThrow(/Difficulty weights must sum to 100/);
  });

  it('throws when domain weights do not sum to 100', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...certification,
          config: {
            ...certification.config,
            domains: [
              { ...structuredDomains[0], weight: 50 },
              { ...structuredDomains[1], weight: 30 },
            ],
          },
        },
        lookup,
      ),
    ).rejects.toThrow(/Domain weights must sum to 100/);
  });

  it('throws when a domain weight is below 1', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...certification,
          config: {
            ...certification.config,
            domains: [
              { ...structuredDomains[0], weight: 0 },
              { ...structuredDomains[1], weight: 50 },
              { ...structuredDomains[2], weight: 50 },
            ],
          },
        },
        lookup,
      ),
    ).rejects.toThrow(z.ZodError);
  });

  it('throws when a difficulty percentage is not an integer', async () => {
    const { lookup } = makeLookup(false);

    await expect(
      validateCertification(
        {
          ...certification,
          config: {
            ...certification.config,
            difficultyDistribution: { easy: 20, medium: 49.5, hard: 30.5 },
          },
        },
        lookup,
      ),
    ).rejects.toThrow(z.ZodError);
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
});

describe('createCertification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a certification with generated ids for domain and topics', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);
    vi.mocked(createCertificationRecord).mockResolvedValue(undefined);

    const result = await createCertification(certificationInput);

    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const saved = vi.mocked(createCertificationRecord).mock.calls[0][0];
    expect(saved.config.domains).toHaveLength(certificationInput.config.domains.length);
    for (const domain of saved.config.domains) {
      expect(domain.id).toMatch(/^[0-9a-f]{8}-/);
      for (const topic of domain.topics) {
        expect(topic.id).toMatch(/^[0-9a-f]{8}-/);
      }
    }
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

  function inputWithDomains(topics: unknown[]): unknown {
    return {
      ...certificationInput,
      config: {
        ...certificationInput.config,
        domains: [{ name: 'Cloud Concepts', weight: 100, topics }],
      },
    };
  }

  it('rejects a topic submitted as a bare string instead of a { name, context } object', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(createCertification(inputWithDomains(['Amazon S3']))).rejects.toThrow(z.ZodError);
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });

  it('rejects a topic with a missing context', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(createCertification(inputWithDomains([{ name: 'Amazon S3' }]))).rejects.toThrow(
      z.ZodError,
    );
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });

  it('rejects a topic with an empty or whitespace-only context', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(createCertification(inputWithDomains([{ name: 'Amazon S3', context: '' }]))).rejects.toThrow(
      z.ZodError,
    );
    await expect(
      createCertification(inputWithDomains([{ name: 'Amazon S3', context: ' '.repeat(40) }])),
    ).rejects.toThrow(z.ZodError);
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });

  it('rejects a topic with a context shorter than 20 characters', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(
      createCertification(inputWithDomains([{ name: 'Amazon S3', context: 'Object storage.' }])),
    ).rejects.toThrow(z.ZodError);
    expect(createCertificationRecord).not.toHaveBeenCalled();
  });

  it('rejects a topic with a context longer than 1500 characters', async () => {
    vi.mocked(getCertificationByProviderCode).mockResolvedValue(null);

    await expect(
      createCertification(inputWithDomains([{ name: 'Amazon S3', context: 'x'.repeat(1501) }])),
    ).rejects.toThrow(z.ZodError);
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

    const result = await updateCertificationById(certification.id, certificationUpdate);

    expect(result.id).toBe(certification.id);
    expect(result.provider).toBe('aws');
    expect(result.code).toBe('CLF-C02');
    expect(result.name).toBe(certificationUpdate.name);
    expect(result.isActive).toBe(certificationUpdate.isActive);
    expect(mockedUpdateRecord).toHaveBeenCalledWith(certification.id, {
      name: certificationUpdate.name,
      description: certificationUpdate.description,
      isActive: certificationUpdate.isActive,
      config: result.config,
    });
  });

  it('preserves domain and topic ids where names match and generates new ones otherwise', async () => {
    mockedGetById.mockResolvedValue(certification);
    mockedUpdateRecord.mockResolvedValue(undefined);

    const data = {
      ...certificationUpdate,
      config: {
        ...certificationUpdate.config,
        difficultyDistribution: { easy: 20, medium: 50, hard: 30 },
        domains: [
          {
            name: 'Cloud Concepts',
            weight: 60,
            topics: [
              { name: 'Amazon S3', context: certificationUpdate.config.domains[0].topics[0].context },
              {
                name: 'Amazon RDS',
                context:
                  'Amazon RDS is a managed relational database service. Covers supported database engines, Multi-AZ deployments for high availability, read replicas, automated backups and point-in-time recovery, security groups and encryption.',
              },
            ],
          },
          {
            name: 'Billing',
            weight: 40,
            topics: [{ name: 'Pricing', context: certificationUpdate.config.domains[2].topics[0].context }],
          },
        ],
      },
    };

    const result = await updateCertificationById(certification.id, data);

    const cloud = result.config.domains.find((d) => d.name === 'Cloud Concepts');
    expect(cloud?.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(cloud?.weight).toBe(60);
    const s3 = cloud?.topics.find((t) => t.name === 'Amazon S3');
    expect(s3?.id).toBe('33333333-3333-3333-3333-333333333333');
    const rds = cloud?.topics.find((t) => t.name === 'Amazon RDS');
    expect(rds?.id).toMatch(/^[0-9a-f]{8}-/);

    const billing = result.config.domains.find((d) => d.name === 'Billing');
    expect(billing?.id).toBe('88888888-8888-8888-8888-888888888888');
  });

  it('adopts the client-supplied context for a matched topic while preserving its id', async () => {
    mockedGetById.mockResolvedValue(certification);
    mockedUpdateRecord.mockResolvedValue(undefined);

    const rewrittenContext =
      'Amazon S3 provides durable object storage for any amount of data. Covers buckets, the S3 storage classes and lifecycle transitions, versioning, bucket policies and ACLs, static website hosting, and server-side encryption options.';
    const data = {
      ...certificationUpdate,
      config: {
        ...certificationUpdate.config,
        domains: [
          { name: 'Cloud Concepts', weight: 50, topics: [{ name: 'Amazon S3', context: rewrittenContext }] },
          ...certificationUpdate.config.domains.slice(1),
        ],
      },
    };

    const result = await updateCertificationById(certification.id, data);

    const s3 = result.config.domains[0].topics.find((t) => t.name === 'Amazon S3');
    expect(s3?.id).toBe('33333333-3333-3333-3333-333333333333');
    expect(s3?.context).toBe(rewrittenContext);
    expect(s3?.name).toBe('Amazon S3');
  });

  it('throws InvalidRequestError when provider is in the body', async () => {
    await expect(
      updateCertificationById(certification.id, { ...certificationUpdate, provider: 'azure' }),
    ).rejects.toThrow(InvalidRequestError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });

  it('throws InvalidRequestError when code is in the body', async () => {
    await expect(
      updateCertificationById(certification.id, { ...certificationUpdate, code: 'SAA-C03' }),
    ).rejects.toThrow(InvalidRequestError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when id does not exist', async () => {
    mockedGetById.mockResolvedValue(null);

    await expect(updateCertificationById(certification.id, certificationUpdate)).rejects.toThrow(NotFoundError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });

  it('throws ZodError when config is invalid', async () => {
    mockedGetById.mockResolvedValue(certification);

    await expect(
      updateCertificationById(certification.id, { ...certificationUpdate, config: { ...certificationUpdate.config, questionCount: 0 } }),
    ).rejects.toThrow(z.ZodError);
  });
});
