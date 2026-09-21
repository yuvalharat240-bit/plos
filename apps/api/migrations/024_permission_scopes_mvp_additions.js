/* FINDING: docs/07-privacy-model.md §3.2's permission_scopes catalog
 * (seeded in 007_permissions_and_consent.js) has `mental_health.read` and
 * `mental_health.read_raw` but no write scope for that domain — yet
 * docs/09's Milestone 2 requires a journal-entry write endpoint
 * (`observation_journal_entry`, the mental_health domain's MVP write
 * path). Writing that endpoint against `mental_health.read_raw` would be
 * wrong (a read scope authorizing a write) and inventing an undocumented
 * scope string silently would repeat the same mistake this project has
 * twice already caught and fixed at the schema layer (020, 021) — so it's
 * added here, explicitly, following the exact naming/shape of every other
 * row in the seeded catalog.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permission_scopes (scope, resource, action, risk_tier, description) VALUES
      ('mental_health.write', 'mental_health', 'write', 1, 'Write user-entered journal entries and check-ins');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM permission_scopes WHERE scope = 'mental_health.write';`);
};
