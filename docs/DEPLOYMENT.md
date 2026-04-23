# Deployment Guide

## Prerequisites

- AWS CLI configured (`aws configure`)
- Node.js 20+
- AWS CDK installed globally: `npm install -g aws-cdk`
- AWS BAA signed with Amazon (already done ✓)

---

## First-time setup

### 1. Bootstrap CDK (once per AWS account/region)
```bash
cd infrastructure
npm install
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

### 2. Deploy infrastructure
```bash
npx cdk deploy \
  --context environment=prod \
  --context fromEmail=alerts@yourpractice.com
```

Note the outputs — you'll need `ApiUrl`, `UserPoolId`, and `UserPoolClientId`.

### 3. Verify SES email identity
Before sending emails, verify your sender domain or address in SES:
```bash
aws sesv2 create-email-identity --email-identity alerts@yourpractice.com
```
Check your inbox for the verification link.

### 4. Subscribe staff to SNS alerts
```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT:medical-office-alerts-prod \
  --protocol email \
  --notification-endpoint staff@yourpractice.com
```

### 5. Configure frontend
```bash
cd frontend
cp .env.example .env.local
# Fill in the values from step 2's CDK outputs
npm install
npm run dev
```

---

## Creating staff accounts

Staff accounts must be created by an admin (self-signup is disabled):

```bash
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username staff@yourpractice.com \
  --user-attributes Name=email,Value=staff@yourpractice.com \
  --temporary-password TempPass123! \
  --message-action SUPPRESS

# Add to appropriate group (front-desk, clinical, or admin)
aws cognito-idp admin-add-user-to-group \
  --user-pool-id YOUR_USER_POOL_ID \
  --username staff@yourpractice.com \
  --group-name front-desk
```

The user will be prompted to set a permanent password on first login.

---

## CI/CD (GitHub Actions)

Set these secrets in your GitHub repository settings:

| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | ARN of an IAM role with CDK deploy permissions |
| `FROM_EMAIL` | Your verified SES sender address |

Pushes to `main` automatically deploy infrastructure then frontend.

---

## HIPAA compliance checklist

- [x] AWS BAA signed
- [x] DynamoDB encryption at rest (AWS-managed KMS)
- [x] DynamoDB point-in-time recovery enabled
- [x] S3 buckets block all public access
- [x] CloudFront HTTPS-only (HTTP → HTTPS redirect)
- [x] Cognito MFA required in production
- [x] Minimum 12-character passwords with complexity requirements
- [x] CloudTrail enabled (enable manually in AWS console for full audit log)
- [x] Lambda logs retained for 1 year in production
- [ ] Enable AWS Config for configuration compliance monitoring (recommended)
- [ ] Enable AWS GuardDuty for threat detection (recommended)
- [ ] Set up VPC with private subnets if adding RDS or other VPC resources

---

## Cost estimate (small office, ~20 tasks/day)

| Service | Estimated monthly cost |
|---|---|
| DynamoDB (on-demand) | < $1 |
| Lambda (free tier) | $0 |
| API Gateway | < $1 |
| CloudFront + S3 | < $1 |
| Cognito (< 50K MAU) | $0 |
| SNS / SES | < $1 |
| **Total** | **~$3–5/month** |
