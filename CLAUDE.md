# Pudding — CLAUDE.md

## Token Efficiency Rules (read first)

- **Do NOT use Explore agents** to understand this project. All structure is documented here.
- **Do NOT read files you won't modify.** Use Grep to find the exact location, then Read with `offset`/`limit`.
- **Skip plan mode** for tasks scoped to ≤3 files. Just do it.
- **Run `/compact`** after finishing each distinct task before starting the next.
- When you need a pattern example, read ONE file — not all similar files.

---

## Project Overview

Scheduled voice announcements to an Amazon Echo Dot (Brazil) for dementia care.
Lambda triggered by EventBridge Scheduler → calls unofficial Alexa API → Echo Dot speaks.

- **Region**: us-east-2
- **Amazon account**: amazon.com.br (Brazil)
- **Timezone**: America/Sao_Paulo
- **Tests**: `pnpm test` (Vitest, 15 tests — must always pass)
- **Deploy**: `pnpm cdk deploy --require-approval never -c alertEmail=caiotranjan@gmail.com`
- **Synth only**: `pnpm synth -c alertEmail=caiotranjan@gmail.com`

---

## Stack

| Layer | Choice |
|-------|--------|
| IaC | AWS CDK (TypeScript) |
| Runtime | Node.js 20, Lambda, ARM64, 256MB |
| Scheduling | EventBridge Scheduler (NOT classic EventBridge Events) |
| Secrets | SSM Parameter Store (SecureString) |
| Alexa API | alexa-remote2 + alexa-cookie2 (unofficial) |
| Audio | S3 bucket `pudding-audio-051162627683` (public read) |
| Tests | Vitest |
| Package mgr | pnpm |

---

## File Map

```
src/
  lambda/
    announcement.ts       # Handler: receives AnnouncementEvent, calls Alexa API
    cookie-refresh.ts     # Handler: refreshes cookie via stored refresh token, writes new cookie+registration to SSM
  lib/
    alexa-client.ts       # getCustomerId, getDeviceType, sendSpeak, sendAnnouncement, sendAnnouncementWithAudio, sendRadio, sendStop, getNowPlaying
    alexa-cookie-refresh.ts # refreshRegistration() — promise wrapper around alexa-cookie2.refreshAlexaCookie
    ssm.ts                # getCookieString(), getDeviceSerial(), getRegistrationData(), putCookieString(), putRegistrationData()
    types.ts              # AnnouncementEvent, CookieData, ALEXA_CONFIG, SSM_PATHS
  stack/
    pudding-stack.ts      # CDK stack — all AWS resources
  config/
    reminders.ts          # TIMEZONE constant only (reminders now live in portal DB)

scripts/
  setup.ts                # Interactive: browser login → saves cookie+serial to SSM
  upload-audio.ts         # CLI: upload MP3 to pudding-audio bucket
                          # Usage: pnpm upload-audio <file.mp3> <reminder-id>

tests/
  announcement.test.ts    # 12 tests — speak, announcement, audio, radio, stop, volume, SSM errors
  cookie-refresh.test.ts  # 3 tests — valid cookie, expired cookie, SSM failure
```

---

## Key Interfaces

```typescript
// src/lib/types.ts
interface AnnouncementEvent {
  message: string;              // plain text (always present, used for display)
  commandType: 'speak' | 'announcement' | 'radio' | 'stop' | 'now-playing';
  reminderId: string;
  audioUrl?: string;            // S3 URL — if present, SSML <audio> is used instead of TTS
  volume?: number;              // 1–10, sets device volume before speaking
  restoreVolume?: number;       // 1–10, restores volume after speaking
  introText?: string;           // spoken before audio plays (only with audioUrl)
}

// SSM paths
const SSM_PATHS = {
  COOKIE: '/pudding/alexa-cookie-data',                // SecureString — raw cookie string (used by announcement Lambda)
  DEVICE_SERIAL: '/pudding/device-serial',             // String
  REGISTRATION: '/pudding/alexa-registration-data',    // SecureString — full alexa-cookie2 bundle incl. refreshToken (used by cookie-refresh Lambda)
}
```

---

## AWS Resources (deployed)

| Resource | Name/ARN |
|----------|----------|
| Lambda — announcement | `pudding-announcement` |
| Lambda — cookie refresh | `pudding-cookie-refresh` |
| S3 bucket | `pudding-audio-051162627683` (public read, CORS for c4i0apps.com) |
| SNS topic | `pudding-alerts` — alert email: caiotranjan@gmail.com |
| EventBridge cookie refresh | `pudding-cookie-refresh` (rate 3 days) |
| CloudWatch alarm | `pudding-announcement-errors` (fires on Lambda error) |
| Scheduler IAM role | `PuddingStack-SchedulerRole59E73443-zKJzgwNkPJHN` |

**SSM Parameters (portal uses these):**
- `/pudding/announcement-fn-arn`
- `/pudding/scheduler-role-arn`
- `/pudding/audio-bucket-name`

---

## Reminder Management

**Reminders are NOT in this codebase anymore.** They live in:
- **Database**: portal PostgreSQL `reminders` table
- **EventBridge rules**: named `pudding-r-{id}` (e.g. `pudding-r-morning-medication`)
- **Portal API**: `PUT /api/pudding/reminders` — batch saves all reminder changes
- **Portal UI**: `https://c4i0apps.com/admin/pudding`
- **Seed script**: `portal/scripts/seed-reminders.ts`

The 5 default reminders (morning-medication, lunch, afternoon-medication, dinner, night-medication) are already seeded.

`src/config/reminders.ts` now only exports `TIMEZONE` — do not add reminder data back there.

---

## Alexa API Details

All calls go to `alexa.amazon.com.br`. CSRF token extracted from cookie for POST requests.

- **Bootstrap** `GET /api/bootstrap?version=0` → returns `customerId`
- **Devices** `GET /api/devices-v2/device?cached=true` → list devices, get `deviceType`
- **Behaviors** `POST /api/behaviors/preview` → send speak or announcement command

`sendSpeak` — `textToSpeak` field accepts plain text OR SSML (`<speak>...</speak>`)
`sendAnnouncement` — `speak.value` gets SSML, `display.body` always gets plain text

---

## Brazil Config (do not change)

```typescript
amazonPage: 'amazon.com.br'
alexaServiceHost: 'alexa.amazon.com.br'
acceptLanguage: 'pt-BR'
timezone: 'America/Sao_Paulo'
```

---

---

## Cookie lifecycle (2026-04-13)

`pudding-cookie-refresh` Lambda runs every 3 days. It reads `SSM_PATHS.REGISTRATION`,
calls `alexa-cookie2.refreshAlexaCookie()` to exchange the stored refresh token for a
fresh cookie, and writes the new cookie + rotated registration back to SSM. No human
interaction needed — unless the refresh token itself is revoked (SNS alert then).

**Bootstrap (one-time, needed after refresh token revocation)**:
```
# on laptop
ssh -L 8443:localhost:8443 ubuntu@<ec2>

# on EC2
cd /home/ubuntu/projects/pudding && pnpm setup

# on laptop browser
open https://127.0.0.1:8443/   # accept self-signed cert, log in, done
```

---

## Last updated: 2026-04-13
