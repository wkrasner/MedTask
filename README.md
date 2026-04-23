# Medical Office Task Tracker

AWS serverless application for managing prior authorizations, prescriptions, return calls, and scheduling.

## Architecture

- **Frontend**: React + TypeScript (Vite), hosted on S3 + CloudFront
- **API**: API Gateway → Lambda (Node.js)
- **Database**: DynamoDB (single-table design)
- **Auth**: Cognito User Pools
- **Notifications**: SNS (SMS) + SES (email)
- **IaC**: AWS CDK (TypeScript)
- **CI/CD**: GitHub Actions

## Project structure

```
medical-office-tracker/
├── frontend/          # React app
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       └── api/
├── backend/
│   ├── lambdas/
│   │   ├── tasks/         # Prior auths, prescriptions, return calls, scheduling
│   │   ├── auth/          # Cognito triggers
│   │   └── notifications/ # SNS/SES dispatcher
│   └── shared/            # Types, utilities
├── infrastructure/        # AWS CDK stacks
└── docs/
```

## Getting started

```bash
# Install dependencies
npm install

# Deploy infrastructure (dev)
cd infrastructure && cdk deploy --profile dev

# Start frontend dev server
cd frontend && npm run dev
```

## HIPAA notes

- Sign a BAA with AWS before storing PHI
- DynamoDB encryption at rest is enabled in the CDK stack
- CloudTrail audit logging is configured
- All S3 buckets block public access
- Cognito enforces MFA for clinical roles
- 
