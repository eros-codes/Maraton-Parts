import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readFile, rm, mkdir } from 'fs/promises';
import { join, relative, isAbsolute } from 'path';
import { AppModule } from '../app.module';
import { Category } from '../categories/entities/category.entity';
import { Brand } from '../brands/entities/brand.entity';
import { Product } from '../products/entities/product.entity';
import { ProductImage } from '../products/entities/product-image.entity';
import { Attribute } from '../attributes/entities/attribute.entity';
import { AttributeOption } from '../attributes/entities/attribute-option.entity';
import { CategoryAttribute } from '../attributes/entities/category-attribute.entity';
import { ProductAttributeValue } from '../attributes/entities/product-attribute-value.entity';
import { ShippingZone } from '../shipping/entities/shipping-zone.entity';
import { ShippingMethod } from '../shipping/entities/shipping-method.entity';
import { ShippingRate } from '../shipping/entities/shipping-rate.entity';
import AttributeTypeEnum from '../attributes/enums/attribute-type.enum';
import userRoleEnum from '../users/enums/userRoleEnum';
import { FileStorage } from '../common/storage/file-storage';
import { resolveUploadRoot } from '../common/storage/local-file-storage';
import { ProductImageProcessor } from '../products/images/product-image-processor';
import { storeRenditions } from '../products/images/image-files';
import { StoredImage } from '../products/images/image-files';
import { isDemoMode } from '../common/demo/demo-accounts';
import {
  BRANDS,
  CATALOGUE,
  CATEGORY_TREE,
  CatalogProduct,
  describe,
} from './catalog/catalog-data';

// Maraton Parts' catalogue: the bearing and timing-belt categories, a
// "by car" tree, the brands, and 70 products with their specs and photos.
//
// Two ways to run it:
//
//   npm run seed:catalog
//     The real shop's first catalogue. Only into a shop with no products,
//     categories or orders yet, and it deletes nothing - so it is allowed on
//     the production server, once, right after the first migration.
//
//   npm run seed:catalog -- --fresh
//     Starts over: every table is emptied first (the admin accounts are
//     kept, so the panel can still be signed into) and so is the folder of
//     product pictures. Local and demo databases only.
//
//   npm run seed:demo    = --fresh, then seed-mock's orders, reviews and so on.
const logger = new Logger('SeedCatalog');

const IMAGES_DIR = join(__dirname, 'catalog', 'images');

// Tables that survive the wipe: TypeORM's record of applied migrations,
// and the users table, which is thinned to its admins below instead.
const KEEP_TABLES = new Set(['migrations', 'typeorm_metadata', 'users']);

export function refuseInProduction(what: string) {
  // A real shop must never be wiped by a seed. The public demo is the one
  // production server that wants it, and says so with DEMO_MODE=true.
  if (process.env.NODE_ENV === 'production' && !isDemoMode()) {
    console.error(
      `Refusing to run ${what} against a production database: it empties ` +
        'the shop first. (A public demo sets DEMO_MODE=true.)',
    );
    process.exit(1);
  }
}

async function wipe(dataSource: DataSource) {
  const tables: Array<{ name: string }> = await dataSource.query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES ' +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
  );
  await dataSource.transaction(async (manager) => {
    await manager.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const { name } of tables) {
        if (KEEP_TABLES.has(name)) continue;
        await manager.query(`TRUNCATE TABLE \`${name}\``);
      }
      await manager.query('DELETE FROM `users` WHERE `role` <> ?', [
        userRoleEnum.AdminUser,
      ]);
    } finally {
      await manager.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  });

  // The old products' pictures and videos: nothing points at them now.
  const uploadRoot = resolveUploadRoot(process.env.UPLOAD_DIR);
  const productsDir = join(uploadRoot, 'products');
  const inside = relative(uploadRoot, productsDir);
  if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
    await rm(productsDir, { recursive: true, force: true });
    await mkdir(productsDir, { recursive: true });
  }
}

