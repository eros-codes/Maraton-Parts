import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DataSource, EntityTarget, In, ObjectLiteral } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { User } from '../users/entities/user.entity';
import { Address } from '../address/entities/address.entity';
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
import { DiscountCode } from '../discount-codes/entities/discount-code.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Comment } from '../comments/entities/comment.entity';
import { ReturnRequest } from '../returns/entities/return-request.entity';
import { ReturnItem } from '../returns/entities/return-item.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletTransaction } from '../wallets/entities/wallet-transaction.entity';
import { InvoiceService } from '../orders/invoice.service';
import userRoleEnum from '../users/enums/userRoleEnum';
import OrderStatusEnum from '../orders/enums/order-status.enum';
import PaymentMethodEnum from '../orders/enums/payment-method.enum';
import CommentStatusEnum from '../comments/enums/comment-status.enum';
import DiscountTypeEnum from '../discount-codes/enums/discount-type.enum';
import ReturnStatusEnum from '../returns/enums/return-status.enum';
import ReturnReasonEnum from '../returns/enums/return-reason.enum';
import TicketStatusEnum from '../tickets/enums/ticket-status.enum';
import WalletTransactionTypeEnum from '../wallets/enums/wallet-transaction-type.enum';
import { DEMO_ACCOUNT_MOBILES } from '../common/demo/demo-accounts';
import { toUtcSql } from '../common/time/shop-time';
import { refuseInProduction } from './seed-catalog';
import { CATALOGUE, CatalogProduct } from './catalog/catalog-data';

// Three months of a shop that has been trading: customers (a few of them
// garages buying in bulk), orders in every state, payments, returns,
// reviews, support tickets and wallets - so the dashboard, the reports and
// every admin list have something to show.
//
// Mock, but not nonsense: a garage buys ten bearings, a driver buys one
// with its kit; reviews talk about the part that was bought, by someone who
// bought it; money adds up from order to invoice to refund.
//
// Needs the catalogue (seed:catalog) and replaces whatever this script made
// before: orders, customers and everything that hangs off them. The
// catalogue itself, the shipping setup and the admins stay.
const logger = new Logger('SeedMock');
const DEMO_PASSWORD = 'Passw0rd1';
const DAYS = 90;

// Deterministic "randomness": the same shop on every run.
let state = 20261120;
const random = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
const between = (min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];
const chance = (p: number) => random() < p;
const weighted = <T>(items: ReadonlyArray<readonly [T, number]>): T => {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [item, weight] of items) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1][0];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const daysAgo = (days: number, hour = 12) => {
  const at = new Date(NOW - days * DAY);
  at.setHours(hour, between(0, 59), between(0, 59), 0);
  return at;
};
const roundTo = (value: number, step: number) =>
  Math.round(value / step) * step;

const FIRST_NAMES = [
  'علی',
  'محمد',
  'رضا',
  'حسین',
  'مهدی',
  'امیر',
  'سعید',
  'مجید',
  'حمید',
  'جواد',
  'یوسف',
  'بهزاد',
  'کامران',
  'پیمان',
  'سجاد',
  'وحید',
  'ناصر',
  'اکبر',
  'فرهاد',
  'میلاد',
  'سارا',
  'مریم',
  'زهرا',
  'نرگس',
  'الهام',
  'لیلا',
  'فاطمه',
  'سمیرا',
];
const LAST_NAMES = [
  'رضایی',
  'محمدی',
  'حسینی',
  'کریمی',
  'احمدی',
  'جعفری',
  'قاسمی',
  'نوری',
  'صادقی',
  'باقری',
  'اصغرزاده',
  'عباس‌زاده',
  'نجفی',
  'رحیمی',
  'یوسفی',
  'تقی‌زاده',
  'فتحی',
  'آقایی',
  'شریفی',
  'مرادی',
  'زارعی',
  'بهرامی',
];
// Garages and parts shops: few, but they order often and in bulk.
const GARAGES = [
  'تعمیرگاه برادران نوری',
  'لوازم یدکی آذر',
  'مکانیکی صادقی',
  'تعمیرگاه پژو امیر',
  'یدک‌کالای شریفی',
  'جلوبندی‌سازی باقری',
  'تعمیرگاه نیسان قاسمی',
  'لوازم یدکی تبریز پارت',
];

const PLACES: Array<
  readonly [readonly [string, string, readonly string[]], number]
> = [
  [
    [
      'آذربایجان شرقی',
      'تبریز',
      [
        'خیابان امام، نرسیده به چهارراه آبرسان',
        'ولیعصر، خیابان توانیر',
        'جاده‌ی سنتو، بازار لوازم یدکی',
        'خیابان آزادی، روبه‌روی دانشگاه',
        'کوی ارم، خیابان گلستان',
      ],
    ],
    34,
  ],
  [['آذربایجان شرقی', 'مراغه', ['خیابان خواجه نصیر']], 4],
  [['آذربایجان شرقی', 'مرند', ['خیابان امام']], 3],
  [
    [
      'تهران',
      'تهران',
      [
        'خیابان امین‌حضور، پاساژ لوازم یدکی',
        'شهرک غرب، بلوار فرحزادی',
        'خیابان شریعتی، بالاتر از میرداماد',
        'نارمک، میدان هفت حوض',
      ],
    ],
    20,
  ],
  [['البرز', 'کرج', ['عظیمیه، بلوار اسدآبادی', 'گوهردشت، بلوار موذن']], 6],
  [
    [
      'اصفهان',
      'اصفهان',
      ['خیابان چهارباغ بالا', 'خیابان کاوه، نمایشگاه‌های خودرو'],
    ],
    7,
  ],
  [['خراسان رضوی', 'مشهد', ['بلوار وکیل‌آباد', 'خیابان امام رضا']], 6],
  [['فارس', 'شیراز', ['خیابان قصردشت', 'بلوار چمران']], 5],
  [['آذربایجان غربی', 'ارومیه', ['خیابان امام، کوچه‌ی بهار']], 5],
  [['اردبیل', 'اردبیل', ['خیابان سی‌متری']], 4],
  [['زنجان', 'زنجان', ['خیابان سعدی']], 3],
  [['گیلان', 'رشت', ['خیابان مطهری']], 3],
];

// Words a customer would write about the part they bought.
const REVIEWS: Record<
  'good' | 'ok' | 'bad',
  Record<'belt' | 'bearing', string[]>
