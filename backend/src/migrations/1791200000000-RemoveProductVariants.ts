// Products stop having options. A product is one thing with one price and
// one stock count; a second colour or capacity is a product of its own.
//
// What happens to what is already stored:
// - products.stock already held the sum of a product's live options (it was
//   kept in sync on every change), so it is recomputed once more and kept.
// - A product with exactly one live option that carried its own price takes
//   that price, so nothing on the shelf changes price on the way through.
// - An option value every live option of a product shared (all of them
//   "مشکی") becomes a plain attribute value of the product, so the colour
//   filter still finds it. Values that differed between options are dropped
//   with the options - there is no single answer for them.
// - Basket lines for two options of one product merge into one line.
// - Order lines keep the option's label (variant_title) as history, so old
//   invoices still say what was sold; the link to the option row goes.
// - The option tables and the attribute "axis" flag are dropped.
//
// Every step checks before it acts: with synchronize on (development) part
// of this may already have happened by the time migrations run.
//
// There is no way back: the options are gone, and so is the knowledge of
// which unit of stock belonged to which of them.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveProductVariants1791200000000 implements MigrationInterface {
  name = 'RemoveProductVariants1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('product_variants')) {
      await this.foldVariantsIntoProducts(queryRunner);
    }
    await this.collapseBasketLines(queryRunner);
    await this.detachOrderItems(queryRunner);

    await queryRunner.query('DROP TABLE IF EXISTS `variant_attribute_values`');
    await queryRunner.query('DROP TABLE IF EXISTS `product_variants`');
    if (await queryRunner.hasTable('typeorm_metadata')) {
      await queryRunner.query(
        "DELETE FROM `typeorm_metadata` WHERE `type` = 'GENERATED_COLUMN' AND `table` = 'product_variants'",
      );
    }

    if (await queryRunner.hasColumn('attributes', 'is_variant_axis')) {
      await queryRunner.query(
        'ALTER TABLE `attributes` DROP COLUMN `is_variant_axis`',
      );
    }
  }

  public async down(): Promise<void> {
    throw new Error(
      'RemoveProductVariants cannot be reverted: product options and their separate stock no longer exist. Restore a backup taken before it ran instead.',
    );
  }

  private async foldVariantsIntoProducts(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const live = 'v.`deleted_at` IS NULL AND v.`is_active` = 1';

    await queryRunner.query(
      'UPDATE `products` p INNER JOIN (' +
        'SELECT v.`product_id`, COALESCE(SUM(v.`stock`), 0) AS total ' +
        `FROM \`product_variants\` v WHERE ${live} GROUP BY v.\`product_id\`` +
        ') s ON s.`product_id` = p.`id` SET p.`stock` = s.total',
    );

    // A single live option with a price of its own: that was the price the
    // shop actually charged.
    await queryRunner.query(
      'UPDATE `products` p INNER JOIN (' +
        'SELECT v.`product_id`, MIN(v.`price`) AS price, MIN(v.`sale_price`) AS sale_price, ' +
        'MIN(v.`weight_grams`) AS weight_grams ' +
        `FROM \`product_variants\` v WHERE ${live} GROUP BY v.\`product_id\` HAVING COUNT(*) = 1` +
        ') one ON one.`product_id` = p.`id` ' +
        'SET p.`price` = COALESCE(one.price, p.`price`), ' +
        'p.`sale_price` = IF(one.price IS NULL, p.`sale_price`, one.sale_price), ' +
        'p.`weight_grams` = COALESCE(one.weight_grams, p.`weight_grams`)',
    );

    if (
      (await queryRunner.hasTable('variant_attribute_values')) &&
      (await queryRunner.hasTable('product_attribute_values'))
    ) {
      // INSERT IGNORE: a product that already describes the same attribute
      // keeps its own value (unique on product + attribute).
      await queryRunner.query(
        'INSERT IGNORE INTO `product_attribute_values` (`product_id`, `attribute_id`, `option_id`) ' +
          'SELECT v.`product_id`, vav.`attribute_id`, MIN(vav.`option_id`) ' +
          'FROM `variant_attribute_values` vav ' +
          'INNER JOIN `product_variants` v ON v.`id` = vav.`variant_id` ' +
          `WHERE ${live} ` +
          'GROUP BY v.`product_id`, vav.`attribute_id` ' +
          'HAVING COUNT(DISTINCT vav.`option_id`) = 1 ' +
          // ...and only when every live option answered it.
          'AND COUNT(*) = (SELECT COUNT(*) FROM `product_variants` v2 ' +
          'WHERE v2.`product_id` = v.`product_id` AND v2.`deleted_at` IS NULL AND v2.`is_active` = 1)',
      );
    }
  }

  private async collapseBasketLines(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('basket_items'))) return;

    // Two lines for one product (two options of it) become the oldest line,
    // carrying both quantities.
    await queryRunner.query(
      'UPDATE `basket_items` b INNER JOIN (' +
        'SELECT MIN(`id`) AS keep_id, SUM(`quantity`) AS total FROM `basket_items` ' +
        'GROUP BY `userId`, `productId` HAVING COUNT(*) > 1' +
        ') d ON d.keep_id = b.`id` SET b.`quantity` = d.total',
    );
    await queryRunner.query(
      'DELETE b FROM `basket_items` b INNER JOIN (' +
        'SELECT `userId`, `productId`, MIN(`id`) AS keep_id FROM `basket_items` ' +
        'GROUP BY `userId`, `productId` HAVING COUNT(*) > 1' +
        ') d ON d.`userId` = b.`userId` AND d.`productId` = b.`productId` AND b.`id` <> d.keep_id',
    );

    // The new unique index goes in before the old one comes out: the old
    // one starts with userId and may be the index the user foreign key
    // relies on, and MySQL refuses to drop that while nothing replaces it.
    if (
      !(await this.hasIndex(
        queryRunner,
        'basket_items',
        'UQ_basket_user_product',
      ))
    ) {
      await queryRunner.query(
        'CREATE UNIQUE INDEX `UQ_basket_user_product` ON `basket_items` (`userId`, `productId`)',
      );
    }

    if (
      await this.hasForeignKey(queryRunner, 'basket_items', 'FK_basket_variant')
    ) {
      await queryRunner.query(
        'ALTER TABLE `basket_items` DROP FOREIGN KEY `FK_basket_variant`',
      );
    }
    if (
      await this.hasIndex(queryRunner, 'basket_items', 'UQ_basket_user_variant')
    ) {
      await queryRunner.query(
        'DROP INDEX `UQ_basket_user_variant` ON `basket_items`',
      );
    }
    if (await queryRunner.hasColumn('basket_items', 'variant_id')) {
      await queryRunner.query(
        'ALTER TABLE `basket_items` DROP COLUMN `variant_id`',
      );
    }
  }

  private async detachOrderItems(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('order_items'))) return;

    if (
      await this.hasForeignKey(
        queryRunner,
        'order_items',
        'FK_order_item_variant',
      )
    ) {
      await queryRunner.query(
        'ALTER TABLE `order_items` DROP FOREIGN KEY `FK_order_item_variant`',
      );
    }
    if (await queryRunner.hasColumn('order_items', 'variant_id')) {
      await queryRunner.query(
        'ALTER TABLE `order_items` DROP COLUMN `variant_id`',
      );
    }
    if (await queryRunner.hasColumn('order_items', 'variant_sku')) {
      await queryRunner.query(
        'ALTER TABLE `order_items` DROP COLUMN `variant_sku`',
      );
    }
    // Products that only ever had the one automatic option were sold as
    // "Default" - not something an invoice should print.
    if (await queryRunner.hasColumn('order_items', 'variant_title')) {
      await queryRunner.query(
        "UPDATE `order_items` SET `variant_title` = NULL WHERE `variant_title` = 'Default'",
      );
    }
  }

  private async hasIndex(
    queryRunner: QueryRunner,
    table: string,
    index: string,
  ): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      'SELECT 1 FROM information_schema.STATISTICS ' +
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
      [table, index],
    );
    return rows.length > 0;
  }

  private async hasForeignKey(
    queryRunner: QueryRunner,
    table: string,
    constraint: string,
  ): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS ' +
        "WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1",
      [table, constraint],
    );
    return rows.length > 0;
  }
}
