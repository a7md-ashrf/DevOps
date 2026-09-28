import { PgLiteral, type MigrationBuilder } from 'node-pg-migrate';

/**
 * Tasks table — the core entity of the demo API.
 *
 * Notes on the choices below:
 * - gen_random_uuid() is built into PostgreSQL 13+ (no extension needed).
 * - status uses a CHECK constraint instead of a native ENUM type: CHECK is
 *   trivial to evolve or drop in a later migration, while ALTER TYPE on an
 *   enum requires an ACCESS EXCLUSIVE lock and awkward ADD VALUE dance.
 * - updated_at is maintained by a trigger so the guarantee holds no matter
 *   which path writes the row (API, migration, psql session).
 * - Function-call defaults (gen_random_uuid, now) are wrapped in PgLiteral so
 *   node-pg-migrate emits them as raw SQL EXPRESSIONS. Plain strings get
 *   dollar-quoted as string literals — right for 'todo', wrong for now().
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('tasks', {
    id: { type: 'uuid', primaryKey: true, default: new PgLiteral('gen_random_uuid()') },
    title: { type: 'varchar(200)', notNull: true },
    description: { type: 'text' },
    status: { type: 'varchar(20)', notNull: true, default: 'todo' },
    created_at: { type: 'timestamptz', notNull: true, default: new PgLiteral('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: new PgLiteral('now()') },
  });

  pgm.addConstraint('tasks', 'tasks_status_check', {
    check: "status IN ('todo', 'in_progress', 'done')",
  });

  // Powers the default list ordering: ORDER BY created_at DESC
  pgm.createIndex('tasks', 'created_at', { name: 'idx_tasks_created_at' });

  pgm.sql(`
    CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.createTrigger('tasks', 'trg_tasks_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTrigger('tasks', 'trg_tasks_set_updated_at');
  pgm.sql('DROP FUNCTION IF EXISTS set_updated_at();');
  pgm.dropIndex('tasks', 'created_at', { name: 'idx_tasks_created_at' });
  pgm.dropTable('tasks');
}