async function seed() {
  const fresh = process.argv.includes('--fresh');
  if (fresh) refuseInProduction('seed:catalog --fresh');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dataSource = app.get(DataSource);
  const storage = app.get(FileStorage);
  const processor = app.get(ProductImageProcessor);

  try {
    if (fresh) {
      await wipe(dataSource);
    } else {
      // Into an empty shop only: anything already there was put there by
      // someone, and a second catalogue on top of it would be a mess.
      const [existing] = await dataSource.query(
        'SELECT (SELECT COUNT(*) FROM `products`) AS products, ' +
          '(SELECT COUNT(*) FROM `categories`) AS categories, ' +
          '(SELECT COUNT(*) FROM `order`) AS orders',
      );
      const found = [
        ['products', existing.products],
        ['categories', existing.categories],
        ['orders', existing.orders],
      ].filter(([, count]) => Number(count) > 0);
      if (found.length) {
        console.error(
          `The shop already has ${found.map(([name, count]) => `${count} ${name}`).join(', ')}; ` +
            'seed:catalog only fills an empty one.\n' +
            'On a local or demo database, start over with: npm run seed:catalog -- --fresh',
        );
        process.exitCode = 1;
        return;
      }
    }

    // ---------- categories ----------
    const categories = dataSource.getRepository(Category);
    const categoryBySlug = new Map<string, Category>();
    for (const node of CATEGORY_TREE) {
      const parent = await categories.save(
        categories.create({ title: node.title, slug: node.slug }),
      );
      categoryBySlug.set(node.slug, parent);
      for (const child of node.children) {
        categoryBySlug.set(
          child.slug,
          await categories.save(
            categories.create({ title: child.title, slug: child.slug, parent }),
          ),
        );
      }
    }

    // ---------- brands ----------
    const brands = dataSource.getRepository(Brand);
    const brandBySlug = new Map<string, Brand>();
    for (const row of BRANDS) {
      brandBySlug.set(row.slug, await brands.save(brands.create(row)));
    }

    // ---------- specs ----------
    const attributes = dataSource.getRepository(Attribute);
    const options = dataSource.getRepository(AttributeOption);
    const categoryAttributes = dataSource.getRepository(CategoryAttribute);

    const attribute = (
      title: string,
      code: string,
      type: AttributeTypeEnum,
      unit: string | null = null,
      is_filterable = false,
    ) =>
      attributes.save(
        attributes.create({ title, code, type, unit, is_filterable }),
      );

    const partNumber = await attribute(
      'شماره فنی',
      'part-number',
      AttributeTypeEnum.Text,
    );
    const origin = await attribute(
      'کشور سازنده',
      'origin',
      AttributeTypeEnum.Select,
      null,
      true,
    );
    const originOptions = new Map<string, AttributeOption>();
    for (const [index, value] of ['ایران - تبریز', 'ایتالیا'].entries()) {
      originOptions.set(
        value,
        await options.save(
          options.create({
            attribute: origin,
            value,
            slug: index === 0 ? 'iran-tabriz' : 'italy',
            sort_order: index + 1,
          }),
        ),
      );
    }
    const fits = await attribute('مناسب برای', 'fits', AttributeTypeEnum.Text);
    const perCarton = await attribute(
      'تعداد در کارتن',
      'per-carton',
      AttributeTypeEnum.Number,
      'عدد',
    );
    const teeth = await attribute(
      'تعداد دندانه',
      'teeth',
      AttributeTypeEnum.Number,
      'دندانه',
    );
    const width = await attribute(
      'عرض تسمه',
      'belt-width',
      AttributeTypeEnum.Number,
      'میلی‌متر',
    );
    const warranty = await attribute(
      'گارانتی',
      'warranty',
      AttributeTypeEnum.Text,
    );

    const bearingSpecs = [partNumber, origin, fits, perCarton, warranty];
    const beltSpecs = [partNumber, origin, fits, teeth, width, warranty];
    for (const node of CATEGORY_TREE) {
      if (node.slug === 'by-car') continue;
      for (const child of node.children) {
        const category = categoryBySlug.get(child.slug)!;
        for (const spec of node.slug === 'timing-belts'
          ? beltSpecs
          : bearingSpecs) {
          await categoryAttributes.save(
            categoryAttributes.create({
              category,
              attribute: spec,
              is_required: spec === partNumber,
            }),
          );
        }
      }
    }

    // ---------- products ----------
    const products = dataSource.getRepository(Product);
    const productImages = dataSource.getRepository(ProductImage);
    const values = dataSource.getRepository(ProductAttributeValue);

    // Each photo is turned into the shop's WebP widths once, however many
    // products show it.
    const stored = new Map<string, StoredImage>();
    const imageFor = async (name: string): Promise<StoredImage> => {
      const done = stored.get(name);
      if (done) return done;
      const buffer = await readFile(join(IMAGES_DIR, `${name}.jpg`));
      const image = await storeRenditions(
        storage,
        await processor.renditions(buffer),
      );
      stored.set(name, image);
      return image;
    };

    const carTitles = (product: CatalogProduct) =>
      product.cars
        .map(
          (key) =>
            CATEGORY_TREE.find((node) => node.slug === 'by-car')!.children.find(
              (child) => child.slug === `car-${key}`,
            )!.title,
        )
        .join('، ');

    // The same stock on every run, so screenshots stay comparable: a few
    // parts sold out, a few running low.
    const stockFor = (index: number) =>
      index % 17 === 5 ? 0 : index % 11 === 3 ? 3 : 12 + ((index * 37) % 140);

    for (const [index, item] of CATALOGUE.entries()) {
      const salePrice = item.salePercent
        ? Math.round((item.price * (100 - item.salePercent)) / 100 / 1000) *
          1000
        : null;
      const product = await products.save(
        products.create({
          title: item.title,
          slug: item.slug,
          description: describe(item),
          price: item.price,
          sale_price: salePrice,
          weight_grams: item.weightGrams,
          stock: stockFor(index),
          brand: brandBySlug.get(item.brand) ?? null,
          categories: [
            categoryBySlug.get(item.category)!,
            ...item.cars.map((key) => categoryBySlug.get(`car-${key}`)!),
          ],
          is_published: true,
        }),
      );

      for (const [order, name] of item.images.entries()) {
        const image = await imageFor(name);
        await productImages.save(
          productImages.create({ ...image, order, product }),
        );
      }

      const specs: Array<Partial<ProductAttributeValue>> = [
        { attribute: partNumber, value_text: item.partNumber },
        { attribute: origin, option: originOptions.get(item.origin) },
        {
          attribute: warranty,
          value_text:
            item.brand === 'dayco'
              ? 'اصالت کالا + ۱۲ ماه / ۶۰٬۰۰۰ کیلومتر'
              : 'اصالت و سلامت فیزیکی کالا',
        },
      ];
      if (item.cars.length) {
        specs.push({ attribute: fits, value_text: carTitles(item) });
      }
      if (item.perCarton) {
        specs.push({
          attribute: perCarton,
          value_number: String(item.perCarton),
        });
      }
      if (item.teeth) {
        specs.push({ attribute: teeth, value_number: String(item.teeth) });
      }
      if (item.widthMm) {
        specs.push({ attribute: width, value_number: String(item.widthMm) });
      }
      for (const spec of specs) {
        await values.save(values.create({ ...spec, product }));
      }
    }

    // ---------- shipping ----------
    // Part of the shop's setup: emptied with everything else by --fresh,
    // and left alone when the shop already has its own.
    const zones = dataSource.getRepository(ShippingZone);
    const methods = dataSource.getRepository(ShippingMethod);
    const rates = dataSource.getRepository(ShippingRate);

    const hasShipping = (await methods.count()) > 0;
    if (!hasShipping) {
      const tabriz = await zones.save(
        zones.create({
          title: 'آذربایجان شرقی',
          provinces: ['آذربایجان شرقی'],
          is_default: false,
        }),
      );
      const bigCities = await zones.save(
        zones.create({
          title: 'تهران و شهرهای بزرگ',
          provinces: ['تهران', 'البرز', 'اصفهان', 'خراسان رضوی', 'فارس'],
          is_default: false,
        }),
      );
      const rest = await zones.save(
        zones.create({ title: 'سایر شهرها', provinces: [], is_default: true }),
      );

      const post = await methods.save(
        methods.create({
          code: 'post-pishtaz',
          title: 'پست پیشتاز',
          estimated_days_min: 2,
          estimated_days_max: 4,
          supports_cash_on_delivery: true,
          sort_order: 1,
        }),
      );
      const tipax = await methods.save(
        methods.create({
          code: 'tipax',
          title: 'تیپاکس',
          estimated_days_min: 1,
          estimated_days_max: 3,
          supports_cash_on_delivery: true,
          sort_order: 2,
        }),
      );
      const courier = await methods.save(
        methods.create({
          code: 'peyk',
          title: 'پیک موتوری (تبریز)',
          estimated_days_min: 1,
          estimated_days_max: 1,
          supports_cash_on_delivery: true,
          sort_order: 0,
        }),
      );

      const rate = (
        method: ShippingMethod,
        zone: ShippingZone,
        values: Partial<ShippingRate>,
      ) => rates.save(rates.create({ method, zone, ...values }));
      await rate(post, tabriz, {
        base_cost: 45_000,
        per_kg_cost: 12_000,
        free_shipping_threshold: 5_000_000,
        cash_on_delivery_fee: 20_000,
      });
      await rate(post, bigCities, {
        base_cost: 60_000,
        per_kg_cost: 18_000,
        free_shipping_threshold: 8_000_000,
        cash_on_delivery_fee: 25_000,
      });
      await rate(post, rest, {
        base_cost: 75_000,
        per_kg_cost: 22_000,
        free_shipping_threshold: 10_000_000,
        cash_on_delivery_fee: 30_000,
      });
      await rate(tipax, tabriz, { base_cost: 70_000, per_kg_cost: 15_000 });
      await rate(tipax, bigCities, { base_cost: 95_000, per_kg_cost: 20_000 });
      await rate(tipax, rest, { base_cost: 120_000, per_kg_cost: 25_000 });
      await rate(courier, tabriz, { base_cost: 90_000 });
    }

    const admins = await dataSource.query(
      'SELECT COUNT(*) AS n FROM `users` WHERE `role` = ?',
      [userRoleEnum.AdminUser],
    );

    console.log('Maraton Parts catalogue ready:');
    console.log(
      `  ${CATALOGUE.length} products, ${stored.size} photos, ${categoryBySlug.size} categories, ${BRANDS.length} brands`,
    );
    console.log(
      hasShipping
        ? '  shipping left as it was'
        : '  3 shipping methods across 3 zones',
    );
    if (Number(admins[0].n) === 0) {
      console.log(
        '  No admin account: run `npm run seed:admin`, or `npm run seed:mock` for the demo accounts.',
      );
    }
    console.log(
      '  A running API shows the new catalogue within a minute (its cache), or restart it.',
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  seed().catch((error) => {
    logger.error(error);
    process.exit(1);
  });
}
