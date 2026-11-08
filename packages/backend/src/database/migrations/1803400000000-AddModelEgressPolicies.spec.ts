import { AddModelEgressPolicies1803400000000 } from './1803400000000-AddModelEgressPolicies';

async function run(direction: 'up' | 'down'): Promise<string[]> {
  const query = jest.fn(async (_sql: string) => undefined);
  await new AddModelEgressPolicies1803400000000()[direction]({ query } as never);
  return query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
}

describe('AddModelEgressPolicies1803400000000', () => {
  it('creates the policy table and its unique route index', async () => {
    const sql = await run('up');
    expect(sql).toEqual(
      expect.arrayContaining([
        `SET lock_timeout = '5s'`,
        expect.stringContaining('CREATE TABLE IF NOT EXISTS "model_egress_policies"'),
        expect.stringContaining(
          'CREATE UNIQUE INDEX IF NOT EXISTS "idx_model_egress_policies_route"',
        ),
        expect.stringContaining('CREATE INDEX IF NOT EXISTS "idx_model_egress_policies_tenant"'),
        `RESET lock_timeout`,
      ]),
    );
  });

  it('drops the table on revert', async () => {
    const sql = await run('down');
    expect(sql).toEqual([`DROP TABLE IF EXISTS "model_egress_policies"`]);
  });
});
