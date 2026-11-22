import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the task id and the finished transcript of an asynchronous
 * speech-to-text request. `GET /v1/audio/transcriptions/{id}` looks the
 * request up by (tenant_id, audio_task_id) and reads the transcript back
 * from `audio_result` — Groq does not retain transcripts for polling.
 */
export class AddRequestAudioTask1803400000000 implements MigrationInterface {
  name = 'AddRequestAudioTask1803400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.withBoundedLockWait(queryRunner, async () => {
      await queryRunner.query(`
        ALTER TABLE "requests"
          ADD COLUMN IF NOT EXISTS "audio_task_id" character varying
      `);
      await queryRunner.query(`
        ALTER TABLE "requests"
          ADD COLUMN IF NOT EXISTS "audio_result" jsonb
      `);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_requests_tenant_audio_task"
          ON "requests" ("tenant_id", "audio_task_id")
      `);
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.withBoundedLockWait(queryRunner, async () => {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_requests_tenant_audio_task"`);
      await queryRunner.query(`
        ALTER TABLE "requests"
          DROP COLUMN IF EXISTS "audio_result"
      `);
      await queryRunner.query(`
        ALTER TABLE "requests"
          DROP COLUMN IF EXISTS "audio_task_id"
      `);
    });
  }

  private async withBoundedLockWait(
    queryRunner: QueryRunner,
    change: () => Promise<void>,
  ): Promise<void> {
    if (queryRunner.isTransactionActive) {
      await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
      await change();
      return;
    }

    await queryRunner.query(`SET lock_timeout = '5s'`);
    try {
      await change();
    } finally {
      await queryRunner.query(`RESET lock_timeout`);
    }
  }
}
