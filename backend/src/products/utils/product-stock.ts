import { EntityManager, In } from 'typeorm';
import { Product } from '../entities/product.entity';

export interface StockLine {
  productId: number;
  quantity: number;
}

export function toStockLines(
  items: Array<{ product?: { id: number } | null; quantity: number }> = [],
): StockLine[] {
  return items
    .filter((item) => !!item.product)
    .map((item) => ({ productId: item.product!.id, quantity: item.quantity }));
}

// Gives units back to their products: an atomic UPDATE ... stock = stock + n,
// taken in ascending id order - the order checkout locks product rows in, so
// a cancellation and a checkout of the same products cannot deadlock.
// Read-modify-write here would silently lose a concurrent decrement.
// Returns the product ids touched.
export async function restoreStock(
  manager: EntityManager,
  lines: StockLine[],
): Promise<number[]> {
  const totals = new Map<number, number>();
  for (const { productId, quantity } of lines) {
    if (!productId || !(quantity > 0)) {
      continue;
    }
    totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  }
  if (totals.size === 0) {
    return [];
  }

  const productIds = [...totals.keys()].sort((a, b) => a - b);
  await manager.find(Product, {
    select: { id: true },
    where: { id: In(productIds) },
    withDeleted: true,
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });

  const products = manager.getRepository(Product);
  for (const productId of productIds) {
    await products.increment(
      { id: productId },
      'stock',
      totals.get(productId)!,
    );
  }
  return productIds;
}
