import { Certification } from '../../shared/types.js';

export const certificationInput = {
  provider: 'aws' as const,
  code: 'CLF-C02',
  name: 'AWS Certified Cloud Practitioner',
  description: 'Entry-level AWS certification.',
  isActive: true,
  config: {
    questionCount: 10,
    difficultyDistribution: { easy: 20, medium: 50, hard: 30 },
    domains: [
      { name: 'Cloud Concepts', weight: 50, topics: ['Amazon S3', 'Amazon EC2'] },
      { name: 'Security', weight: 30, topics: ['IAM', 'Shared Responsibility'] },
      { name: 'Billing', weight: 20, topics: ['Pricing'] },
    ],
  },
};

export const certification: Certification = {
  id: '11111111-1111-1111-1111-111111111111',
  ...certificationInput,
  config: {
    ...certificationInput.config,
    domains: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Cloud Concepts',
        weight: 50,
        topics: [
          { id: '33333333-3333-3333-3333-333333333333', name: 'Amazon S3' },
          { id: '44444444-4444-4444-4444-444444444444', name: 'Amazon EC2' },
        ],
      },
      {
        id: '55555555-5555-5555-5555-555555555555',
        name: 'Security',
        weight: 30,
        topics: [
          { id: '66666666-6666-6666-6666-666666666666', name: 'IAM' },
          { id: '77777777-7777-7777-7777-777777777777', name: 'Shared Responsibility' },
        ],
      },
      {
        id: '88888888-8888-8888-8888-888888888888',
        name: 'Billing',
        weight: 20,
        topics: [{ id: '99999999-9999-9999-9999-999999999999', name: 'Pricing' }],
      },
    ],
  },
};

export const certificationUpdate = {
  name: 'Updated AWS Certified Cloud Practitioner',
  description: 'Updated description.',
  isActive: false,
  config: certificationInput.config,
};
