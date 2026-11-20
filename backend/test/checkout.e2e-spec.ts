import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { assertDisposableTestDatabase } from './assert-test-database';
import { bootApp, createAccount, idempotencyKey } from './shop-helpers';
import userRoleEnum from '../src/users/enums/userRoleEnum';

assertDisposableTestDatabase();

// The whole sale, end to end, against a real database: a product, a
// shipping method that prices by weight, tax, a discount code, and the
// wallet paying for all of it - then cancelling and getting every part of
// it back.
describe('Checkout (e2e)', () => {
  let app: INestApplication;
  let admin: { token: string };
  let customer: { id: number; token: string; addressId?: number };
  let productId: number;
  let soldOutId: number;
  let shippingMethodId: number;
  const run = Date.now();

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await bootApp();
    admin = await createAccount(app, userRoleEnum.AdminUser);
    customer = await createAccount(app, userRoleEnum.NormalUser, {
      walletAmount: 50_000_000,
      withAddress: true,
    });

    // A zone that covers everywhere, so the suite doesn't depend on
    // which province the test address is in.
    const zone = await api()
      .post('/shipping/zones')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ title: `e2e-zone-${run}`, provinces: [], is_default: true });

    const method = await api()
      .post('/shipping/methods')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        title: 'e2e post',
        code: `e2e-post-${run}`,
        estimated_days_min: 2,
        estimated_days_max: 4,
      });
    shippingMethodId = method.body.data.id;

    await api()
      .post(`/shipping/methods/${shippingMethodId}/rates`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        zoneId: zone.body.data.id,
        base_cost: 50_000,
        per_kg_cost: 20_000,
      });

    // Two colours are two products, each with its own stock.
    const product = await api()
      .post('/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        title: `E2E Hoodie black ${run}`,
        description: 'warm',
        price: 500_000,
        stock: 5,
        weight_grams: 1_500,
      });
    productId = product.body.data.id;

    const soldOut = await api()
      .post('/products')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        title: `E2E Hoodie white ${run}`,
        description: 'warm',
        price: 500_000,
        stock: 0,
        weight_grams: 1_500,
      });
    soldOutId = soldOut.body.data.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('quotes shipping for the basket before the order exists', async () => {
    const res = await api()
      .post('/shipping/quote')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        addressId: customer.addressId,
        items: [{ productId, quantity: 1 }],
        goodsTotal: 500_000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe('IRT');
    const option = res.body.data.options.find(
      (o: { methodId: number }) => o.methodId === shippingMethodId,
    );
    // 1.5kg: the base covers the first kilogram, the second started one
    // adds per_kg_cost.
    expect(option.cost).toBe(70_000);
  });

  it('refuses more units than the product has', async () => {
    const res = await api()
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', idempotencyKey('too-many'))
      .send({
        addressId: customer.addressId,
        payWithWallet: true,
        shippingMethodId,
        items: [{ productId, quantity: 6 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.details).toMatchObject({ available: 5, requested: 6 });
  });

  it('refuses a sold-out product, while others still sell', async () => {
    const res = await api()
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', idempotencyKey('sold-out'))
      .send({
        addressId: customer.addressId,
        payWithWallet: true,
        shippingMethodId,
        items: [{ productId: soldOutId, quantity: 1 }],
      });

    expect(res.status).toBe(400);
  });

  it('prices the whole bill, charges the wallet and invoices the sale', async () => {
    const dataSource = app.get(DataSource);
    const before = await dataSource.query(
      'SELECT amount FROM wallets WHERE user_id = ?',
      [customer.id],
    );

    const res = await api()
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', idempotencyKey('paid'))
      .send({
        addressId: customer.addressId,
        payWithWallet: true,
        shippingMethodId,
        items: [{ productId, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    const order = res.body.data;
    const goods = 1_000_000; // 2 x 500,000
    const shipping = 90_000; // 3kg: 50,000 + 2 x 20,000
    const tax = Math.round(
      (goods * Number(process.env.TAX_RATE_PERCENT ?? 10)) / 100,
    );

    expect(order.items_total).toBe(goods);
    expect(order.shipping_cost).toBe(shipping);
    expect(order.tax_amount).toBe(tax);
    expect(order.total_price).toBe(goods + shipping + tax);
    expect(order.status).toBe('paid');
    expect(order.invoice_number).toMatch(/^INV-\d{4}-\d{6}$/);

    const after = await dataSource.query(
      'SELECT amount FROM wallets WHERE user_id = ?',
      [customer.id],
    );
    expect(Number(before[0].amount) - Number(after[0].amount)).toBe(
      goods + shipping + tax,
    );

    // Stock came off the product that was bought, and only that one.
    const stock = await dataSource.query(
      'SELECT id, stock FROM products WHERE id IN (?, ?)',
      [productId, soldOutId],
    );
    const stockOf = (id: number) =>
      Number(stock.find((row: { id: number }) => row.id === id).stock);
    expect(stockOf(productId)).toBe(3);
    expect(stockOf(soldOutId)).toBe(0);
  });

  it('answers a repeated checkout with the same order, not a second one', async () => {
    const key = idempotencyKey('retry');
    const body = {
      addressId: customer.addressId,
      payWithWallet: true,
      shippingMethodId,
      items: [{ productId, quantity: 1 }],
    };

    const first = await api()
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', key)
      .send(body);
    const second = await api()
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('gives back the money, the stock and the discount when an order is cancelled', async () => {
    const dataSource = app.get(DataSource);
    const code = `E2E${run}`;
    await api()
      .post('/discount-codes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ code, capacity: 5, off_percent: 10 });

    const created = await api()
      .post('/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', idempotencyKey('cancel'))
      .send({
        addressId: customer.addressId,
        payWithWallet: true,
        shippingMethodId,
        discountCode: code,
        items: [{ productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.discount_amount).toBe(50_000); // 10% of 500,000

    const walletBefore = await dataSource.query(
      'SELECT amount FROM wallets WHERE user_id = ?',
      [customer.id],
    );
    const stockBefore = await dataSource.query(
      'SELECT stock FROM products WHERE id = ?',
      [productId],
    );

    const cancelled = await api()
      .patch(`/orders/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'cancelled' });
    expect(cancelled.status).toBe(200);

    const walletAfter = await dataSource.query(
      'SELECT amount FROM wallets WHERE user_id = ?',
      [customer.id],
    );
    const stockAfter = await dataSource.query(
      'SELECT stock FROM products WHERE id = ?',
      [productId],
    );
    const capacity = await dataSource.query(
      'SELECT capacity FROM discount_codes WHERE code = ?',
      [code],
    );

    expect(Number(walletAfter[0].amount) - Number(walletBefore[0].amount)).toBe(
      created.body.data.total_price,
    );
    expect(Number(stockAfter[0].stock)).toBe(Number(stockBefore[0].stock) + 1);
    expect(Number(capacity[0].capacity)).toBe(5); // the use came back
  });
});
