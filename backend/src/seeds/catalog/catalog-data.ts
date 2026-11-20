// The shop's catalogue: what seed-catalog writes and seed-mock sells.
//
// Bearings: the IBTICO price list (59 rows, in its own order and wording).
// The list's prices are in rials; here they are tomans, the unit the shop
// stores. Rows 1-30 came without a price column and are priced at the same
// level from the market. Belts: the Dayco belts in the shop's photos, by the
// part number printed on each.
//
// Pictures are files in ./images. Where the shop has no photo of a part
// itself, it shows a photo of the same kind of part (a tapered roller set
// for a tapered roller bearing, and so on), never an unrelated one.

export type CarKey =
  | 'pride'
  | 'tiba'
  | 'peugeot-405'
  | 'peugeot-206'
  | 'peykan'
  | 'nissan'
  | 'l90';

export const CARS: Array<{ key: CarKey; title: string }> = [
  { key: 'pride', title: 'پراید' },
  { key: 'tiba', title: 'تیبا، ساینا و کوییک' },
  { key: 'peugeot-405', title: 'پژو ۴۰۵، پارس و سمند' },
  { key: 'peugeot-206', title: 'پژو ۲۰۶' },
  { key: 'peykan', title: 'پیکان و وانت آریسان' },
  { key: 'nissan', title: 'نیسان وانت' },
  { key: 'l90', title: 'رنو ال ۹۰ و ساندرو' },
];

export interface CategoryNode {
  slug: string;
  title: string;
  children: Array<{ slug: string; title: string }>;
}

// Bearings keep the price list's own sections. The car tree is a second way
// in: a product sits in its part category and in every car it fits.
export const CATEGORY_TREE: CategoryNode[] = [
  {
    slug: 'bearings',
    title: 'بلبرینگ',
    children: [
      { slug: 'wheel-bearings', title: 'بلبرینگ چرخ و توپی' },
      { slug: 'axle-bearings', title: 'بلبرینگ اکسل (ژامبون)' },
      { slug: 'timing-idler-bearings', title: 'بلبرینگ تایم و هرزگرد' },
      { slug: 'clutch-bearings', title: 'بلبرینگ کلاچ' },
      { slug: 'gearbox-bearings', title: 'بلبرینگ گیربکس' },
      { slug: 'driveshaft-6000-bearings', title: 'بلبرینگ پلوس و سری ۶۰۰۰' },
      { slug: 'other-bearings', title: 'سایر بلبرینگ‌ها' },
    ],
  },
  {
    slug: 'timing-belts',
    title: 'تسمه تایم',
    children: [
      { slug: 'timing-belt-single', title: 'تسمه تایم تکی' },
      { slug: 'timing-belt-kits', title: 'کیت تسمه تایم' },
    ],
  },
  {
    slug: 'by-car',
    title: 'بر اساس خودرو',
    children: CARS.map((car) => ({ slug: `car-${car.key}`, title: car.title })),
  },
];

export const BRANDS: Array<{ slug: string; title: string }> = [
  { slug: 'ibtico', title: 'IBTICO (ابتکو)' },
  { slug: 'dayco', title: 'Dayco (دایکو)' },
  { slug: 'zpz', title: 'ZPZ' },
];

export type PartKind =
  | 'wheel-ball'
  | 'wheel-roller'
  | 'hub'
  | 'axle'
  | 'needle'
  | 'tensioner'
  | 'idler'
  | 'clutch'
  | 'gearbox-roller'
  | 'gearbox-ball'
  | 'ball'
  | 'belt'
  | 'belt-kit';

export interface CatalogProduct {
  slug: string;
  // The price list's row, for bearings.
  row?: number;
  partNumber: string;
  title: string;
  category: string;
  kind: PartKind;
  brand: 'ibtico' | 'dayco' | 'zpz';
  origin: 'ایران - تبریز' | 'ایتالیا';
  cars: CarKey[];
  // How many come in one carton, from the price list.
  perCarton?: number;
  price: number;
  // Off for a while, to show sale prices on the storefront.
  salePercent?: number;
  images: string[];
  weightGrams: number;
  // Belts only.
  teeth?: number;
  widthMm?: number;
  // A note the description adds (a roll of ten, an ABS ring...).
  note?: string;
}

