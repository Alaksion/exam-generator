import { Router } from '../router.js';
import { jsonResponse } from '../responses.js';
import { toCertificationDto } from '../mappers.js';
import { listCertifications, getCertificationById } from '../../services/certificationService.js';
import { NotFoundError } from '../../services/errors.js';

export function registerCertificationRoutes(router: Router): void {
  router.register('GET', '/v1/certifications', async () => {
    const certifications = await listCertifications();
    return jsonResponse(200, { items: certifications.map(toCertificationDto) });
  });

  router.register('GET', '/v1/certifications/{id}', async (_event, params) => {
    const certification = await getCertificationById(params.id);
    if (!certification) {
      throw new NotFoundError('Certification');
    }
    return jsonResponse(200, toCertificationDto(certification));
  });
}