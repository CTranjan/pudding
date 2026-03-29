# Pudding

Scheduled voice announcements for Amazon Echo Dot — medication and daily routine reminders for a family member with dementia.

Uses AWS Lambda + EventBridge Scheduler to send voice commands to an Echo Dot via the unofficial `alexa-remote2` library.

## Prerequisites

- Node.js 20+
- pnpm
- AWS CLI configured with credentials (`aws configure`)
- AWS CDK bootstrapped in your account/region:
  ```bash
  pnpm cdk bootstrap aws://ACCOUNT_ID/us-east-2
  ```
- An Amazon Echo Dot registered to an amazon.com.br account

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Generate the Alexa session cookie

Run the setup script on a machine with a web browser:

```bash
pnpm setup
```

This will:
1. Start a local proxy on `http://localhost:3001`
2. Open your browser — log into your amazon.com.br account
3. List your Echo devices — select the target Echo Dot
4. Save the session cookie and device serial to AWS SSM Parameter Store

### 3. Deploy the CDK stack

```bash
pnpm deploy -c alertEmail=your-email@example.com
```

### 4. Confirm SNS email subscription

AWS sends a confirmation email to the alert address. Click the link to subscribe.

### 5. Test manually

```bash
aws lambda invoke \
  --function-name pudding-announcement \
  --payload '{"message":"Teste!","commandType":"speak","reminderId":"test"}' \
  --cli-binary-format raw-in-base64-out \
  out.json
```

You should hear the Echo Dot speak "Teste!".

## How Reminders Work

Reminders are defined in `src/config/reminders.ts`. Each reminder has:
- `id` — unique identifier
- `schedule` — EventBridge cron expression
- `message` — text to be spoken
- `commandType` — `'speak'` (target device only) or `'announcement'` (can show on displays)

All schedules use the `America/Sao_Paulo` timezone.

### Default Reminders

| Time | ID | Message |
|------|----|---------|
| 8:00 AM | morning-medication | Bom dia! Está na hora de tomar o remédio da manhã. |
| 12:00 PM | lunch | Hora do almoço! |
| 3:00 PM | afternoon-medication | Está na hora do remédio da tarde. |
| 6:00 PM | dinner | Hora do jantar! |
| 8:00 PM | night-medication | Hora do remédio da noite. Boa noite! |

### Adding or Editing Reminders

1. Edit `src/config/reminders.ts`
2. Redeploy: `pnpm deploy -c alertEmail=your-email@example.com`

## Cookie Management

The Amazon session cookie expires approximately every 14 days. Pudding handles this automatically:

- **Auto-refresh Lambda** runs every 3 days and refreshes the cookie
- **If refresh fails**, you receive an email alert via SNS
- **To fix a failed refresh**, re-run the setup script: `pnpm setup`

## Architecture

```
EventBridge Scheduler (5 cron rules) → Announcement Lambda → Echo Dot
EventBridge Scheduler (every 3 days) → Cookie Refresh Lambda → SSM
                                                              ↓ (on failure)
                                                             SNS → Email Alert
```

## Running Tests

```bash
pnpm test          # single run
pnpm test:watch    # watch mode
```

## Troubleshooting

### "Cookie expired" errors
Re-run `pnpm setup` to generate a fresh cookie.

### CAPTCHA or 2FA during setup
The proxy-based login shows the real Amazon login page. Complete any CAPTCHA or 2FA challenges in the browser.

### Echo Dot not found
Ensure the device is online and registered to the same Amazon account used during setup.

### Lambda timeout
If the Lambda times out, the Echo Dot may be offline or unreachable. Check CloudWatch logs for details.

## Tech Stack

- **Runtime**: Node.js 20 (Lambda)
- **IaC**: AWS CDK (TypeScript)
- **Scheduling**: EventBridge Scheduler
- **Secrets**: AWS SSM Parameter Store (SecureString)
- **Alexa**: alexa-remote2 + alexa-cookie2
- **Tests**: Vitest
- **Region**: us-east-2
- **Cost**: ~$0.10/month (essentially free tier)
