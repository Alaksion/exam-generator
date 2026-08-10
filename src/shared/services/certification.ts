import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  Certification,
  CertificationConfig,
  CertificationConfigInput,
  KnowledgeDomain,
  Provider,
} from '../types.js';
import { ConflictError, InvalidRequestError, NotFoundError } from '../errors.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../repositories/certifications.js';

const CreateCertificationRequest = z.object({
  provider: Provider,
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfigInput,
});

const UpdateCertificationRequest = z.object({
  name: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfigInput,
});

const IMMUTABLE_FIELDS = ['provider', 'code'] as const;

export interface CertificationLookup {
  existsByProviderCode(provider: string, code: string): Promise<boolean>;
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

export async function validateCertification(
  data: unknown,
  lookup: CertificationLookup,
): Promise<Certification> {
  const certification = Certification.parse(data);

  if (await lookup.existsByProviderCode(certification.provider, certification.code)) {
    throw new ConflictError(
      `Certification (${certification.provider}, ${certification.code}) already exists.`,
    );
  }

  return certification;
}

export async function createCertification(data: unknown): Promise<Certification> {
  const input = CreateCertificationRequest.parse(data);
  const certification: Certification = {
    ...input,
    id: uuidv4(),
    config: withGeneratedDomainIds(input.config),
  };

  const validated = await validateCertification(certification, {
    existsByProviderCode: async (provider, code) =>
      (await getCertificationByProviderCode(provider, code)) !== null,
  });

  await createCertificationRecord(validated);
  return validated;
}

export async function updateCertificationById(id: string, data: unknown): Promise<Certification> {
  const body =
    data !== null && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (IMMUTABLE_FIELDS.some((field) => field in body)) {
    throw new InvalidRequestError(`${IMMUTABLE_FIELDS.join(' and ')} are immutable.`);
  }

  const updates = UpdateCertificationRequest.parse(data);
  const existing = await getCertificationById(id);
  if (!existing) {
    throw new NotFoundError('Certification');
  }

  const next: Certification = {
    ...existing,
    name: updates.name,
    description: updates.description,
    isActive: updates.isActive,
    config: withGeneratedDomainIds(updates.config, existing.config.domains),
  };

  await updateCertificationRecord(id, {
    name: next.name,
    description: next.description,
    isActive: next.isActive,
    config: next.config,
  });
  return next;
}

export function toPublicCertification(certification: Certification): Certification {
  return certification;
}