> = {
  good: {
    bearing: [
      'اصل بود و دقیقاً با شماره فنی قطعه‌ی قبلی یکی بود. صدای چرخ کاملاً رفت.',
      'بسته‌بندی سالم، پلمپ کارخانه. نصب شد و بی‌صداست.',
      'برای مشتری‌های تعمیرگاه چندتا گرفتم، همه سالم و یکدست بودن.',
      'کیفیت تبریز واقعاً خوبه، از خارجی‌هایی که قبلاً می‌بستم کم نداره.',
      'سریع رسید، روز بعد تبریز تحویل گرفتم. ممنون از ماراتون پارتز.',
      'قیمت منصفانه نسبت به بازار، جنس هم درجه یک.',
      'بعد از دو هزار کیلومتر هنوز هیچ صدایی نداره.',
    ],
    belt: [
      'دایکوی اصل ایتالیا، با برچسب اصالت. نصبش راحت بود.',
      'دندانه‌ها دقیق و تمیز، با کیت سفت‌کن عوض کردم و موتور آرومه.',
      'نسبت به تسمه‌های بی‌نام بازار خیلی محکم‌تره.',
      'کارت گارانتی داشت و جنسش عالیه.',
    ],
  },
  ok: {
    bearing: [
      'جنس خوبه ولی ارسالش یه روز دیرتر از چیزی که گفته بودن رسید.',
      'قطعه سالم بود، فقط کاش جعبه‌ش محکم‌تر بود.',
      'برای قیمتش خوبه، فعلاً مشکلی نداشته.',
    ],
    belt: [
      'تسمه خوبیه، فقط موجودی کیتش تموم شده بود و جدا خریدم.',
      'خوبه ولی یکم گرون‌تر از جاهای دیگه بود.',
    ],
  },
  bad: {
    bearing: [
      'برای ماشین من نخورد؛ قبل از خرید حتماً شماره فنی رو چک کنید. مرجوعی رو قبول کردن.',
      'بعد از یه ماه یه کم صدا داره، شاید هم ایراد نصب بود.',
    ],
    belt: ['بسته‌بندی‌ش آسیب دیده بود، ولی خود تسمه سالم بود.'],
  },
};

const ADMIN_REPLIES = [
  'ممنون از خرید و نظرتون. اگر سؤالی درباره‌ی نصب داشتید از بخش تیکت در خدمتیم.',
  'سپاس از اعتمادتون به ماراتون پارتز.',
  'ببخشید بابت تأخیر؛ موضوع به واحد ارسال گفته شد.',
  'برای تطبیق قطعه، شماره فنی قطعه‌ی قدیمی یا مدل دقیق خودرو را در تیکت بفرستید تا قبل از ارسال چک کنیم.',
];

const TICKETS: Array<{
  title: string;
  subject: string;
  question: string;
  answer?: string;
  followUp?: string;
  status: TicketStatusEnum;
}> = [
  {
    title: 'پیگیری سفارش',
    subject: 'سفارش',
    question:
      'سلام، سفارشم سه روزه ثبت شده ولی هنوز ارسال نشده. کی ارسال می‌شه؟',
    answer:
      'سلام، سفارش شما امروز به پست تحویل شد و کد رهگیری در صفحه‌ی سفارش ثبت شده است.',
    status: TicketStatusEnum.Closed,
  },
  {
    title: 'بلبرینگ چرخ جلو پراید مدل ۸۸',
    subject: 'استعلام قطعه',
    question:
      'برای پراید ۱۳۱ مدل ۸۸ کدوم بلبرینگ چرخ جلو رو باید بگیرم؟ یک‌تکه یا دوتکه؟',
    answer:
      'پراید‌های بعد از ۸۵ بلبرینگ یک‌تکه DAC35650035 دارند. اگر توپی شما قدیمی است، JL69349/10 مناسب است.',
    followUp: 'ممنون، یک‌تکه‌ست. سفارش دادم.',
    status: TicketStatusEnum.Closed,
  },
  {
    title: 'خرید عمده برای تعمیرگاه',
    subject: 'خرید عمده',
    question:
      'برای تعمیرگاه از هر کدوم بلبرینگ‌های پلوس ۴۰۵ و ۲۰۶ یک کارتن می‌خوام. قیمت عمده دارید؟',
    answer:
      'بله، برای خرید کارتنی تخفیف داریم. لیست قیمت عمده برای شماره‌ی شما پیامک شد.',
    status: TicketStatusEnum.Answered,
  },
  {
    title: 'فاکتور رسمی',
    subject: 'مالی',
    question: 'برای شرکت فاکتور رسمی با کد اقتصادی لازم دارم. امکانش هست؟',
    answer: 'بله، مشخصات شرکت را همین‌جا بفرستید تا فاکتور رسمی صادر شود.',
    status: TicketStatusEnum.Answered,
  },
  {
    title: 'تسمه تایم ۲۰۶ تیپ ۵',
    subject: 'استعلام قطعه',
    question: 'برای ۲۰۶ تیپ ۵ کدوم تسمه رو باید بگیرم؟ ۱۰۴ یا ۱۳۲ دندانه؟',
    answer:
      'تیپ ۵ و ۶ موتور TU5 دارند و تسمه‌ی دایکو 94997 (۱۳۲ دندانه) مناسب آن‌هاست. ۱۰۴ دندانه برای تیپ ۲ و ۳ است.',
    status: TicketStatusEnum.Closed,
  },
  {
    title: 'مرجوعی بلبرینگ',
    subject: 'مرجوعی',
    question:
      'بلبرینگ اشتباهی سفارش دادم و به ماشینم نمی‌خوره. چطوری مرجوع کنم؟',
    answer:
      'از صفحه‌ی سفارش گزینه‌ی «درخواست مرجوعی» را بزنید. قطعه باید نصب‌نشده و در جعبه‌ی سالم باشد.',
    status: TicketStatusEnum.Closed,
  },
  {
    title: 'زمان ارسال به مشهد',
    subject: 'ارسال',
    question: 'ارسال به مشهد با تیپاکس چند روز طول می‌کشه؟',
    status: TicketStatusEnum.Open,
  },
  {
    title: 'اصالت تسمه دایکو',
    subject: 'اصالت کالا',
    question: 'از کجا مطمئن بشم تسمه دایکو اصله؟',
    answer:
      'روی جعبه برچسب اصالت و کد رهگیری نماینده‌ی رسمی هست و روی خود تسمه شماره فنی و Made in Italy چاپ شده.',
    status: TicketStatusEnum.Answered,
  },
  {
    title: 'موجود شدن توپی ABS',
    subject: 'موجودی',
    question: 'توپی چرخ عقب ۴۰۵ ABS کی موجود می‌شه؟',
    answer:
      'محموله‌ی جدید هفته‌ی آینده می‌رسد. می‌توانید در صفحه‌ی کالا «خبرم کن» را بزنید.',
    status: TicketStatusEnum.Closed,
  },
  {
    title: 'تغییر آدرس سفارش',
    subject: 'سفارش',
    question: 'آدرس سفارشم رو اشتباه زدم، می‌شه قبل از ارسال عوضش کنید؟',
    status: TicketStatusEnum.Open,
  },
  {
    title: 'کیت کلاچ ۴۰۵',
    subject: 'استعلام قطعه',
    question:
      'بلبرینگ کلاچ تخت و تخم‌مرغی چه فرقی دارن؟ ماشینم ۴۰۵ مدل ۹۰ هست.',
    answer:
      'به نوع دیسک و صفحه بستگی دارد. اکثر ۴۰۵های بعد از ۸۵ مدل تخت VKC2216 دارند؛ اگر مطمئن نیستید عکس قطعه‌ی قدیمی را بفرستید.',
    followUp: 'عکسش رو فرستادم.',
    status: TicketStatusEnum.Open,
  },
  {
    title: 'پرداخت ناموفق',
    subject: 'پرداخت',
    question: 'پول از حسابم کم شد ولی سفارش پرداخت‌نشده مونده.',
    answer:
      'مبلغ ظرف ۷۲ ساعت توسط بانک برگشت داده می‌شود. اگر برنگشت شماره‌ی پیگیری را بفرستید.',
    status: TicketStatusEnum.Closed,
  },
];

