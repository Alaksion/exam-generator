import { v4 as uuidv4 } from 'uuid';
import { Certification } from '../types.js';
import { ConflictError, InvalidRequestError, NotFoundError } from '../errors.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../repositories/certifications.js';

const CreateCertificationRequest = Certification.omit({ id: true });
const UpdateCertificationRequest = Certification.omit({ id: true, provider: true, code: true });

export interface CertificationLookup {
  existsByProviderCode(provider: string, code: string): Promise<boolean>;
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
  const certification: Certification = { ...input, id: uuidv4() };

  const validated = await validateCertification(certification, {
    existsByProviderCode: async (provider, code) =>
      (await getCertificationByProviderCode(provider, code)) !== null,
  });

  await createCertificationRecord(validated);
  return validated;
}

export async function updateCertificationById(id: string, data: unknown): Promise<Certification> {
  const body = (data ?? {}) as Record<string, unknown>;
  if ('provider' in body || 'code' in body) {
    throw new InvalidRequestError('provider and code are immutable.');
  }

  const updates = UpdateCertificationRequest.parse(data);
  const existing = await getCertificationById(id);
  if (!existing) {
    throw new NotFoundError('Certification');
  }

  await updateCertificationRecord(id, updates);
  return { ...existing, ...updates, id, provider: existing.provider, code: existing.code };
}

export function toPublicCertification(
  certification: Certification,
): Omit<Certification, 'config'> & {
  config: Omit<Certification['config'], 'promptTemplate'>;
} {
  const { config: certConfig, ...rest } = certification;
  const { promptTemplate: _promptTemplate, ...publicConfig } = certConfig;
  return {
    ...rest,
    config: publicConfig,
  };
}
