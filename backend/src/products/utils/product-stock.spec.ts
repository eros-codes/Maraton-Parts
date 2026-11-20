import { restoreStock, toStockLines } from './product-stock';
import { Product } from '../entities/product.entity';

describe('restoreStock', () => {
  // Checkout locks product rows in ascending id order. Giving stock back in
  // any other order let a cancellation and a checkout deadlock.
  it('locks the products in id order, then gives each its units back once', async () => {
    const calls: string[] = [];
    const products = {
      increment: jest.fn(
        (where: { id: number }, _column: string, by: number) => {
          calls.push(`increment ${where.id} by ${by}`);
          return Promise.resolve();
        },
      ),
    };
    const manager = {
      getRepository: jest.fn(() => products),
      find: jest.fn((entity: unknown) => {
        calls.push(entity === Product ? 'lock-products' : 'other');
        return Promise.resolve([]);
      }),
    };

    const productIds = await restoreStock(manager as never, [
      { productId: 4, quantity: 1 },
      { productId: 3, quantity: 2 },
      { productId: 4, quantity: 2 },
    ]);

    expect(productIds).toEqual([3, 4]);
    expect(calls).toEqual([
      'lock-products',
      'increment 3 by 2',
      'increment 4 by 3',
    ]);
    expect(manager.find).toHaveBeenCalledWith(
      Product,
      expect.objectContaining({
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
        withDeleted: true,
      }),
    );
  });

  it('does nothing for an empty list', async () => {
    const manager = { getRepository: jest.fn(), find: jest.fn() };

    await expect(restoreStock(manager as never, [])).resolves.toEqual([]);
    expect(manager.find).not.toHaveBeenCalled();
  });

  it('ignores lines with nothing to give back', async () => {
    const manager = { getRepository: jest.fn(), find: jest.fn() };

    await expect(
      restoreStock(manager as never, [{ productId: 3, quantity: 0 }]),
    ).resolves.toEqual([]);
    expect(manager.find).not.toHaveBeenCalled();
  });
});

describe('toStockLines', () => {
  it('turns order lines into product/quantity pairs, skipping lines without a product', () => {
    expect(
      toStockLines([
        { product: { id: 7 }, quantity: 2 },
        { product: null, quantity: 1 },
      ]),
    ).toEqual([{ productId: 7, quantity: 2 }]);
  });
});
