import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { Env } from './env.schema';

export const ENV = Symbol('ENV');

/** Makes the validated environment injectable as `@Inject(ENV) env: Env`. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: ENV, useValue: env }], exports: [ENV] };
  }
}
