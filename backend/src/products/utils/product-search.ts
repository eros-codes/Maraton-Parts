// How a shopper's search becomes conditions on the catalogue.
//
// Every word is matched on its own - in the title, in a spec (part number,
// "suitable for", origin...) or in the name of one of the product's
// categories - and every word is required: "پژو ۲۰۶" finds the 206 parts,
// not everything Peugeot. The catalogue of a parts shop is small enough for
// LIKE to scan, so there is no full-text index involved.

export const MAX_SEARCH_TERMS = 8;

export interface ProductSearchPlan {
  // One entry per word: the LIKE patterns it may be stored as.
  terms: string[][];
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// The shop's text mixes both kinds of digits - titles say "206", the car
// categories say "۲۰۶" - and a Persian keyboard types the second. A search
// is read with Latin digits and Persian letters (ی and ک, whichever
// keyboard typed them).
export function normalizeSearchText(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک');
}

// A word as it may be stored: as typed, and with Persian digits.
export function termVariants(term: string): string[] {
  const persian = term.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[+digit]);
  return persian === term ? [term] : [term, persian];
}

export function buildProductSearchPlan(
  search: string,
): ProductSearchPlan | null {
  const terms = [
    ...new Set(
      normalizeSearchText(search)
        .toLowerCase()
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter((term) => term.length > 0),
    ),
  ].slice(0, MAX_SEARCH_TERMS);

  if (terms.length === 0) {
    return null;
  }

  return {
    terms: terms.map((term) =>
      termVariants(term).map((form) => `%${escapeLikePattern(form)}%`),
    ),
  };
}
