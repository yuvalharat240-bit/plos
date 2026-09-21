/* FINDING, same category as 024_permission_scopes_mvp_additions.js:
 * docs/09 Milestone 3's calendar sync writes event_calendar_item rows,
 * but the permission_scopes catalog (007) only has `productivity.read`
 * ("Read calendar density signal") — no write scope for the domain that
 * actually creates those rows. Added explicitly rather than reusing
 * `productivity.read` (a read scope authorizing a write would repeat
 * exactly the mistake this project has already caught twice).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO permission_scopes (scope, resource, action, risk_tier, description) VALUES
      ('productivity.write', 'productivity', 'write', 0, 'Write imported calendar density data');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM permission_scopes WHERE scope = 'productivity.write';`);
};
