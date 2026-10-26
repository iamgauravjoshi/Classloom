import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { CommanderError } from 'commander';

import { CliModule } from './cli/cli.module';
import { buildCli } from './cli/schools.commands';
import { parseEnv } from './core/config/env.schema';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CliModule.forRoot(parseEnv(process.env)), {
    logger: false,
  });
  try {
    await buildCli(app, (line) => console.log(line)).parseAsync(process.argv);
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
  } finally {
    await app.close();
  }
}

void main();
