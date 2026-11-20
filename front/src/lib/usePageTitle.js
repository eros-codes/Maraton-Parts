import { useEffect } from 'react';

const SHOP = 'ماراتون پارتز';

// Every page used to carry the same <title>, so a phone's tab switcher, the
// history list and a bookmark all said "ماراتون پارتز" for every product. Pass
// nothing (or a falsy title while loading) to keep the shop's own title.
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | ${SHOP}` : `${SHOP} | تسمه تایم و بلبرینگ`;
  }, [title]);
}
