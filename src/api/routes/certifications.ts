import { Router, jsonResponse } from '../../shared/router.js';
import { NotFoundError } from '../../shared/errors.js';
import { listCertifications, getCertificationById } from '../../shared/repositories/certifications.js';
import { toPublicCertification } from '../../shared/services/certification.js';

export function registerCertificationRoutes(router: Router): void {
  router.register('GET', '/v1/certifications', async () => {
    const certifications = await listCertifications();
    return jsonResponse(200, { items: certifications.map(toPublicCertification) });
  });

  router.register('GET', '/v1/certifications/{id}', async (_event, params) => {
    const certification = await getCertificationById(params.id);
    if (!certification) {
      throw new NotFoundError('Certification');
    }
    return jsonResponse(200, toPublicCertification(certification));
  });
}