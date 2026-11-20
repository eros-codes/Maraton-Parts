import { EntityManager, In } from 'typeorm';
import { Product } from '../entities/product.entity';
import { BasketItem } from '../../users/entities/basket-item.entity';

// Retiring a product soft-deletes it (the row stays for order history) and
// takes it out of every basket, where it could no longer be bought.
export async function softDeleteProducts(
  manager: EntityManager,
  productIds: number[],
): Promise<void> {
  const ids = [...new Set(productIds)].filter((id) => !!id);
  if (ids.length === 0) return;

  await manager.softDelete(Product, { id: In(ids) });
  await manager
    .createQueryBuilder()
    .delete()
    .from(BasketItem)
    .where('productId IN (:...ids)', { ids })
    .execute();
}
