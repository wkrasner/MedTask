#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { MedicalOfficeStack } from '../stacks/medical-office-stack'

const app = new cdk.App()

const environment = (app.node.tryGetContext('environment') ?? 'dev') as 'dev' | 'prod'
const fromEmail = app.node.tryGetContext('fromEmail') ?? 'alerts@example.com'

new MedicalOfficeStack(app, 'MedicalOfficeStack', {
  environment,
  fromEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  tags: {
    Project: 'medical-office-tracker',
    Environment: environment,
    ManagedBy: 'CDK',
  },
})
