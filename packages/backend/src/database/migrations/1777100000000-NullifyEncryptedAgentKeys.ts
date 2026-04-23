import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Zeroes out the reversible-encrypted copy of every agent ingest key
 * (AgentApiKey.key). The column is kept (the entity still references
 * it and older code paths read it), but new rows are never written
 * with a plaintext-recoverable value. Users who lose their key must
 * now rotate the agent's key to reveal a fresh one.
 *
 * Motivation: a DB + encryption-secret compromise would otherwise
 * yield plaintext ingest keys for every agent on the instance,
 * defeating the purpose of scrypt-hashing `key_hash`.
 *
 * See security audit 2026-04-23 finding #6.
 */
export class NullifyEncryptedAgentKeys1777100000000 implements MigrationInterface {
  name = 'NullifyEncryptedAgentKeys1777100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "agent_api_keys" SET "key" = NULL WHERE "key" IS NOT NULL`);
  }

  public async down(): Promise<void> {
    // No down migration: the plaintext keys cannot be recovered once cleared.
    // This matches the security intent.
  }
}
