// Failed sign-ins per mobile number, for the account lockout (see
// LoginLockoutService). Counted in the database rather than in memory, so
// a restart does not reset an attacker's count.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class LoginLockouts1791400000000 implements MigrationInterface {
  name = 'LoginLockouts1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('login_lockouts')) return;
    await queryRunner.query(
      'CREATE TABLE `login_lockouts` (' +
        '`mobile` varchar(20) NOT NULL, ' +
        '`failed_attempts` int unsigned NOT NULL DEFAULT 0, ' +
        '`window_started_at` datetime NOT NULL, ' +
        '`locked_until` datetime NULL, ' +
        '`lock_count` int unsigned NOT NULL DEFAULT 0, ' +
        '`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ' +
        'PRIMARY KEY (`mobile`)' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('login_lockouts')) {
      await queryRunner.query('DROP TABLE `login_lockouts`');
    }
  }
}
