# Pudding - CLAUDE.md

A bucket-only CDK stack plus the source of the Alexa-hosted skill "Pudding". Read `README.md` for how the pieces fit.

- Account `051162627683`, region `us-east-2`, AWS profile `personal` (SSO).
- Skill id `amzn1.ask.skill.3518813d-10b8-4e55-87ce-d35e73adcfa9`, pt-BR, invocation `recado do pudim`, stage Development.
- `pnpm test` must pass before any push. No auto-deploy: stack changes ship with `pnpm cdk deploy --profile personal` after `cdk diff`.

## Rules

- Never `cdk destroy` and never rename the `AudioBucket` construct. Both resources are retained, so a destroy orphans them from the stack; a rename fails because the bucket name is taken. The tests pin the logical IDs `AudioBucket96BEECBA` and `AudioBucketPolicy75597578`.
- Recordings live at `audio/recados/{bom-dia,boa-tarde,boa-noite}.mp3`, overwritten in place. Alexa SSML audio must be MP3 at 48 kbps and 16, 22.05 or 24 kHz, at most 240 s; the current files are 48 kbps, 24 kHz mono.
- `skill/index.js` must equal the code deployed in the developer console. Edit here first, then paste it into the Code tab (the editor takes `ace.edit('brace-editor').setValue(...)`), Save, Deploy, and test in the Test tab.
- Do not bring back the unofficial Alexa cookie API: sessions expired in days and the refresh flow locked the account twice.
