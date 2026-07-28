import { Certification } from '../../shared/types.js';

export const certificationInput = {
  provider: 'aws' as const,
  code: 'CLF-C02',
  name: 'AWS Certified Cloud Practitioner',
  version: 'v1',
  description: 'Entry-level AWS certification.',
  isActive: true,
  config: {
    questionCount: 10,
    difficultyDistribution: { easy: 0.2, medium: 0.5, hard: 0.3 },
    domains: ['Cloud Concepts'],
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    promptTemplate: 'Generate a {difficulty} question about {domain} for exam {code}.',
  },
};

export const certification: Certification = {
  id: '11111111-1111-1111-1111-111111111111',
  ...certificationInput,
};
