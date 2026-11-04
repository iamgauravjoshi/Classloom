import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const cliDir = __dirname;
const readme = readFileSync(path.resolve(cliDir, '../../../../README.md'), 'utf8');

/** Every `.command('name')` registered by the CLI's command files. */
const commands = readdirSync(cliDir)
  .filter((file) => file.endsWith('.commands.ts'))
  .flatMap((file) =>
    [...readFileSync(path.join(cliDir, file), 'utf8').matchAll(/\.command\('([^']+)'\)/g)].map(
      (match) => match[1]!,
    ),
  );

describe('platform CLI documentation', () => {
  it('finds the commands', () => {
    expect(commands).toContain('school:demo-setup');
  });

  it.each(commands)('documents %s in the README', (command) => {
    expect(readme).toContain(`\`${command}`);
  });

  it('shows an example run of school:demo-setup', () => {
    expect(readme).toMatch(/cli school:demo-setup [A-Z0-9-]+/);
  });
});
