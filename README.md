# Pudding

The S3 bucket and Alexa skill that play recorded family messages on an Echo Dot in Brazil, three times a day.

## How it works

- Native Alexa routines on the Echo open the skill "Pudding" with the phrase "abrir recado do pudim".
- The skill (`skill/index.js`, Alexa-hosted) picks the message by Sao Paulo hour: before 12h bom dia, 12h to 17h boa tarde, 18h on boa noite.
- It says "Mensagem de Caio" and streams `audio/recados/<slot>.mp3` from the bucket `pudding-audio-051162627683`.
- Re-recording a slot overwrites its file, so the skill needs no change.

## Layout

| Path | What it is |
|---|---|
| `src/stack/pudding-stack.ts` | CDK stack: the bucket, anonymous read on `audio/*`, CORS for uploads from `https://c4i0apps.com` |
| `tests/stack.test.ts` | Guards the deployed logical IDs, the retain rules, public read and CORS |
| `skill/index.js` | Source of the Alexa-hosted skill; keep it equal to what the developer console runs |

## Commands

```bash
pnpm install
pnpm test                                  # stack guard
pnpm synth                                 # writes cdk.out/PuddingStack.template.json
pnpm cdk diff --profile personal           # compare with the deployed stack
pnpm cdk deploy --profile personal
```

Deploy the skill in the Alexa developer console: Pudding > Code > replace `index.js` > Save > Deploy, then type "abrir recado do pudim" in the Test tab.

## Never

- `cdk destroy`, or renaming the `AudioBucket` construct. The bucket survives, but its read policy would be deleted and the Echo would go silent.

## History

Until November 2026 this repo drove the Echo from Lambda through Amazon's unofficial cookie API (`alexa-remote2`). Amazon sessions expired within days and the token refresh locked the account, so routines plus this skill replaced it. The old code is in git history.
