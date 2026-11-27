// Second factor (authenticator app) for admin accounts. See
// TwoFactorService.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminTwoFactor1791500000000 implements MigrationInterface {
  name = 'AdminTwoFactor1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_two_factor')) return;
    await queryRunner.query(
      'CREATE TABLE `admin_two_factor` (' +
        '`user_id` int NOT NULL, ' +
        '`secret` varchar(255) NULL, ' +
        '`pending_secret` varchar(255) NULL, ' +
        '`enabled_at` datetime NULL, ' +
        '`last_used_step` bigint NULL, ' +
        '`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
        '`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), ' +
        'PRIMARY KEY (`user_id`), ' +
        'CONSTRAINT `FK_two_factor_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_two_factor')) {
      await queryRunner.query('DROP TABLE `admin_two_factor`');
    }
  }
}