async function seed() {
  refuseInProduction('seed:mock');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dataSource = app.get(DataSource);
  const invoices = app.get(InvoiceService);
  const taxPercent = Number(process.env.TAX_RATE_PERCENT ?? 0) || 0;

  // MySQL fills created/updated columns itself, with "now"; everything here
  // happened in the past. The date goes in as UTC and is converted to the
  // column's own zone there.
  const backdate = async <T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    id: number,
    at: Date,
    properties: string[],
  ) => {
    const meta = dataSource.getMetadata(entity);
    const sets = properties
      .map((property) => meta.findColumnWithPropertyName(property))
      .filter((column) => !!column)
      .map(
        (column) =>
          `\`${column.databaseName}\` = CONVERT_TZ(?, '+00:00', @@session.time_zone)`,
      );
    if (!sets.length) return;
    await dataSource.query(
      `UPDATE \`${meta.tableName}\` SET ${sets.join(', ')} WHERE \`id\` = ?`,
      [...sets.map(() => toUtcSql(at)), id],
    );
  };

  try {
    const products = await dataSource.getRepository(Product).find({
      relations: { categories: true },
    });
    if (products.length === 0) {
      console.error('No products: run `npm run seed:catalog` first.');
      process.exit(1);
    }

    // ---------- start from the catalogue alone ----------
    const keep = new Set<string>(['migrations', 'typeorm_metadata', 'users']);
    for (const entity of [
      Category,
      Brand,
      Product,
      ProductImage,
      Attribute,
      AttributeOption,
      CategoryAttribute,
      ProductAttributeValue,
      ShippingZone,
      ShippingMethod,
      ShippingRate,
    ]) {
      const meta = dataSource.getMetadata(entity);
      keep.add(meta.tableName);
      for (const relation of meta.manyToManyRelations) {
        const junction = relation.junctionEntityMetadata?.tableName;
        // Product <-> category stays; discount code <-> anything goes.
        if (junction && !junction.startsWith('discount')) keep.add(junction);
      }
    }
    const tables: Array<{ name: string }> = await dataSource.query(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES ' +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
    );
    await dataSource.transaction(async (manager) => {
      await manager.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const { name } of tables) {
          if (!keep.has(name))
            await manager.query(`TRUNCATE TABLE \`${name}\``);
        }
        await manager.query('DELETE FROM `users` WHERE `role` <> ?', [
          userRoleEnum.AdminUser,
        ]);
      } finally {
        await manager.query('SET FOREIGN_KEY_CHECKS = 1');
      }
    });

    // Stock back to the catalogue's, sales and ratings back to nothing.
    const bySlug = new Map(CATALOGUE.map((item) => [item.slug, item]));
    const catalogIndex = new Map(
      CATALOGUE.map((item, index) => [item.slug, index]),
    );
    const stockFor = (index: number) =>
      index % 17 === 5 ? 0 : index % 11 === 3 ? 3 : 12 + ((index * 37) % 140);
    // A part on the shelf before three months of sales: what the catalogue
    // shows now, plus what these orders are about to take off it.
    const shelf = new Map<number, number>();
    for (const product of products) {
      const index = catalogIndex.get(product.slug) ?? 0;
      const base = stockFor(index);
      shelf.set(
        product.id,
        base === 0 ? between(6, 14) : base + between(20, 60),
      );
    }

    // ---------- people ----------
    const users = dataSource.getRepository(User);
    const password = await bcrypt.hash(DEMO_PASSWORD, 10);
    const [adminMobile, ...demoMobiles] = DEMO_ACCOUNT_MOBILES;
    let admin = await users.findOne({ where: { mobile: adminMobile } });
    if (!admin) {
      admin = await users.save(
        users.create({
          mobile: adminMobile,
          display_name: 'مدیر فروشگاه',
          password,
          role: userRoleEnum.AdminUser,
        }),
      );
    }
    const staff =
      (await users.findOne({
        where: { role: userRoleEnum.AdminUser },
        order: { id: 'ASC' },
      })) ?? admin;

    interface Customer {
      user: User;
      garage: boolean;
      address: Address;
      joined: Date;
      wallet?: { row: Wallet; balance: number };
      // How often they come back: a garage orders far more.
      weight: number;
    }
    const customers: Customer[] = [];
    const addresses = dataSource.getRepository(Address);
    const usedMobiles = new Set(DEMO_ACCOUNT_MOBILES);
    const mobile = () => {
      for (;;) {
        const value = `09${pick(['12', '14', '35', '36', '01', '91', '30'])}${String(between(1_000_000, 9_999_999))}`;
        if (!usedMobiles.has(value)) {
          usedMobiles.add(value);
          return value;
        }
      }
    };

    const people: Array<{ mobile: string; name: string; garage: boolean }> = [
      { mobile: demoMobiles[0], name: 'علی رضایی', garage: false },
      { mobile: demoMobiles[1], name: 'تعمیرگاه برادران نوری', garage: true },
      { mobile: demoMobiles[2], name: 'سارا محمدی', garage: false },
    ];
    for (const garage of GARAGES.slice(1)) {
      people.push({ mobile: mobile(), name: garage, garage: true });
    }
    for (let index = 0; people.length < 52; index += 1) {
      people.push({
        mobile: mobile(),
        name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        garage: false,
      });
    }

    for (const [index, person] of people.entries()) {
      // Most joined in the window, which is what the "new customers" line
      // of a report is about; the demo accounts have been around longer.
      const joinedDaysAgo = index < 3 ? DAYS + 30 : between(1, DAYS + 20);
      const joined = daysAgo(joinedDaysAgo, between(9, 22));
      const user = await users.save(
        users.create({
          mobile: person.mobile,
          display_name: person.name,
          password,
          role: userRoleEnum.NormalUser,
        }),
      );
      await backdate(User, user.id, joined, ['createdAt', 'updatedAt']);
      const [province, city, streets] = person.garage
        ? pick(PLACES.slice(0, 5))[0]
        : weighted(PLACES);
      const address = await addresses.save(
        addresses.create({
          user,
          province,
          city,
          address: `${pick(streets)}، پلاک ${between(2, 240)}${chance(0.4) ? `، واحد ${between(1, 12)}` : ''}`,
          postal_code: String(between(1_000_000_000, 9_999_999_999)),
          receiver_mobile: person.mobile,
          description: person.garage ? 'تحویل به مغازه، ساعت کاری ۹ تا ۱۹' : '',
        }),
      );
      await backdate(Address, address.id, joined, ['created_at', 'updated_at']);
      customers.push({
        user,
        garage: person.garage,
        address,
        joined,
        weight: person.garage ? 7 : index < 3 ? 3 : pick([1, 1, 1, 2, 3]),
      });
    }

    // ---------- wallets ----------
    const wallets = dataSource.getRepository(Wallet);
    const ledger = dataSource.getRepository(WalletTransaction);
    const record = async (
      customer: Customer,
      amount: number,
      type: WalletTransactionTypeEnum,
      description: string,
      at: Date,
    ) => {
      const wallet = customer.wallet!;
      wallet.balance += amount;
      const entry = await ledger.save(
        ledger.create({
          wallet: wallet.row,
          amount,
          balanceAfter: wallet.balance,
          type,
          description,
        }),
      );
      await backdate(WalletTransaction, entry.id, at, ['createdAt']);
    };
    for (const customer of customers) {
      if (!customer.garage && !chance(0.45)) continue;
      const row = await wallets.save(
        wallets.create({ user: customer.user, amount: 0, is_active: true }),
      );
      await backdate(Wallet, row.id, customer.joined, [
        'created_at',
        'updated_at',
      ]);
      customer.wallet = { row, balance: 0 };
      const at = new Date(customer.joined.getTime() + between(1, 48) * HOUR);
      if (at.getTime() < NOW) {
        await record(
          customer,
          roundTo(
            customer.garage
              ? between(8, 25) * 1_000_000
              : between(1, 6) * 500_000,
            100_000,
          ),
          chance(0.8)
            ? WalletTransactionTypeEnum.ZarinpalCharge
            : WalletTransactionTypeEnum.AdminCharge,
          chance(0.8)
            ? 'شارژ کیف پول از درگاه زرین‌پال'
            : 'شارژ توسط پشتیبانی (هدیه‌ی خرید اول)',
          at,
        );
      }
    }

    // ---------- discount codes ----------
    const codes = dataSource.getRepository(DiscountCode);
    const bearingsCategory = await dataSource
      .getRepository(Category)
      .findOne({ where: { slug: 'bearings' } });
    const beltCategories = await dataSource.getRepository(Category).find({
      where: { slug: In(['timing-belt-single', 'timing-belt-kits']) },
    });
    const welcome = await codes.save(
      codes.create({
        code: 'WELCOME10',
        capacity: 500,
        type: DiscountTypeEnum.Percent,
        off_percent: 10,
        max_discount_amount: 300_000,
        per_user_limit: 1,
      }),
    );
    const garageCode = await codes.save(
      codes.create({
        code: 'GARAGE7',
        capacity: 300,
        type: DiscountTypeEnum.Percent,
        off_percent: 7,
        max_discount_amount: 1_500_000,
        min_order_amount: 3_000_000,
      }),
    );
    const beltCode = await codes.save(
      codes.create({
        code: 'DAYCO12',
        capacity: 120,
        type: DiscountTypeEnum.Percent,
        off_percent: 12,
        max_discount_amount: 400_000,
        categories: beltCategories,
        expires_at: new Date(NOW + 20 * DAY),
      }),
    );
    const flat = await codes.save(
      codes.create({
        code: 'TABRIZ150',
        capacity: 200,
        type: DiscountTypeEnum.Fixed,
        off_percent: 0,
        off_amount: 150_000,
        min_order_amount: 1_500_000,
      }),
    );
    if (bearingsCategory) {
      await codes.save(
        codes.create({
          code: 'BEARING15',
          capacity: 80,
          type: DiscountTypeEnum.Percent,
          off_percent: 15,
          max_discount_amount: 500_000,
          categories: [bearingsCategory],
          starts_at: new Date(NOW + 3 * DAY),
          expires_at: new Date(NOW + 33 * DAY),
        }),
      );
    }
    const codeUses = new Map<number, number>();
    const usedWelcome = new Set<number>();

    // ---------- shipping, as the catalogue set it up ----------
    const rates = await dataSource
      .getRepository(ShippingRate)
      .find({ relations: { method: true, zone: true } });
    const zoneFor = (province: string) =>
      rates.find((rate) => rate.zone.provinces?.includes(province))?.zone ??
      rates.find((rate) => rate.zone.is_default)!.zone;
    const rateOf = (method: string, zoneId: number) =>
      rates.find(
        (rate) => rate.method.code === method && rate.zone.id === zoneId,
      );

    // ---------- what sells ----------
    // Wheel bearings, the pulleys and the belts of the common cars sell
    // most; gearbox internals and the rarer cars, less.
    const popularity = (item?: CatalogProduct) => {
      if (!item) return 1;
      let weight = 2;
      if (
        ['wheel-ball', 'hub', 'belt', 'belt-kit', 'tensioner'].includes(
          item.kind,
        )
      )
        weight += 3;
      if (['axle', 'idler', 'clutch', 'ball'].includes(item.kind)) weight += 1;
      if (
        item.cars.some((car) =>
          ['pride', 'peugeot-405', 'peugeot-206'].includes(car),
        )
      )
        weight += 2;
      return weight;
    };
    const sellable = products.map(
      (product) => [product, popularity(bySlug.get(product.slug))] as const,
    );

    // ---------- orders ----------
    const orders = dataSource.getRepository(Order);
    const orderItems = dataSource.getRepository(OrderItem);
    interface Placed {
      order: Order;
      customer: Customer;
      at: Date;
      lines: Array<{ item: OrderItem; product: Product }>;
    }
    const placed: Placed[] = [];
    const chooser = customers.map(
      (customer) => [customer, customer.weight] as const,
    );

    for (let day = DAYS - 1; day >= 0; day -= 1) {
      const date = new Date(NOW - day * DAY);
      // Growing over the quarter, quieter on Fridays, busier on Saturdays.
      const weekday = date.getDay();
      const factor =
        weekday === 5 ? 0.45 : weekday === 6 ? 1.3 : weekday === 4 ? 0.8 : 1;
      const expected = (2.2 + 2.8 * ((DAYS - day) / DAYS)) * factor;
      const count = Math.max(0, Math.round(expected + (random() - 0.5) * 2.2));

      const hours = Array.from({ length: count }, () =>
        weighted([
          [9, 2],
          [10, 3],
          [11, 4],
          [12, 3],
          [13, 2],
          [14, 2],
          [16, 3],
          [17, 3],
          [18, 3],
          [19, 3],
          [20, 4],
          [21, 4],
          [22, 3],
          [23, 1],
        ] as const),
      ).sort((a, b) => a - b);

      for (const hour of hours) {
        const at = daysAgo(day, hour);
        if (at.getTime() > NOW - 10 * 60_000) continue;
        const customer = weighted(chooser);
        if (customer.joined.getTime() > at.getTime()) continue;

        // What goes in the basket.
        const lines: Array<{ product: Product; quantity: number }> = [];
        const lineCount = customer.garage
          ? between(2, 5)
          : weighted([
              [1, 6],
              [2, 3],
              [3, 1],
            ] as const);
        const first = weighted(sellable);
        lines.push({ product: first, quantity: 1 });
        // A belt usually goes with its tensioner, a wheel bearing with its
        // pair: the next lines lean toward the same car.
        const car = bySlug.get(first.slug)?.cars[0];
        while (lines.length < lineCount) {
          const pool =
            car && chance(0.6)
              ? sellable.filter(([product]) =>
                  bySlug.get(product.slug)?.cars.includes(car),
                )
              : sellable;
          const product = weighted(pool.length ? pool : sellable);
          if (lines.some((line) => line.product.id === product.id)) break;
          lines.push({ product, quantity: 1 });
        }
        for (const line of lines) {
          const item = bySlug.get(line.product.slug);
          const bulk =
            customer.garage &&
            item?.kind !== 'hub' &&
            item?.kind !== 'belt-kit';
          line.quantity = bulk
            ? weighted([
                [2, 3],
                [4, 3],
                [5, 2],
                [10, 2],
                [20, 1],
              ] as const)
            : weighted([
                [1, 8],
                [2, 3],
              ] as const);
          line.quantity = Math.min(
            line.quantity,
            shelf.get(line.product.id) ?? 0,
          );
        }
        const basket = lines.filter((line) => line.quantity > 0);
        if (basket.length === 0) continue;

        // Its state, by its age.
        const age = day;
        let status: OrderStatusEnum;
        if (age <= 1) {
          status = weighted([
            [OrderStatusEnum.AwaitingPayment, 1],
            [OrderStatusEnum.Pending, 0.5],
            [OrderStatusEnum.Paid, 4],
            [OrderStatusEnum.Processing, 3],
          ] as const);
        } else if (age <= 4) {
          status = weighted([
            [OrderStatusEnum.Processing, 3],
            [OrderStatusEnum.Sent, 6],
            [OrderStatusEnum.Cancelled, 1],
          ] as const);
        } else if (age <= 10) {
          status = weighted([
            [OrderStatusEnum.Sent, 2],
            [OrderStatusEnum.Delivered, 8],
            [OrderStatusEnum.Cancelled, 1],
          ] as const);
        } else {
          status = weighted([
            [OrderStatusEnum.Delivered, 11],
            [OrderStatusEnum.Cancelled, 1],
          ] as const);
        }

        const zone = zoneFor(customer.address.province);
        const methodCode =
          zone.provinces?.includes('آذربایجان شرقی') &&
          customer.address.city === 'تبریز' &&
          chance(0.35)
            ? 'peyk'
            : chance(0.75)
              ? 'post-pishtaz'
              : 'tipax';
        const rate =
          rateOf(methodCode, zone.id) ?? rateOf('post-pishtaz', zone.id)!;

        const items = basket.map((line) =>
          orderItems.create({
            product: line.product,
            price: Number(line.product.sale_price ?? line.product.price),
            quantity: line.quantity,
          }),
        );
        const itemsTotal = items.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );

        // A code, now and then, when it applies.
        let discount: DiscountCode | null = null;
        let discountAmount = 0;
        const beltTotal = items
          .filter((item) =>
            ['belt', 'belt-kit'].includes(
              bySlug.get(item.product.slug)?.kind ?? '',
            ),
          )
          .reduce((sum, item) => sum + item.price * item.quantity, 0);
        if (
          !usedWelcome.has(customer.user.id) &&
          chance(0.25) &&
          Math.abs(at.getTime() - customer.joined.getTime()) < 20 * DAY
        ) {
          discount = welcome;
          discountAmount = Math.min(roundTo(itemsTotal * 0.1, 1000), 300_000);
          usedWelcome.add(customer.user.id);
        } else if (customer.garage && itemsTotal >= 3_000_000 && chance(0.35)) {
          discount = garageCode;
          discountAmount = Math.min(
            roundTo(itemsTotal * 0.07, 1000),
            1_500_000,
          );
        } else if (beltTotal > 0 && day < 40 && chance(0.25)) {
          discount = beltCode;
          discountAmount = Math.min(roundTo(beltTotal * 0.12, 1000), 400_000);
        } else if (itemsTotal >= 1_500_000 && chance(0.08)) {
          discount = flat;
          discountAmount = 150_000;
        }
        if (discount)
          codeUses.set(discount.id, (codeUses.get(discount.id) ?? 0) + 1);

        const goods = itemsTotal - discountAmount;
        const grams = basket.reduce(
          (sum, line) =>
            sum +
            (bySlug.get(line.product.slug)?.weightGrams ?? 300) * line.quantity,
          0,
        );
        const kilos = Math.max(1, Math.ceil(grams / 1000));
        const free =
          rate.free_shipping_threshold &&
          goods >= Number(rate.free_shipping_threshold);
        const shipping = free
          ? 0
          : Number(rate.base_cost) +
            Math.max(0, kilos - 1) * Number(rate.per_kg_cost ?? 0);

        // How it is paid.
        let method: PaymentMethodEnum = PaymentMethodEnum.Zarinpal;
        if (customer.wallet && chance(customer.garage ? 0.6 : 0.4)) {
          method = PaymentMethodEnum.Wallet;
        } else if (
          rate.method.supports_cash_on_delivery &&
          chance(0.18) &&
          ![OrderStatusEnum.AwaitingPayment, OrderStatusEnum.Pending].includes(
            status,
          )
        ) {
          method = PaymentMethodEnum.CashOnDelivery;
        }
        if (
          [OrderStatusEnum.AwaitingPayment, OrderStatusEnum.Pending].includes(
            status,
          )
        )
          method = PaymentMethodEnum.Zarinpal;
        const codFee =
          method === PaymentMethodEnum.CashOnDelivery
            ? Number(rate.cash_on_delivery_fee ?? 0)
            : 0;
        const tax = taxPercent ? Math.round((goods * taxPercent) / 100) : 0;
        const total = goods + shipping + tax + codFee;

        // Cash on delivery is paid at the door; everything else up front,
        // except what never got paid.
        const unpaid = [
          OrderStatusEnum.AwaitingPayment,
          OrderStatusEnum.Pending,
          OrderStatusEnum.Cancelled,
        ].includes(status);
        const deliveredAt =
          status === OrderStatusEnum.Delivered
            ? new Date(
                at.getTime() +
                  between(1, rate.method.estimated_days_max ?? 4) * DAY +
                  between(1, 8) * HOUR,
              )
            : null;
        const paidAt = unpaid
          ? null
          : method === PaymentMethodEnum.CashOnDelivery
            ? deliveredAt
            : new Date(at.getTime() + between(1, 6) * 60_000);

        if (
          method === PaymentMethodEnum.Wallet &&
          !unpaid &&
          customer.wallet!.balance < total
        ) {
          // Topped up just before paying, as a customer would.
          const topUp =
            Math.ceil(
              (total - customer.wallet!.balance + between(0, 4) * 500_000) /
                100_000,
            ) * 100_000;
          await record(
            customer,
            topUp,
            WalletTransactionTypeEnum.ZarinpalCharge,
            'شارژ کیف پول از درگاه زرین‌پال',
            new Date(at.getTime() - 2 * 60_000),
          );
        }

        const order = await orders.save(
          orders.create({
            user: customer.user,
            address: customer.address,
            shippingAddressSnapshot: {
              province: customer.address.province,
              city: customer.address.city,
              address: customer.address.address,
              postal_code: customer.address.postal_code,
              receiver_mobile: customer.address.receiver_mobile,
            },
            items,
            items_total: itemsTotal,
            discount,
            discount_amount: discountAmount,
            shipping_cost: shipping,
            tax_amount: tax,
            cod_fee: codFee,
            total_price: total,
            total_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
            status,
            payment_method: method,
            shipping_method: rate.method,
            shipping_method_title: rate.method.title,
            shipping_eta_days_min: rate.method.estimated_days_min,
            shipping_eta_days_max: rate.method.estimated_days_max,
            ...(status === OrderStatusEnum.AwaitingPayment
              ? { payment_expires_at: new Date(at.getTime() + 30 * 60_000) }
              : {}),
            ...(paidAt
              ? {
                  payed_time: paidAt,
                  invoice_number: await dataSource.transaction((manager) =>
                    invoices.nextNumber(manager, paidAt),
                  ),
                }
              : {}),
            ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
            ...([OrderStatusEnum.Sent, OrderStatusEnum.Delivered].includes(
              status,
            )
              ? {
                  tracking_code: `${methodCode === 'tipax' ? 'TPX' : methodCode === 'peyk' ? 'PYK' : ''}${between(100_000_000, 999_999_999)}`,
                }
              : {}),
          }),
        );
        await backdate(Order, order.id, at, ['createdAt']);
        await backdate(Order, order.id, deliveredAt ?? paidAt ?? at, [
          'updatedAt',
        ]);

        if (method === PaymentMethodEnum.Wallet && paidAt) {
          await record(
            customer,
            -total,
            WalletTransactionTypeEnum.OrderPayment,
            `پرداخت سفارش #${order.id}`,
            paidAt,
          );
        }
        if (status !== OrderStatusEnum.Cancelled) {
          for (const line of basket) {
            shelf.set(
              line.product.id,
              (shelf.get(line.product.id) ?? 0) - line.quantity,
            );
          }
        }
        placed.push({
          order,
          customer,
          at,
          lines: order.items.map((item) => ({
            item,
            product: basket.find((line) => line.product.id === item.product.id)!
              .product,
          })),
        });
      }
    }

    // ---------- returns ----------
    const returnsRepo = dataSource.getRepository(ReturnRequest);
    const returnItems = dataSource.getRepository(ReturnItem);
    const delivered = placed.filter(
      (entry) =>
        entry.order.status === OrderStatusEnum.Delivered &&
        entry.order.delivered_at &&
        entry.order.delivered_at.getTime() < NOW - 2 * DAY,
    );
    const returnPlan: Array<[ReturnStatusEnum, number]> = [
      [ReturnStatusEnum.Refunded, 6],
      [ReturnStatusEnum.Requested, 4],
      [ReturnStatusEnum.Approved, 3],
      [ReturnStatusEnum.Received, 2],
      [ReturnStatusEnum.Rejected, 2],
      [ReturnStatusEnum.Cancelled, 1],
    ];
    const returned = new Set<number>();
    const reasonText: Record<ReturnReasonEnum, string[]> = {
      [ReturnReasonEnum.WrongItem]: [
        'شماره فنی با قطعه‌ی ماشینم یکی نبود.',
        'به جای سوراخ بزرگ، سوراخ کوچک فرستاده شده.',
      ],
      [ReturnReasonEnum.Damaged]: [
        'جعبه له شده بود و کاسه‌نمد یک طرف آسیب دیده.',
        'بلبرینگ موقع چرخوندن با دست صدا می‌داد.',
      ],
      [ReturnReasonEnum.NotAsDescribed]: ['عرض تسمه با مشخصات صفحه فرق داشت.'],
      [ReturnReasonEnum.ChangedMind]: [
        'قطعه رو از جای دیگه زودتر گرفتم، نصب نشده و پلمپه.',
        'ماشین رو فروختم، قطعه نصب نشده.',
      ],
      [ReturnReasonEnum.Other]: ['دوتا سفارش داده بودم اشتباهی.'],
    };
    let refundedTotal = 0;
    for (const [status, count] of returnPlan) {
      for (let n = 0; n < count; n += 1) {
        const candidates = delivered.filter(
          (entry) => !returned.has(entry.order.id),
        );
        if (!candidates.length) break;
        // Older requests are the settled ones; the open ones are recent.
        const settled = [
          ReturnStatusEnum.Refunded,
          ReturnStatusEnum.Rejected,
          ReturnStatusEnum.Cancelled,
        ].includes(status);
        const pool = candidates.filter((entry) =>
          settled
            ? entry.at.getTime() < NOW - 20 * DAY
            : entry.at.getTime() > NOW - 25 * DAY,
        );
        const entry = pick(pool.length ? pool : candidates);
        returned.add(entry.order.id);
        const line = pick(entry.lines);
        const quantity = Math.min(line.item.quantity, between(1, 2));
        const reason = weighted([
          [ReturnReasonEnum.WrongItem, 5],
          [ReturnReasonEnum.Damaged, 2],
          [ReturnReasonEnum.NotAsDescribed, 1],
          [ReturnReasonEnum.ChangedMind, 2],
          [ReturnReasonEnum.Other, 1],
        ] as const);
        const requestedAt = new Date(
          Math.min(
            NOW - HOUR,
            entry.order.delivered_at!.getTime() +
              between(1, 5) * DAY +
              between(1, 9) * HOUR,
          ),
        );
        const resolvedAt = [
          ReturnStatusEnum.Requested,
          ReturnStatusEnum.Cancelled,
        ].includes(status)
          ? null
          : new Date(
              Math.min(
                NOW - 30 * 60_000,
                requestedAt.getTime() + between(1, 4) * DAY,
              ),
            );
        const refund =
          status === ReturnStatusEnum.Rejected ? 0 : line.item.price * quantity;
        const request = await returnsRepo.save(
          returnsRepo.create({
            order: entry.order,
            user: entry.customer.user,
            status,
            reason,
            description: pick(reasonText[reason]),
            refund_amount:
              status === ReturnStatusEnum.Refunded
                ? refund
                : [
                      ReturnStatusEnum.Approved,
                      ReturnStatusEnum.Received,
                    ].includes(status)
                  ? refund
                  : 0,
            restock: reason !== ReturnReasonEnum.Damaged,
            admin_note:
              status === ReturnStatusEnum.Rejected
                ? 'قطعه نصب و استفاده شده بود؛ طبق شرایط مرجوعی قابل قبول نیست.'
                : status === ReturnStatusEnum.Refunded
                  ? 'قطعه سالم دریافت شد، مبلغ بازگردانده شد.'
                  : null,
            resolved_by: resolvedAt ? staff : null,
            resolved_at: resolvedAt,
          }),
        );
        await returnItems.save(
          returnItems.create({
            returnRequest: request,
            orderItem: line.item,
            quantity,
          }),
        );
        await backdate(ReturnRequest, request.id, requestedAt, ['created_at']);
        await backdate(ReturnRequest, request.id, resolvedAt ?? requestedAt, [
          'updated_at',
        ]);

        if (status === ReturnStatusEnum.Refunded) {
          refundedTotal += refund;
          await orders.update(entry.order.id, { refunded_amount: refund });
          if (
            entry.order.payment_method === PaymentMethodEnum.Wallet &&
            entry.customer.wallet
          ) {
            await record(
              entry.customer,
              refund,
              WalletTransactionTypeEnum.Refund,
              `بازگشت وجه مرجوعی سفارش #${entry.order.id}`,
              resolvedAt!,
            );
          }
        }
        if (
          [ReturnStatusEnum.Refunded, ReturnStatusEnum.Received].includes(
            status,
          ) &&
          reason !== ReturnReasonEnum.Damaged
        ) {
          shelf.set(
            line.product.id,
            (shelf.get(line.product.id) ?? 0) + quantity,
          );
        }
      }
    }

    // Wallet balances, as their ledgers left them.
    for (const customer of customers) {
      if (customer.wallet) {
        await wallets.update(customer.wallet.row.id, {
          amount: customer.wallet.balance,
        });
      }
    }
    for (const [id, uses] of codeUses) {
      const code = await codes.findOneBy({ id });
      if (code)
        await codes.update(id, { capacity: Math.max(0, code.capacity - uses) });
    }

    // ---------- stock and sales ----------
    for (const product of products) {
      await dataSource.query(
        'UPDATE `products` SET `stock` = ? WHERE `id` = ?',
        [Math.max(0, shelf.get(product.id) ?? 0), product.id],
      );
    }
    await dataSource.query(
      'UPDATE `products` SET `sales_count` = 0, `rating_avg` = 0, `rating_count` = 0',
    );
    await dataSource.query(
      'UPDATE `products` p INNER JOIN (' +
        'SELECT oi.`product_id`, SUM(oi.`quantity`) AS q FROM `order_items` oi ' +
        'INNER JOIN `order` o ON o.`id` = oi.`order_id` ' +
        "WHERE o.`status` IN ('paid', 'processing', 'sent', 'delivered') " +
        'GROUP BY oi.`product_id`) s ON s.`product_id` = p.`id` ' +
        'SET p.`sales_count` = s.q',
    );

    // ---------- reviews ----------
    // Written by people who received the part, a few days after.
    const comments = dataSource.getRepository(Comment);
    const reviewed = new Set<string>();
    let reviewCount = 0;
    for (const entry of placed) {
      if (
        entry.order.status !== OrderStatusEnum.Delivered ||
        !entry.order.delivered_at
      )
        continue;
      for (const { product } of entry.lines) {
        const key = `${entry.customer.user.id}:${product.id}`;
        if (reviewed.has(key) || !chance(entry.customer.garage ? 0.15 : 0.42))
          continue;
        reviewed.add(key);
        const at = new Date(
          entry.order.delivered_at.getTime() +
            between(1, 12) * DAY +
            between(1, 10) * HOUR,
        );
        if (at.getTime() > NOW - HOUR) continue;
        const rate = weighted([
          [5, 55],
          [4, 27],
          [3, 10],
          [2, 5],
          [1, 3],
        ] as const);
        const mood = rate >= 4 ? 'good' : rate === 3 ? 'ok' : 'bad';
        const kind = ['belt', 'belt-kit'].includes(
          bySlug.get(product.slug)?.kind ?? '',
        )
          ? 'belt'
          : 'bearing';
        const status =
          at.getTime() > NOW - 2 * DAY
            ? CommentStatusEnum.Pending
            : weighted([
                [CommentStatusEnum.Approved, 88],
                [CommentStatusEnum.Pending, 6],
                [CommentStatusEnum.Rejected, 3],
              ] as const);
        const comment = await comments.save(
          comments.create({
            product,
            user: entry.customer.user,
            comment: pick(REVIEWS[mood][kind]),
            rate,
            status,
          }),
        );
        await backdate(Comment, comment.id, at, ['created_at', 'updated_at']);
        reviewCount += 1;

        if (
          status === CommentStatusEnum.Approved &&
          (rate <= 3 ? chance(0.7) : chance(0.12))
        ) {
          const replyAt = new Date(
            Math.min(NOW - 30 * 60_000, at.getTime() + between(2, 30) * HOUR),
          );
          const reply = await comments.save(
            comments.create({
              product,
              user: staff,
              comment:
                rate <= 2
                  ? ADMIN_REPLIES[3]
                  : rate === 3
                    ? ADMIN_REPLIES[2]
                    : pick(ADMIN_REPLIES.slice(0, 2)),
              rate: null,
              status: CommentStatusEnum.Approved,
              parent: comment,
            }),
          );
          await backdate(Comment, reply.id, replyAt, [
            'created_at',
            'updated_at',
          ]);
        }
      }
    }
    await dataSource.query(
      'UPDATE `products` p INNER JOIN (' +
        'SELECT `product_id` AS pid, AVG(`rate`) AS avg_rate, COUNT(*) AS cnt ' +
        "FROM `comments` WHERE `status` = 'approved' AND `deleted_at` IS NULL AND `rate` IS NOT NULL " +
        'GROUP BY `product_id`) c ON c.pid = p.`id` ' +
        'SET p.`rating_avg` = c.avg_rate, p.`rating_count` = c.cnt',
    );

    // ---------- support tickets ----------
    const tickets = dataSource.getRepository(Ticket);
    for (const [index, thread] of TICKETS.entries()) {
      const customer =
        index === 2 ? customers[1] : pick(customers.slice(0, 20));
      const openedDaysAgo =
        thread.status === TicketStatusEnum.Open
          ? between(0, 3)
          : between(4, DAYS - 5);
      const openedAt = daysAgo(openedDaysAgo, between(9, 22));
      if (openedAt.getTime() > NOW) openedAt.setTime(NOW - 2 * HOUR);
      const root = await tickets.save(
        tickets.create({
          title: thread.title,
          subject: thread.subject,
          description: thread.question,
          status: thread.status,
          user: customer.user,
        }),
      );
      await backdate(Ticket, root.id, openedAt, ['created_at']);
      let at = openedAt;
      for (const [text, author] of [
        [thread.answer, staff],
        [thread.followUp, customer.user],
      ] as const) {
        if (!text) continue;
        at = new Date(
          Math.min(NOW - 20 * 60_000, at.getTime() + between(1, 20) * HOUR),
        );
        const reply = await tickets.save(
          tickets.create({
            title: thread.title,
            subject: thread.subject,
            description: text,
            status: thread.status,
            user: author,
            reply_to: root,
          }),
        );
        await backdate(Ticket, reply.id, at, ['created_at']);
      }
    }

    // ---------- summary ----------
    const [counts] = await dataSource.query(
      'SELECT (SELECT COUNT(*) FROM `order`) AS orders, ' +
        "(SELECT COUNT(*) FROM `order` WHERE `status` IN ('paid','processing','sent','delivered')) AS sold, " +
        "(SELECT COALESCE(SUM(`total_price`), 0) FROM `order` WHERE `status` IN ('paid','processing','sent','delivered')) AS gross, " +
        '(SELECT COUNT(*) FROM `return_requests`) AS returns, ' +
        '(SELECT COUNT(*) FROM `tickets` WHERE `replyToId` IS NULL) AS tickets',
    );
    console.log('Mock trading ready (last 90 days):');
    console.log(`  admin     ${admin.mobile} / ${DEMO_PASSWORD}`);
    console.log(
      `  customers ${customers.length} (${customers.filter((row) => row.garage).length} garages); demo logins ${demoMobiles.join('، ')} / ${DEMO_PASSWORD}`,
    );
    console.log(
      `  ${counts.orders} orders, ${counts.sold} sold, ${Number(counts.gross).toLocaleString('en-US')} toman gross`,
    );
    console.log(
      `  ${counts.returns} returns (${refundedTotal.toLocaleString('en-US')} toman refunded), ${reviewCount} reviews, ${counts.tickets} tickets`,
    );
    console.log(
      `  ${customers.filter((row) => row.wallet).length} wallets, 5 discount codes`,
    );
  } finally {
    await app.close();
  }
}

seed().catch((error) => {
  logger.error(error);
  process.exit(1);
});
