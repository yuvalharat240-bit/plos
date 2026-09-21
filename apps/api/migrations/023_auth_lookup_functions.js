/* Milestone 2 (docs/09) needs two lookups that are structurally
 * impossible under docs/04 §10's normal RLS mechanism: refresh-token
 * rotation and passkey login both start with an opaque secret the client
 * already holds (a refresh token, a WebAuthn credential ID) and nothing
 * else — by definition, the caller's user_id is not yet known, so there is
 * no value to put in `app.current_user_id` to scope a `runAsUser` query.
 * `sessions` and `webauthn_credentials` are both correctly RLS-forced
 * (020_rls_policies.js) for every *other* access pattern; this isn't a
 * reason to weaken that.
 *
 * Resolved with two narrow SECURITY DEFINER functions instead of a
 * broader RLS bypass: each does exactly one fixed, parameterized lookup
 * keyed by a globally-unique secret/id column (never a scan, never
 * app-supplied SQL), owned by the migration-running role. A SECURITY
 * DEFINER function runs with its owner's privileges, and Postgres
 * superusers bypass RLS unconditionally (docs/04 §10.1's own noted
 * caveat) — so as long as the owner is the migration superuser (true here
 * and in any local/CI Postgres), these two functions see the row they're
 * looking for regardless of FORCE ROW LEVEL SECURITY. plos_app gets
 * EXECUTE on the function, never SELECT on the underlying table via any
 * new path — the function is the entire boundary, and it returns at most
 * the one row matching the exact secret supplied.
 *
 * Flag for Milestone 8 (AWS deploy): RDS's master user is not a true
 * Postgres superuser and does not have BYPASSRLS by default. Whichever
 * role owns these two functions in the real deployment needs BYPASSRLS
 * granted explicitly (`ALTER ROLE ... BYPASSRLS`) or the functions must
 * be re-owned to a role that has it — otherwise refresh and passkey login
 * silently break in production despite passing every test here.
 *
 * FOUND WHILE WRITING THE MILESTONE 2 e2e TEST, not left as a latent bug:
 * a SQL-language function whose RETURNS type is a bare composite/row type
 * (as opposed to SETOF that type) always returns exactly one row, even
 * when its query matches nothing — that one row just has every column
 * NULL. `SELECT * FROM find_session_for_refresh($1)` on a stale/rotated
 * refresh token was therefore returning `{id: null, user_id: null, ...}`
 * instead of zero rows, so the caller's `if (!session)` never fired and
 * a null user_id cascaded into `runAsUser(null, ...)` — surfacing as a
 * Postgres "invalid input syntax for type uuid" error deep inside the
 * audit-log insert, not as the intended 401. `RETURNS SETOF` fixes this
 * at the source: zero matching rows really means zero returned rows.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION find_session_for_refresh(p_hash TEXT)
    RETURNS SETOF sessions
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    AS $$
      SELECT * FROM sessions
      WHERE refresh_token_hash = p_hash AND revoked_at IS NULL;
    $$;

    CREATE FUNCTION find_webauthn_credential(p_credential_id BYTEA)
    RETURNS SETOF webauthn_credentials
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    AS $$
      SELECT * FROM webauthn_credentials
      WHERE credential_id = p_credential_id;
    $$;

    REVOKE ALL ON FUNCTION find_session_for_refresh(TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION find_webauthn_credential(BYTEA) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION find_session_for_refresh(TEXT) TO plos_app;
    GRANT EXECUTE ON FUNCTION find_webauthn_credential(BYTEA) TO plos_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS find_webauthn_credential(BYTEA);
    DROP FUNCTION IF EXISTS find_session_for_refresh(TEXT);
  `);
};
