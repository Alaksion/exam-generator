import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from './errors.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../data/datasources/certifications.js';
import {
  createCertification,
  updateCertificationById,
  mapCertificationRecordToCertification,
} from './certificationService.js';
import { certification, certificationInput, certificationUpdate } from '../test/fixtures/certification.js';

vi.mock('../data/datasources/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  getCertificationById: vi.fn(),
  updateCertification: vi.fn(),
  listActiveCertifications: vi.fn(),
}));

const mockedGetByProviderCode = vi.mocked(getCertificationByProviderCode);
const mockedGetById = vi.mocked(getCertificationById);
const mockedUpdateRecord = vi.mocked(updateCertificationRecord);

describe('mapCertificationRecordToCertification', () => {
  it('maps a stored record to the service model', () => {
    const result = mapCertificationRecordToCertification(certification);

    expect(result).toEqual(certification);
  });
});

describe('createCertification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a certification with generated ids for domain and topics', async () => {
    mockedGetByProviderCode.mockResolvedValue(null);
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
    mockedGetByProviderCode.mockResolvedValue(certification);

    await expect(createCertification(certificationInput)).rejects.toThrow(ConflictError);
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

  it('throws NotFoundError when id does not exist', async () => {
    mockedGetById.mockResolvedValue(null);

    await expect(updateCertificationById(certification.id, certificationUpdate)).rejects.toThrow(NotFoundError);
    expect(mockedUpdateRecord).not.toHaveBeenCalled();
  });
});