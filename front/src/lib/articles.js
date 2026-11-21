// The shop's articles: fixed PDFs, so they live with the storefront rather
// than in the API. To add or swap one, put the PDF in public/articles/ and
// list it here; the order here is the order on the page.
//
//   file      the PDF's name in public/articles/
//   title     shown on the card
//   summary   one or two lines under the title (optional)
export const ARTICLES = [
  {
    file: 'wheel-bearing-failure.pdf',
    title: 'راهنمای تشخیص خرابی بلبرینگ چرخ',
    summary: 'از صدای وزوز در سرعت بالا تا لقی چرخ؛ چطور بفهمیم کدام بلبرینگ خراب است.',
  },
  {
    file: 'timing-belt-interval.pdf',
    title: 'تسمه تایم را کی عوض کنیم؟',
    summary: 'دوره‌ی تعویض، نشانه‌های فرسودگی و انتخاب تسمه‌ی درست برای موتور.',
  },
  {
    file: 'belt-and-tensioner-together.pdf',
    title: 'چرا تسمه و بلبرینگ سفت‌کن را با هم عوض کنیم؟',
    summary: 'یک دستمزد برای دو قطعه، و تسمه‌ای که زودتر از موعد پاره نمی‌شود.',
  },
  {
    file: 'reading-bearing-codes.pdf',
    title: 'شماره فنی بلبرینگ را چطور بخوانیم؟',
    summary: '2RS، ZZ و C3 یعنی چه و اندازه‌ها از کجای شماره خوانده می‌شوند.',
  },
  {
    file: 'ball-vs-roller.pdf',
    title: 'بلبرینگ ساچمه‌ای یا رولبرینگ مخروطی؟',
    summary: 'تفاوت دو نوع اصلی و اینکه هر کدام در کجای خودرو به کار می‌رود.',
  },
  {
    file: 'bearing-installation-mistakes.pdf',
    title: 'اشتباهات رایج در نصب بلبرینگ',
    summary: 'ضربه‌ی چکش، گشتاور مهره و جهت حلقه‌ی ABS؛ چیزهایی که بلبرینگ نو را خراب می‌کند.',
  },
];
