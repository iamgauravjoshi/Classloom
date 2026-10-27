import 'reflect-metadata';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommanderError } from 'commander';

import { CliModule } from './cli/cli.module';
import { buildCli } from './cli/schools.commands';
import { parseEnv } from './core/config/env.schema';

async function main(): Promise<void> {
  let app: INestApplicationContext;
  try {
    app = await NestFactory.createApplicationContext(CliModule.forRoot(parseEnv(process.env)), {
      logger: false,
    });
  } catch (error) {
    // e.g. a missing DATABASE_MIGRATION_URL: one clear line, no stack trace.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
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
