import { PoolClient } from 'pg';

/** Every user-authored write starts with the same core_objects spine row —
 * shared by journal/medications/workouts/users services so the
 * (source='user_entry', is_user_entered=true) constants can't drift
 * (ponytail-audit, pre-Milestone-8 pass, 2026-09-21: was duplicated 4x). */
export async function insertUserEnteredSpine(
  client: PoolClient,
  userId: string,
  objectType: string,
): Promise<string> {
  const spine = await client.query(
    `INSERT INTO core_objects (user_id, object_type, source, is_user_entered)
     VALUES ($1, $2, 'user_entry', true)
     RETURNING id`,
    [userId, objectType],
  );
  return spine.rows[0].id;
}
