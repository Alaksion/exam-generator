import { Certification } from '../../shared/types.js';

function topicContext(domainName: string, topicName: string): string {
  const domain = certificationInput.config.domains.find((d) => d.name === domainName);
  const topic = domain?.topics.find((t) => t.name === topicName);
  if (!topic) {
    throw new Error(`Fixture topic not found: ${domainName}/${topicName}`);
  }
  return topic.context;
}

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
      {
        name: 'Cloud Concepts',
        weight: 50,
        topics: [
          {
            name: 'Amazon S3',
            context:
              'Amazon S3 is AWS persistent object storage. Covers the storage classes (Standard, Intelligent-Tiering, Standard-IA, Glacier), bucket creation and versioning, bucket policies for public and private access, lifecycle rules that transition objects between classes, static website hosting, and S3 encryption at rest and in transit.',
          },
          {
            name: 'Amazon EC2',
            context:
              'Amazon EC2 provides resizable virtual servers on demand. Covers instance types and families, launching and connecting via key pairs and security groups, EBS volumes and snapshots, the On-Demand, Reserved and Spot pricing models, and how Auto Scaling groups and Elastic Load Balancing keep applications available.',
          },
        ],
      },
      {
        name: 'Security',
        weight: 30,
        topics: [
          {
            name: 'IAM',
            context:
              'IAM controls who can access AWS and what they can do. Covers users, groups and roles, how policies grant permissions, the principle of least privilege, password and access key management, multi-factor authentication, and patterns such as assigning a role to an EC2 instance.',
          },
          {
            name: 'Shared Responsibility',
            context:
              'The shared responsibility model divides security duties between AWS and the customer. AWS is responsible for the security of the cloud: facilities, hardware, software, networking, and patching the underlying host. The customer is responsible for security in the cloud: their data, IAM, guest operating system, network configuration, and encryption.',
          },
        ],
      },
      {
        name: 'Billing',
        weight: 20,
        topics: [
          {
            name: 'Pricing',
            context:
              'AWS pricing, billing, and account management at the Cloud Practitioner level. Covers pay-as-you-go pricing, savings from reserved and volume use, the free tier, consolidated billing, AWS Budgets and Cost Explorer for tracking spend, and the characteristics of each AWS Support tier.',
          },
        ],
      },
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
          {
            id: '33333333-3333-3333-3333-333333333333',
            name: 'Amazon S3',
            context: topicContext('Cloud Concepts', 'Amazon S3'),
          },
          {
            id: '44444444-4444-4444-4444-444444444444',
            name: 'Amazon EC2',
            context: topicContext('Cloud Concepts', 'Amazon EC2'),
          },
        ],
      },
      {
        id: '55555555-5555-5555-5555-555555555555',
        name: 'Security',
        weight: 30,
        topics: [
          {
            id: '66666666-6666-6666-6666-666666666666',
            name: 'IAM',
            context: topicContext('Security', 'IAM'),
          },
          {
            id: '77777777-7777-7777-7777-777777777777',
            name: 'Shared Responsibility',
            context: topicContext('Security', 'Shared Responsibility'),
          },
        ],
      },
      {
        id: '88888888-8888-8888-8888-888888888888',
        name: 'Billing',
        weight: 20,
        topics: [
          {
            id: '99999999-9999-9999-9999-999999999999',
            name: 'Pricing',
            context: topicContext('Billing', 'Pricing'),
          },
        ],
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