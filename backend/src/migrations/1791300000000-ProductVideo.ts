// Each product can have one short video next to its photos. The file
// itself is in the upload storage; these columns say where, and how long
// and large it is.
import { MigrationInterface, QueryRunner } from 'typeorm';

const COLUMNS: Array<[string, string]> = [
  ['video_url', 'varchar(500) NULL'],
  ['video_filename', 'varchar(255) NULL'],
  ['video_duration_ms', 'int unsigned NULL'],
  ['video_size_bytes', 'int unsigned NULL'],
];

export class ProductVideo1791300000000 implements MigrationInterface {
  name = 'ProductVideo1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, definition] of COLUMNS) {
      if (!(await queryRunner.hasColumn('products', name))) {
        await queryRunner.query(
          `ALTER TABLE \`products\` ADD \`${name}\` ${definition}`,
        );
      }
    }
  }

  // The video files stay in storage; only the record of them goes.
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of [...COLUMNS].reverse()) {
      if (await queryRunner.hasColumn('products', name)) {
        await queryRunner.query(
          `ALTER TABLE \`products\` DROP COLUMN \`${name}\``,
        );
      }
    }
  }
}
