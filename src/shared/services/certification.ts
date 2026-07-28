import { Certification } from '../types.js';
import { ConflictError } from '../errors.js';

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