// Short-hands for the table below.
const I = 'ibtico' as const;
const TABRIZ = 'ایران - تبریز' as const;

const bearing = (
  row: number,
  partNumber: string,
  title: string,
  category: string,
  kind: PartKind,
  cars: CarKey[],
  perCarton: number,
  price: number,
  images: string[],
  weightGrams: number,
  extra: Partial<CatalogProduct> = {},
): CatalogProduct => ({
  slug: partNumber
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  row,
  partNumber,
  title: `${title} ${partNumber}`,
  category,
  kind,
  brand: I,
  origin: TABRIZ,
  cars,
  perCarton,
  price,
  images,
  weightGrams,
  ...extra,
});

// One line per row, like the price list it comes from.
// prettier-ignore
export const BEARINGS: CatalogProduct[] = [
  // ---------- بلبرینگ‌های چرخ ----------
  bearing(1, 'DAC35650035 ZZ', 'بلبرینگ یک تکه چرخ جلو پراید و تیبا', 'wheel-bearings', 'wheel-ball', ['pride', 'tiba'], 48, 720_000, ['dac-206'], 420),
  bearing(2, 'DAC42820036 ZZ', 'بلبرینگ چرخ جلو پژو 405، سمند، پرشیا، زانتیا', 'wheel-bearings', 'wheel-ball', ['peugeot-405'], 27, 980_000, ['dac-405', 'box-ibtico'], 780, { salePercent: 8 }),
  bearing(3, 'DAC377233 ZZ', 'بلبرینگ چرخ جلو 206 تیپ 2و3، کوییک، ساینا', 'wheel-bearings', 'wheel-ball', ['peugeot-206', 'tiba'], 42, 860_000, ['dac-206', 'box-ibtico'], 520),
  bearing(4, 'DU255237', 'بلبرینگ چرخ عقب 206 تیپ 2و3', 'wheel-bearings', 'wheel-ball', ['peugeot-206'], 76, 520_000, ['wheel-du255237', 'box-du255237'], 300),
  bearing(5, '11949/10 + 44649/10', 'کیت چرخ عقب پراید و جلو پیکان', 'wheel-bearings', 'wheel-roller', ['pride', 'peykan'], 75, 390_000, ['tapered-kit-a'], 260, { note: 'دو رولبرینگ مخروطی، یک جفت کامل برای یک چرخ.' }),
  bearing(6, '11749/10 + 44649/10', 'کیت چرخ عقب پراید (قدیم)', 'wheel-bearings', 'wheel-roller', ['pride'], 75, 360_000, ['tapered-kit-b'], 250, { note: 'دو رولبرینگ مخروطی، یک جفت کامل برای یک چرخ.' }),
  bearing(7, '1252 L P6', 'رولبرینگ چرخ عقب نیسان جدید (بزرگ)', 'wheel-bearings', 'wheel-roller', ['nissan'], 26, 1_080_000, ['tapered-kit-a'], 900),
  bearing(8, '12649/10', 'رولبرینگ چرخ جلو نیسان جدید (کوچک)', 'wheel-bearings', 'wheel-roller', ['nissan'], 140, 290_000, ['tapered-kit-b'], 150),
  bearing(9, '13687/21 P6', 'رولبرینگ چرخ جلو نیسان دیزل (بزرگ)', 'wheel-bearings', 'wheel-roller', ['nissan'], 84, 610_000, ['tapered-kit-a'], 420),
  bearing(10, '32011 P6', 'رولبرینگ چرخ عقب نیسان جدید (کوچک)', 'wheel-bearings', 'wheel-roller', ['nissan'], 28, 570_000, ['tapered-kit-b'], 640),
  bearing(11, '33205 P6', 'رولبرینگ چرخ جلو نیسان دیزل (کوچک)', 'wheel-bearings', 'wheel-roller', ['nissan'], 100, 660_000, ['tapered-kit-a'], 380),
  bearing(12, '411280', 'بلبرینگ چرخ عقب پیکان', 'wheel-bearings', 'wheel-ball', ['peykan'], 51, 460_000, ['dac-206'], 520),
  bearing(13, '48548/10', 'رولبرینگ چرخ جلو نیسان جدید (بزرگ)', 'wheel-bearings', 'wheel-roller', ['nissan'], 98, 580_000, ['tapered-kit-b'], 450),
  bearing(14, 'JL69349/10', 'بلبرینگ چرخ جلو پراید (قدیم)', 'wheel-bearings', 'wheel-roller', ['pride'], 68, 340_000, ['tapered-kit-a'], 280),
  bearing(15, 'GB12807 ABSM', 'بلبرینگ چرخ جلو ال 90 مگنت‌دار', 'wheel-bearings', 'hub', ['l90'], 36, 1_240_000, ['hub-gb12894-a'], 760, { note: 'رینگ مگنتی ABS روی خود بلبرینگ است.' }),
  bearing(16, 'GB12894 ABS', 'توپی چرخ عقب 405 ABS', 'wheel-bearings', 'hub', ['peugeot-405'], 5, 1_840_000, ['hub-gb12894-a', 'hub-gb12894-b'], 2_300, { note: 'توپی کامل با بلبرینگ و چرخ‌دنده‌ی ABS، آماده‌ی نصب.' }),
  bearing(17, 'GB12894', 'توپی چرخ عقب 405 معمولی', 'wheel-bearings', 'hub', ['peugeot-405'], 5, 1_610_000, ['hub-gb12894-b'], 2_200, { note: 'توپی کامل با بلبرینگ، برای خودروهای بدون ABS.' }),
  bearing(18, 'VAKA3659 ABSM', 'توپی چرخ عقب ABS 206 مگنت‌دار', 'wheel-bearings', 'hub', ['peugeot-206'], 5, 1_760_000, ['hub-gb12894-b', 'hub-gb12894-a'], 2_000, { salePercent: 10, note: 'توپی کامل با رینگ مگنتی ABS.' }),

  // ---------- بلبرینگ‌های اکسل ----------
  bearing(19, 'DBF68933+NE68934', 'ژامبون 405', 'axle-bearings', 'axle', ['peugeot-405'], 27, 390_000, ['box-dbf68933', 'tapered-kit-a'], 330, { note: 'جفت بلبرینگ کوچک و بزرگ اکسل عقب.' }),
  bearing(20, 'DB70216+NE70214', 'ژامبون 206', 'axle-bearings', 'axle', ['peugeot-206'], 27, 360_000, ['tapered-kit-b', 'box-ibtico'], 300, { note: 'جفت بلبرینگ کوچک و بزرگ اکسل عقب.' }),
  bearing(21, 'HK 5025', 'ژامبون تقویتی 405', 'axle-bearings', 'needle', ['peugeot-405'], 80, 195_000, ['needle-hk5025'], 90),

  // ---------- بلبرینگ‌های تایم و هرزگرد ----------
  bearing(22, 'VKM74200', 'بلبرینگ تسمه تایم پراید', 'timing-idler-bearings', 'tensioner', ['pride', 'tiba'], 80, 520_000, ['tensioner-vkm74200', 'box-vkm74200'], 260),
  bearing(23, 'VKM13100', 'بلبرینگ تسمه تایم پژو 405', 'timing-idler-bearings', 'tensioner', ['peugeot-405'], 80, 590_000, ['tensioner-vkm13100', 'box-vkm13100'], 310, { salePercent: 6 }),
  bearing(24, 'VKML 90', 'تسمه تایم ال 90 (متحرک)', 'timing-idler-bearings', 'tensioner', ['l90'], 24, 940_000, ['tensioner-vkm13100'], 380, { note: 'بلبرینگ سفت‌کن متحرک تسمه تایم.' }),
  bearing(25, 'KGX 405', 'هرزگرد 405', 'timing-idler-bearings', 'idler', ['peugeot-405'], 30, 480_000, ['tensioner-vkm74200'], 280),
  bearing(26, 'PEG206/10', 'هرزگرد سوراخ کوچک ۲۰۶ (پایین)', 'timing-idler-bearings', 'idler', ['peugeot-206'], 60, 315_000, ['tensioner-vkm74200'], 210),
  bearing(27, 'PEG206/17', 'هرزگرد سوراخ بزرگ ۲۰۶ (بالا)', 'timing-idler-bearings', 'idler', ['peugeot-206'], 80, 340_000, ['tensioner-vkm13100'], 230),

  // ---------- بلبرینگ‌های کلاچ ----------
  bearing(28, 'VKC2216', 'بلبرینگ کلاچ پژو (تخت)', 'clutch-bearings', 'clutch', ['peugeot-405', 'peugeot-206'], 60, 360_000, ['box-ibtico'], 240),
  bearing(29, 'VKC2516', 'بلبرینگ کلاچ پژو (تخم مرغی)', 'clutch-bearings', 'clutch', ['peugeot-405'], 60, 390_000, ['box-ibtico'], 250),
  bearing(30, 'VKC3609', 'بلبرینگ کلاچ پراید (تخت)', 'clutch-bearings', 'clutch', ['pride', 'tiba'], 60, 320_000, ['box-ibtico'], 220),

  // ---------- بلبرینگ‌های گیربکس ----------
  bearing(31, '32005 TN', 'رولبرینگ شفت گیربکس اولیه 405', 'gearbox-bearings', 'gearbox-roller', ['peugeot-405'], 200, 399_000, ['tapered-kit-b'], 160),
  bearing(32, '32007', 'رولبرینگ هوزینگ تیبا', 'gearbox-bearings', 'gearbox-roller', ['tiba'], 98, 524_000, ['tapered-kit-a'], 290),
  bearing(33, '32204', 'رولبرینگ ته شفت گیربکس پراید', 'gearbox-bearings', 'gearbox-roller', ['pride'], 175, 340_000, ['tapered-kit-b'], 150),
  bearing(34, '501349/10', 'رولبرینگ هوزینگ پیکان', 'gearbox-bearings', 'gearbox-roller', ['peykan'], 84, 585_000, ['tapered-kit-a'], 300),
  bearing(35, '578225', 'رولبرینگ شفت گیربکس فابریک', 'gearbox-bearings', 'gearbox-roller', ['peugeot-405'], 175, 381_000, ['tapered-kit-b'], 170),
  bearing(36, '62/22 2RS C3', 'بلبرینگ گیربکس شفت بالا پراید', 'gearbox-bearings', 'gearbox-ball', ['pride'], 160, 297_000, ['ball-6006-2rs', 'box-ibtico'], 120),
  bearing(37, '63/22 2RS C3 TN', 'بلبرینگ گیربکس شفت بالا تیبا', 'gearbox-bearings', 'gearbox-ball', ['tiba'], 140, 394_000, ['ball-6006-2rs', 'box-ibtico'], 160),
  bearing(38, 'L68149/10', 'رولبرینگ هوزینگ پراید', 'gearbox-bearings', 'gearbox-roller', ['pride'], 92, 367_000, ['tapered-kit-a'], 180),
  bearing(39, 'A.B41376.YS04', 'بلبرینگ گیربکس ال 90', 'gearbox-bearings', 'gearbox-ball', ['l90'], 100, 864_000, ['box-ibtico', 'ball-6006-2rs'], 340),
  bearing(40, 'N41627H300', 'بلبرینگ گیربکس ساچمه استوانه‌ای 405', 'gearbox-bearings', 'gearbox-roller', ['peugeot-405'], 72, 1_109_000, ['box-ibtico'], 420),
  bearing(41, '402082 RD', 'بلبرینگ کوچک گیربکس پیکان', 'gearbox-bearings', 'gearbox-ball', ['peykan'], 78, 517_000, ['ball-6006-2rs'], 200),

  // ---------- بلبرینگ‌های پلوس و سری ۶۰۰۰ ----------
  bearing(42, '6003 2RS C3', 'بلبرینگ کوچک دینام 405 و 206 (رول ۱۰ تایی)', 'driveshaft-6000-bearings', 'ball', ['peugeot-405', 'peugeot-206'], 550, 114_000, ['ball-6006-2rs'], 40, { slug: '6003-2rs-c3-roll', note: 'در رول‌های ۱۰ تایی بسته‌بندی شده؛ قیمت برای یک عدد است.' }),
  bearing(43, '6003 2RS C3', 'بلبرینگ کوچک دینام 405 و 206 (تک جعبه)', 'driveshaft-6000-bearings', 'ball', ['peugeot-405', 'peugeot-206'], 336, 114_000, ['box-ibtico', 'ball-6006-2rs'], 45, { slug: '6003-2rs-c3-box', note: 'هر عدد در جعبه‌ی جدا.' }),
  bearing(44, '6006 2RS', 'بلبرینگ پلوس 405 و 206', 'driveshaft-6000-bearings', 'ball', ['peugeot-405', 'peugeot-206'], 192, 149_000, ['ball-6006-2rs'], 115, { brand: 'zpz' }),
  bearing(45, '6006 2RS C3', 'بلبرینگ پلوس 405 و 206 دوربالا', 'driveshaft-6000-bearings', 'ball', ['peugeot-405', 'peugeot-206'], 180, 196_000, ['box-6006-2rs-c3', 'ball-6006-2rs'], 115),
  bearing(46, '6006 2RS C3 KN', 'بلبرینگ پلوس 405 و 206 (شیاردار)', 'driveshaft-6000-bearings', 'ball', ['peugeot-405', 'peugeot-206'], 192, 221_000, ['ball-6006-2rs', 'box-6006-2rs-c3'], 118),
  bearing(47, '6202/16 2RS', 'بلبرینگ کولر آبی داخل ۱۶ (رول ۱۰ تایی)', 'driveshaft-6000-bearings', 'ball', [], 500, 127_000, ['ball-6006-2rs'], 40, { note: 'در رول‌های ۱۰ تایی بسته‌بندی شده؛ قیمت برای یک عدد است.' }),
  bearing(48, '6202 2RS C3', 'بلبرینگ دینام دوربالا', 'driveshaft-6000-bearings', 'ball', [], 336, 108_000, ['box-ibtico', 'ball-6006-2rs'], 40),
  bearing(49, '6203 2RS C3 TN', 'بلبرینگ دینام دوربالا (ساچمه‌گیر فیبری)', 'driveshaft-6000-bearings', 'ball', [], 240, 135_000, ['ball-6006-2rs'], 65),
  bearing(50, '6203 2RS C3 H14 KN', 'بلبرینگ دینام دوربالا ارتفاع ۱۴ (شیاردار)', 'driveshaft-6000-bearings', 'ball', [], 320, 160_000, ['ball-6006-2rs', 'box-ibtico'], 70),
  bearing(51, '6208 C4', 'بلبرینگ بزرگ گیربکس پیکان', 'driveshaft-6000-bearings', 'ball', ['peykan'], 72, 517_000, ['box-ibtico'], 370),
  bearing(52, '6303 2RS C3', 'بلبرینگ دینام پژو 405 و 206 دوربالا', 'driveshaft-6000-bearings', 'ball', ['peugeot-405', 'peugeot-206'], 160, 225_000, ['ball-6006-2rs'], 115),
  bearing(53, '6304 2RS C3', 'بلبرینگ شفت پایین گیربکس پراید', 'driveshaft-6000-bearings', 'ball', ['pride'], 160, 245_000, ['box-ibtico'], 140),
  bearing(54, '6305 2RS C3', 'بلبرینگ بزرگ گیربکس 206', 'driveshaft-6000-bearings', 'ball', ['peugeot-206'], 92, 367_000, ['box-ibtico', 'ball-6006-2rs'], 230),
  bearing(55, '6306 2RS C3', 'بلبرینگ گیربکس نیسان', 'driveshaft-6000-bearings', 'ball', ['nissan'], 72, 510_000, ['ball-6006-2rs'], 350),
  // In the shop's photos, not on the price list.
  bearing(0, '6308 2RS', 'بلبرینگ شیاردار دوطرف لاستیکی', 'driveshaft-6000-bearings', 'ball', [], 48, 690_000, ['box-6308-2rs'], 630, { row: undefined }),

  // ---------- سایر بلبرینگ‌ها ----------
  bearing(56, '35BD219', 'بلبرینگ کولر 405 و 206 و پارس و آردی', 'other-bearings', 'wheel-ball', ['peugeot-405', 'peugeot-206'], 74, 633_000, ['dac-405'], 170),
  bearing(57, '35BD5220', 'بلبرینگ کولر 206 تیپ 5', 'other-bearings', 'wheel-ball', ['peugeot-206'], 74, 633_000, ['dac-206'], 170),
  bearing(58, 'B8-23D', 'بلبرینگ دوبل دینام پراید', 'other-bearings', 'ball', ['pride'], 560, 209_000, ['ball-6006-2rs'], 45),
  bearing(59, 'GT309-B10', 'بلبرینگ هرزگرد 206 سوراخ کوچک فابریکی', 'other-bearings', 'idler', ['peugeot-206'], 210, 564_000, ['tensioner-vkm74200'], 240),
];

