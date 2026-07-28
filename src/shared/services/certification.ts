import { v4 as uuidv4 } from 'uuid';
import { Certification } from '../types.js';
import { ConflictError } from '../errors.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
} from '../repositories/certifications.js';

const CreateCertificationRequest = Certification.omit({ id: true });

export interface CertificationLookup {
  getByProviderCode(provider: string, code: string): Promise<Certification | null>;
}

export async function validateCertification(
  data: unknown,
  lookup: CertificationLookup,
): Promise<Certification> {
  const certification = Certification.parse(data);

  if (await lookup.getByProviderCode(certification.provider, certification.code)) {
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
    getByProviderCode: getCertificationByProviderCode,
  });

  await createCertificationRecord(validated);
  return validated;
}
