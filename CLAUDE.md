# Pudding — CLAUDE.md

## Project Overview

Scheduled voice announcements for Amazon Echo Dot via AWS Lambda + EventBridge Scheduler.
Uses alexa-remote2 (unofficial) to send speak/announcement commands to a specific Echo Dot.
Amazon account: amazon.com.br. Region: us-east-2.

## Stack
- **IaC**: AWS CDK (TypeScript)
- **Runtime**: Node.js 20 (Lambda, ARM64)
- **Scheduling**: EventBridge Scheduler
- **Secrets**: SSM Parameter Store (SecureString)
- **Alexa**: alexa-remote2 + alexa-cookie2
- **Tests**: Vitest
- **Package Manager**: pnpm

## Key Files
- `src/config/reminders.ts` — reminder definitions (cron, message, commandType)
- `src/lambda/announcement.ts` — sends voice command to Echo Dot
- `src/lambda/cookie-refresh.ts` — refreshes Amazon session cookie
- `src/stack/pudding-stack.ts` — CDK infrastructure
- `scripts/setup.ts` — initial cookie generation + device discovery

## SSM Parameters
- `/pudding/alexa-cookie-data` — SecureString, full cookie/registration data
- `/pudding/device-serial` — String, target Echo Dot serial number

## Commands
- `pnpm test` — run all tests
- `pnpm deploy -c alertEmail=...` — deploy CDK stack
- `pnpm setup` — run initial setup (requires browser)
- `pnpm synth` — synthesize CloudFormation template

## Brazil-specific Config
- `amazonPage: 'amazon.com.br'`
- `alexaServiceHost: 'alexa.amazon.com.br'`
- `baseAmazonPage: 'amazon.com'`
- `acceptLanguage: 'pt-BR'`
- Timezone: America/Sao_Paulo
