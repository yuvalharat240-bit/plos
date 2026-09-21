import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { insertUserEnteredSpine } from '../database/insert-user-entered-spine';
import { AuditLogService } from '../audit/audit-log.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** SignUpView's four fixed goal options map onto the three MVP domains it names outcomes for. */
const GOAL_DOMAIN: Record<string, string> = {
  'Sleep better': 'health',
  'Train consistently': 'fitness',
  'Manage stress': 'mental_health',
};

@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
  ) {}

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<{ id: string }> {
    return this.db.runAsUser(userId, async (client) => {
      if (dto.displayName !== undefined) {
        await client.query(`UPDATE users SET display_name = $1 WHERE id = $2`, [
          dto.displayName,
          userId,
        ]);
      }

      // "Just exploring" names no concrete outcome — nothing to record.
      const domain = dto.primaryGoal ? GOAL_DOMAIN[dto.primaryGoal] : undefined;
      if (domain) {
        const goalId = await insertUserEnteredSpine(client, userId, 'goal');
        await client.query(
          `INSERT INTO goals (id, user_id, domain, goal_type, title)
           VALUES ($1, $2, $3, 'outcome', $4)`,
          [goalId, userId, domain, dto.primaryGoal],
        );
      }

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'user.update_profile',
        resourceType: 'users',
        resourceId: userId,
        result: 'success',
        metadata: { setDisplayName: dto.displayName !== undefined, primaryGoal: dto.primaryGoal },
      });

      return { id: userId };
    });
  }
}