const belt = (
  partNumber: string,
  title: string,
  cars: CarKey[],
  price: number,
  images: string[],
  extra: Partial<CatalogProduct> = {},
): CatalogProduct => ({
  slug: `dayco-${partNumber.toLowerCase()}`,
  partNumber,
  title: `${title} دایکو ${partNumber}`,
  category: 'timing-belt-single',
  kind: 'belt',
  brand: 'dayco',
  origin: 'ایتالیا',
  cars,
  price,
  images,
  weightGrams: 180,
  ...extra,
});

// One line per row, like the price list it comes from.
// prettier-ignore
export const BELTS: CatalogProduct[] = [
  belt('94324', 'تسمه تایم پراید و تیبا', ['pride', 'tiba'], 960_000, ['belt-94324-a', 'belt-94324-b']),
  belt('94187', 'تسمه تایم پژو 405، پارس و سمند (موتور XU7)', ['peugeot-405'], 1_240_000, ['belt-94187', 'poster-dayco-xu7'], { teeth: 114, widthMm: 17, salePercent: 7 }),
  belt('94862', 'تسمه تایم پژو 206 تیپ 2 و 3 (موتور TU3)', ['peugeot-206'], 1_040_000, ['belt-94862'], { teeth: 104, widthMm: 17 }),
  belt('94997', 'تسمه تایم پژو 206 تیپ 5، رانا و پارس (موتور TU5)', ['peugeot-206', 'peugeot-405'], 1_420_000, ['belt-94997'], { teeth: 132, widthMm: 27 }),
  belt('94741', 'تسمه تایم رنو ال 90 و ساندرو', ['l90'], 1_760_000, ['belt-94741-a', 'belt-94741-b'], { teeth: 127, widthMm: 25.4 }),
  belt('94327', 'تسمه تایم کوییک و ساینا', ['tiba'], 990_000, ['belt-94327-a', 'belt-94327-b']),
  belt('94224', 'تسمه تایم سمند و دنا (موتور EF7)', ['peugeot-405'], 1_990_000, ['belt-94224']),
  belt('94657', 'تسمه تایم سیتروئن زانتیا ۲۰۰۰', [], 1_840_000, ['belt-94657']),
  {
    slug: 'kit-pride-dayco-94324-vkm74200',
    partNumber: '94324 + VKM74200',
    title: 'کیت تسمه تایم پراید (تسمه دایکو 94324 + بلبرینگ VKM74200)',
    category: 'timing-belt-kits',
    kind: 'belt-kit',
    brand: 'dayco',
    origin: 'ایتالیا',
    cars: ['pride', 'tiba'],
    price: 1_400_000,
    images: ['belt-94324-b', 'tensioner-vkm74200'],
    weightGrams: 440,
    note: 'تسمه تایم دایکو و بلبرینگ سفت‌کن IBTICO در یک بسته؛ هر دو را با هم عوض کنید.',
  },
  {
    slug: 'kit-405-dayco-94187-vkm13100',
    partNumber: '94187 + VKM13100',
    title: 'کیت تسمه تایم پژو 405 و سمند XU7 (تسمه دایکو 94187 + بلبرینگ VKM13100)',
    category: 'timing-belt-kits',
    kind: 'belt-kit',
    brand: 'dayco',
    origin: 'ایتالیا',
    cars: ['peugeot-405'],
    price: 1_740_000,
    images: ['poster-dayco-xu7', 'tensioner-vkm13100'],
    weightGrams: 490,
    salePercent: 5,
    note: 'تسمه تایم دایکو و بلبرینگ سفت‌کن IBTICO در یک بسته؛ هر دو را با هم عوض کنید.',
  },
];

