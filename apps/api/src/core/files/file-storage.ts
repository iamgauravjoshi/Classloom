import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';

/** Object storage for tenant files. Keys are built by the API, never taken from user input. */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Throws StorageObjectNotFoundError when nothing is stored under `key`. */
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** True when the bucket is reachable; never throws. */
  ping(): Promise<boolean>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Storage could not be reached or refused the request; maps to 503 `storage-unavailable`. */
export class StorageUnavailableError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`File storage unavailable (${operation})`, options);
    this.name = 'StorageUnavailableError';
  }
}

/** `get` found no object under the key (S3 `NoSuchKey`): the store answered, the object is gone. */
export class StorageObjectNotFoundError extends Error {
  constructor(key: string, options?: { cause?: unknown }) {
    super(`No stored object at ${key}`, options);
    this.name = 'StorageObjectNotFoundError';
  }
}

/** How long a health-check ping may take. */
const PING_TIMEOUT_MS = 1000;

/** The S3 implementation (RustFS locally). The bucket is private: objects are served by the API. */
@Injectable()
export class S3FileStorage implements FileStorage, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(S3FileStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      // RustFS and MinIO ignore the region, but the SDK needs one to sign requests.
      region: 'us-east-1',
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      // Fail fast while storage is down instead of holding the request open.
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 10_000 },
    });
  }

  /** Creates the bucket when it is missing. Storage being down only logs a warning. */
  async onModuleInit(): Promise<void> {
    try {
      if (await this.bucketExists()) return;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket ${this.bucket}`);
    } catch (error) {
      if (isS3Error(error, 'BucketAlreadyOwnedByYou')) return;
      this.logger.warn(
        `File storage unreachable at startup; uploads will fail until it is back (${errorSummary(error)})`,
      );
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      );
    } catch (error) {
      throw new StorageUnavailableError('put', { cause: error });
    }
  }

  async get(key: string): Promise<Readable> {
    try {
      const { Body } = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!(Body instanceof Readable)) throw new Error('S3 returned no object body');
      return Body;
    } catch (error) {
      if (
        isS3Error(error, 'NoSuchKey') ||
        (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
      ) {
        throw new StorageObjectNotFoundError(key, { cause: error });
      }
      throw new StorageUnavailableError('get', { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      throw new StorageUnavailableError('delete', { cause: error });
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
        abortSignal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

function isS3Error(error: unknown, name: string): boolean {
  return error instanceof S3ServiceException && error.name === name;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
