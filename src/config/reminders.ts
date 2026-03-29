import { Reminder } from '../lib/types';

/**
 * Scheduled reminders for the Echo Dot.
 *
 * Schedule format: cron(minute hour day month day-of-week year)
 * Timezone is set in the CDK stack (America/Sao_Paulo).
 *
 * To add a new reminder, just add an entry here and redeploy with `pnpm deploy`.
 */
export const REMINDERS: Reminder[] = [
  {
    id: 'morning-medication',
    schedule: 'cron(0 8 * * ? *)',
    message: 'Bom dia! Está na hora de tomar o remédio da manhã.',
    commandType: 'speak',
  },
  {
    id: 'lunch',
    schedule: 'cron(0 12 * * ? *)',
    message: 'Hora do almoço!',
    commandType: 'speak',
  },
  {
    id: 'afternoon-medication',
    schedule: 'cron(0 15 * * ? *)',
    message: 'Está na hora do remédio da tarde.',
    commandType: 'speak',
  },
  {
    id: 'dinner',
    schedule: 'cron(0 18 * * ? *)',
    message: 'Hora do jantar!',
    commandType: 'speak',
  },
  {
    id: 'night-medication',
    schedule: 'cron(0 20 * * ? *)',
    message: 'Hora do remédio da noite. Boa noite!',
    commandType: 'speak',
  },
];

export const TIMEZONE = 'America/Sao_Paulo';
