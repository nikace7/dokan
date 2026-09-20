import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { config } from '../config';

const projectRoot = path.resolve(__dirname, '../..');

function composeLogs(): string {
  const args = ['compose'];
  if (config.composeProject) args.push('-p', config.composeProject);
  args.push('logs', '--no-color', 'backend');
  return execFileSync('docker', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function otpForEmail(logs: string, email: string): string | null {
  const recipientIndex = logs.lastIndexOf(`To: ${email}`);
  if (recipientIndex < 0) return null;
  const emailBlock = logs.slice(Math.max(0, recipientIndex - 1_500), recipientIndex + 500);
  const subjects = [...emailBlock.matchAll(/Subject: (\d{6}) is your .+ login code/g)];
  return subjects.at(-1)?.[1] ?? null;
}

/** Read only the code addressed to this run's unique local test mailbox. */
export async function readLatestStorefrontOtp(email: string): Promise<string> {
  if (config.fixedOtp) return config.fixedOtp;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = otpForEmail(composeLogs(), email);
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No local OTP email for ${email}. Use the Compose console-email backend or set E2E_OTP_CODE.`,
  );
}