export const CATALOGUE: CatalogProduct[] = [...BEARINGS, ...BELTS];

const KIND_TEXT: Record<PartKind, string> = {
  'wheel-ball':
    'بلبرینگ ساچمه‌ای دوردیفه با کاسه‌نمد دوطرفه، برای بار شعاعی و محوری چرخ.',
  'wheel-roller':
    'رولبرینگ مخروطی برای بار سنگین چرخ؛ با گریس مناسب و تنظیم درست، عمر طولانی دارد.',
  hub: 'توپی چرخ با بلبرینگ پرس‌شده؛ بدون نیاز به پرس کاری، مستقیم روی سگدست بسته می‌شود.',
  axle: 'بلبرینگ اکسل عقب (ژامبون)؛ صدای غژغژ و لقی چرخ عقب معمولاً از همین قطعه است.',
  needle: 'بلبرینگ سوزنی تقویتی اکسل عقب، همراه با رینگ.',
  tensioner: 'بلبرینگ سفت‌کن تسمه تایم؛ هم‌زمان با تعویض تسمه عوض شود.',
  idler:
    'بلبرینگ هرزگرد تسمه؛ صدای سوت یا جیرجیر موتور در دور آرام نشانه‌ی خرابی آن است.',
  clutch:
    'بلبرینگ کلاچ؛ صدای ویز هنگام گرفتن پدال کلاچ نشانه‌ی فرسودگی آن است.',
  'gearbox-roller':
    'رولبرینگ گیربکس با تلرانس دقیق، برای کار بی‌صدا و بی‌لقی شفت.',
  'gearbox-ball':
    'بلبرینگ ساچمه‌ای گیربکس با تلرانس C3 برای دمای کاری بالای گیربکس.',
  ball: 'بلبرینگ شیاردار ساچمه‌ای با کاسه‌نمد لاستیکی دوطرفه (2RS)، پر از گریس و آماده‌ی نصب.',
  belt: 'تسمه تایم با دندانه‌های قالبی و الیاف تقویتی، برای هماهنگی دقیق میل‌لنگ و میل‌سوپاپ.',
  'belt-kit': 'کیت تعویض کامل تسمه تایم.',
};

// One description, written from the data. The product page shows the part
// number, origin and fitment as specs, so the text is about the part
// itself. The column holds 255 characters: lines are dropped from the end
// until it fits.
export const DESCRIPTION_MAX = 255;

export function describe(product: CatalogProduct): string {
  const fits = product.cars
    .map((key) => CARS.find((car) => car.key === key)?.title)
    .filter(Boolean)
    .join('، ');
  const lines = [
    KIND_TEXT[product.kind],
    product.note,
    fits ? `مناسب ${fits}.` : null,
    product.kind === 'belt' || product.kind === 'belt-kit'
      ? 'تعویض هر ۶۰٬۰۰۰ کیلومتر.'
      : 'پیش از سفارش شماره فنی را با قطعه‌ی قدیمی مقایسه کنید.',
  ].filter((line): line is string => !!line);
  while (lines.length > 1 && lines.join('\n\n').length > DESCRIPTION_MAX) {
    lines.pop();
  }
  return lines.join('\n\n').slice(0, DESCRIPTION_MAX);
}
