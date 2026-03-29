# Pudding — Project Plan

**Last updated**: 2026-03-29

## Overview

Scheduled voice announcements for Amazon Echo Dot to help a family member with dementia remember medications and daily routines.

## Status: Initial Implementation Complete

### Completed
- [x] Project scaffolding (CDK + TypeScript)
- [x] Reminders config (5 daily reminders, America/Sao_Paulo timezone)
- [x] Shared library (SSM helpers, alexa-remote2 wrapper)
- [x] Announcement Lambda (speak + announcement commands, cookie error retry)
- [x] Cookie Refresh Lambda (auto-refresh every 3 days, SNS alert on failure)
- [x] CDK Stack (Lambda, EventBridge Scheduler, SSM, SNS, CloudWatch Alarm)
- [x] Setup script (proxy login, device discovery, SSM save)
- [x] Tests (9 tests, all passing)
- [x] README with full documentation

### Next Steps
- [ ] Run setup script to generate initial cookie
- [ ] Deploy to AWS (`pnpm deploy -c alertEmail=...`)
- [ ] Confirm SNS email subscription
- [ ] Test with a manual Lambda invocation
- [ ] Verify scheduled reminders fire correctly
- [ ] Customize reminder messages and times as needed
