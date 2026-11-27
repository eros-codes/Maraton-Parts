import {
  buildProductSearchPlan,
  escapeLikePattern,
  normalizeSearchText,
} from './product-search';

describe('buildProductSearchPlan', () => {
  it('makes every word its own required match', () => {
    expect(buildProductSearchPlan('بلبرینگ چرخ')).toEqual({
      terms: [['%بلبرینگ%'], ['%چرخ%']],
    });
  });

  it('looks for a number with Latin and with Persian digits, however it was typed', () => {
    const both = { terms: [['%پژو%'], ['%206%', '%۲۰۶%']] };
    expect(buildProductSearchPlan('پژو ۲۰۶')).toEqual(both);
    expect(buildProductSearchPlan('پژو 206')).toEqual(both);
    expect(buildProductSearchPlan('پژو ٢٠٦')).toEqual(both);
  });

  it('keeps a part number whole and in lower case', () => {
    expect(buildProductSearchPlan('VKC2216')).toEqual({
      terms: [['%vkc2216%', '%vkc۲۲۱۶%']],
    });
  });

  it('drops punctuation and repeated words', () => {
    expect(buildProductSearchPlan('+تسمه -"تسمه"* @A5')).toEqual({
      terms: [['%تسمه%'], ['%a5%', '%a۵%']],
    });
  });

  it('returns null when nothing searchable is left', () => {
    expect(buildProductSearchPlan('+-*"()~@')).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLikePattern('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('normalizeSearchText', () => {
  it('reads Arabic letters as Persian', () => {
    expect(normalizeSearchText('بلبرينگ كلاچ')).toBe('بلبرینگ کلاچ');
  });
});
