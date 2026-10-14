#!/usr/bin/env node
import './load-env.mjs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const USAGE =
  'Usage: npm run admin:create -- --email <email> [--name <name>] [--role admin]\n' +
  'The password is requested interactively and is never echoed or accepted as an argument.';

// Administrative provisioning path: Better Auth's admin plugin createUser is
// callable server-side without an existing session, so no bootstrap-user
// environment secret is ever stored.
//
// The password is read from an interactive terminal with echo disabled. Secrets
// are deliberately not accepted through CLI arguments (shell history, process
// listings) or ordinary environment variables.
export function promptPassword(promptText, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    // readline echoes typed characters to its output stream, so route that
    // stream to a sink and write only the prompt to the real terminal.
    const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const rl = createInterface({ input, output: muted, terminal: true });
    rl.on('SIGINT', () => {
      rl.close();
      output.write('\n');
      reject(new Error('Password entry aborted.'));
    });
    output.write(promptText);
    rl.question('', (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some(arg => arg === '--password' || arg.startsWith('--password='))) {
    console.error('Plaintext --password is not supported. Enter the password interactively.');
    console.error(USAGE);
    process.exit(64);
  }

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string', default: 'admin' },
      },
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exit(64);
  }

  const email = values.email?.trim().toLowerCase();
  if (!email) {
    console.error(USAGE);
    process.exit(64);
  }

  if (!process.stdin.isTTY) {
    console.error('This command requires an interactive terminal to read the password securely.');
    console.error(USAGE);
    process.exit(64);
  }

  const name = values.name?.trim() || email;
  for (const variable of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) {
    if (!process.env[variable]) {
      console.error(`${variable} is required to provision an administrative user.`);
      process.exit(69);
    }
  }

  let password;
  try {
    password = await promptPassword('Password: ');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Password entry aborted.');
    process.exit(1);
  }
  if (!password) {
    console.error('A non-empty password is required.');
    process.exit(64);
  }

  try {
    const { auth, authPool } = await import('../lib/auth.ts');
    const created = await auth.api.createUser({ body: { email, password, name, role: values.role } });
    console.log(`Created ${created.user.role} user ${created.user.email} (${created.user.id}).`);
    await authPool.end();
    process.exit(0);
  } catch (error) {
    console.error(error?.body?.message || error?.message || 'Could not create the administrative user.');
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
