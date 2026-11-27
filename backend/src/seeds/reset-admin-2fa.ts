import 'dotenv/config';
import dataSource from '../data-source';
import { User } from '../users/entities/user.entity';
import { AdminTwoFactor } from '../auth/entities/admin-two-factor.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

// For the one case the panel cannot help with: the only admin lost the
// phone with the authenticator app. Run on the server itself:
//
//   npm run admin:reset-2fa -- 09123456789
//
// Their two-step sign-in is removed; with ADMIN_TWO_FACTOR=required they
// set it up again at the next sign-in. Recorded in the activity log.
async function resetAdminTwoFactor() {
  const mobile = (process.argv[2] ?? '').trim();
  if (!/^09\d{9}$/.test(mobile)) {
    console.error('Usage: npm run admin:reset-2fa -- 09123456789');
    process.exit(1);
  }

  await dataSource.initialize();
  const user = await dataSource.getRepository(User).findOne({
    where: { mobile },
    select: { id: true, mobile: true, role: true },
  });
  if (!user) {
    console.error(`No account for ${mobile}.`);
    await dataSource.destroy();
    process.exit(1);
  }

  const result = await dataSource
    .getRepository(AdminTwoFactor)
    .delete({ user_id: user.id });
  await dataSource.getRepository(AuditLog).save({
    action: 'security.two_factor_reset',
    entity_type: 'security',
    entity_id: user.id,
    actor_label: 'server console',
    changes: { key: `user:${user.id}`, by: 'reset-admin-2fa script' },
  });
  console.log(
    result.affected
      ? `Two-step sign-in removed for ${mobile}. They set it up again at the next sign-in.`
      : `${mobile} had no two-step sign-in - nothing to remove.`,
  );
  await dataSource.destroy();
}

void resetAdminTwoFactor();
