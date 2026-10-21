import type { SqliteMigration } from './index'

export const migration008PreparationPipeline: SqliteMigration = {
  version: 8,
  name: 'preparation_pipeline',
  up: `
    CREATE TABLE translation_cooldown (
      id INTEGER PRIMARY KEY CHECK(id=1), retry_after INTEGER NOT NULL,
      code TEXT NOT NULL, message TEXT NOT NULL
    );
    CREATE TABLE translation_checkpoints (
      cache_key TEXT PRIMARY KEY, result_json TEXT NOT NULL
    );
    -- Recuperar somente pausas automáticas por revogação do cofre na 0.4.2.
    -- A tradução continua bloqueada, sem novas solicitações de aprovação.
    INSERT INTO translation_cooldown(id,retry_after,code,message)
      SELECT 1,9007199254740991,'permission_revoked',message FROM works
      WHERE paused=1 AND stage='blocked' AND message LIKE '%autorização foi revogada no KPassword%' LIMIT 1;
    UPDATE works SET paused=0 WHERE paused=1 AND stage='blocked'
      AND message LIKE '%autorização foi revogada no KPassword%';
  `,
}
