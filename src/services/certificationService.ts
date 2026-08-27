import { v4 as uuidv4 } from 'uuid';
import {
  createCertification as createCertificationRecord,
  getCertificationById as getRecordById,
  getCertificationByProviderCode as getRecordByProviderCode,
  listActiveCertifications as listActiveRecords,
  updateCertification as updateCertificationRecord,
} from '../data/datasources/certifications.js';
import { type CertificationRecord } from '../data/model.js';
import { ConflictError, NotFoundError } from './errors.js';
import {
  type Certification,
  type CertificationConfig,
  type CertificationConfigInput,
  type CreateCertificationInput,
  type KnowledgeDomain,
  type UpdateCertificationInput,
} from './model.js';

export function mapCertificationRecordToCertification(record: CertificationRecord): Certification {
  return {
    id: record.id,
    provider: record.provider,
    code: record.code,
    name: record.name,
    description: record.description,
    isActive: record.isActive,
    config: record.config,
  };
}

function withGeneratedDomainIds(
  config: CertificationConfigInput,
  existingDomains: KnowledgeDomain[] = [],
): CertificationConfig {
  const existingByName = new Map(existingDomains.map((domain) => [domain.name, domain]));

  const domains: KnowledgeDomain[] = config.domains.map((input) => {
    const existing = existingByName.get(input.name);
    const existingTopicsByName = new Map(
      existing ? existing.topics.map((topic) => [topic.name, topic]) : [],
    );

    return {
      id: existing?.id ?? uuidv4(),
      name: input.name,
      weight: input.weight,
      topics: input.topics.map((topicInput) => {
        const existingTopic = existingTopicsByName.get(topicInput.name);
        return {
          id: existingTopic?.id ?? uuidv4(),
          name: topicInput.name,
          context: topicInput.context,
        };
      }),
    };
  });

  return {
    questionCount: config.questionCount,
    difficultyDistribution: config.difficultyDistribution,
    domains,
  };
}

export async function listCertifications(): Promise<Certification[]> {
  const records = await listActiveRecords();
  return records.map(mapCertificationRecordToCertification);
}

export async function getCertificationById(id: string): Promise<Certification | null> {
  const record = await getRecordById(id);
  return record ? mapCertificationRecordToCertification(record) : null;
}

export async function createCertification(input: CreateCertificationInput): Promise<Certification> {
  const existing = await getRecordByProviderCode(input.provider, input.code);
  if (existing) {
    throw new ConflictError(`Certification (${input.provider}, ${input.code}) already exists.`);
  }

  const record: CertificationRecord = {
    id: uuidv4(),
    provider: input.provider,
    code: input.code,
    name: input.name,
    description: input.description,
    isActive: input.isActive,
    config: withGeneratedDomainIds(input.config),
  };

  await createCertificationRecord(record);
  return mapCertificationRecordToCertification(record);
}

export async function updateCertificationById(
  id: string,
  input: UpdateCertificationInput,
): Promise<Certification> {
  const existing = await getRecordById(id);
  if (!existing) {
    throw new NotFoundError('Certification');
  }

  const next: CertificationRecord = {
    ...existing,
    name: input.name,
    description: input.description,
    isActive: input.isActive,
    config: withGeneratedDomainIds(input.config, existing.config.domains),
  };

  await updateCertificationRecord(id, {
    name: next.name,
    description: next.description,
    isActive: next.isActive,
    config: next.config,
  });

  return mapCertificationRecordToCertification(next);
}

export function toPublicCertification(certification: Certification): Certification {
  return certification;
}