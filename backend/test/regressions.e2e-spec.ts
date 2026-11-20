import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { assertDisposableTestDatabase } from './assert-test-database';
import {
  PASSWORD,
  bootApp,
  createAccount,
  idempotencyKey,
} from './shop-helpers';
import userRoleEnum from '../src/users/enums/userRoleEnum';

assertDisposableTestDatabase();

// Each test here pins down one defect that was found by exercising the
// running shop, not by reading it. Most of them passed every unit test at
// the time: they only show up with a real database, real concurrency or a
// real token. If one of these starts failing, read the comment above it
// before "fixing" the test.
describe('Regressions (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: { token: string };
  let customer: { id: number; token: string; addressId?: number };
  let shippingMethodId: number;
  const run = Date.now();

  const api = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${admin.token}`);
  const asCustomer = (req: request.Test) =>
    req.set('Authorization', `Bearer ${customer.token}`);

  const stockOf = async (productId: number): Promise<number> => {
    const [row] = await dataSource.query(
      'SELECT stock FROM products WHERE id = ?',
      [productId],
    );
    return Number(row.stock);
  };

  const productWithStock = async (stock: number) => {
    const res = await asAdmin(api().post('/products')).send({
      title: `E2E regression ${run}-${Math.random().toString(36).slice(2, 7)}`,
      description: 'regression fixture',
      price: 100_000,
      stock,
      weight_grams: 200,
    });
    expect(res.status).toBe(201);
    return { productId: res.body.data.id as number };
  };

  const order = (productId: number, label: string) =>
    asCustomer(api().post('/orders'))
      .set('Idempotency-Key', idempotencyKey(label))
      .send({
        addressId: customer.addressId,
        payWithWallet: true,
        shippingMethodId,
        items: [{ productId, quantity: 1 }],
      });

  beforeAll(async () => {
    app = await bootApp();
    dataSource = app.get(DataSource);
    admin = await createAccount(app, userRoleEnum.AdminUser);
    customer = await createAccount(app, userRoleEnum.NormalUser, {
      walletAmount: 500_000_000,
      withAddress: true,
    });

    const zone = await asAdmin(api().post('/shipping/zones')).send({
      title: `e2e-reg-zone-${run}`,
      provinces: [],
      is_default: true,
    });
    const method = await asAdmin(api().post('/shipping/methods')).send({
      title: 'e2e regression post',
      code: `e2e-reg-${run}`,
      estimated_days_min: 1,
      estimated_days_max: 2,
    });
    shippingMethodId = method.body.data.id;
    await asAdmin(
      api().post(`/shipping/methods/${shippingMethodId}/rates`),
    ).send({ zoneId: zone.body.data.id, base_cost: 10_000, per_kg_cost: 0 });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  // The stock lock used to be taken by a query that selected only `id`,
  // and stock was then read by a plain SELECT. Under REPEATABLE READ that
  // plain read returns the transaction's snapshot, not the latest commit,
  // so every concurrent checkout saw the same last unit and all of them
  // succeeded. Eight buyers, one item.
  it('sells the last unit exactly once under concurrent checkouts', async () => {
    const { productId } = await productWithStock(1);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => order(productId, `race-${run}-${i}`)),
    );

    const sold = results.filter((res) => res.status === 201);
    const refused = results.filter((res) => res.status >= 400);
    expect(sold).toHaveLength(1);
    expect(refused).toHaveLength(7);
    refused.forEach((res) => expect(res.body.code).toBe('INSUFFICIENT_STOCK'));
    expect(await stockOf(productId)).toBe(0);
  }, 60_000);

  // A signed-in customer's basket lives on the server. The client only
  // cleared its local copy after ordering, so the ordered lines came back
  // on the next reload and could be bought a second time.
  it('removes the ordered lines from the server-side basket', async () => {
    const { productId } = await productWithStock(5);
    const other = await productWithStock(5);

    await asCustomer(api().post('/products/basket')).send({
      product_id: productId,
    });
    await asCustomer(api().post('/products/basket')).send({
      product_id: other.productId,
    });

    const placed = await order(productId, `basket-${run}`);
    expect(placed.status).toBe(201);

    const basket = await asCustomer(
      api().get(`/products/basket/${customer.id}`),
    );
    const lines = (basket.body.data as Array<{ product: { id: number } }>).map(
      (line) => line.product.id,
    );

    expect(lines).not.toContain(productId);
    // ...and only that line: the rest of the basket is untouched.
    expect(lines).toContain(other.productId);
  }, 60_000);

  // The product editor used to send the stock it had when the page was
  // opened. A sale made while it was open was written back over on save,
  // even if the admin had only changed the title.
  describe('stock edits that race a sale', () => {
    it('leaves stock alone when only other fields change', async () => {
      const { productId } = await productWithStock(12);
      await dataSource.query(
        'UPDATE products SET stock = stock - 5 WHERE id = ?',
        [productId],
      );

      const res = await asAdmin(api().patch(`/products/${productId}`)).send({
        title: `renamed ${run}-${productId}`,
      });

      expect(res.status).toBe(200);
      expect(await stockOf(productId)).toBe(7);
    });

    it('refuses a stock value based on a stale read', async () => {
      const { productId } = await productWithStock(12);
      await dataSource.query(
        'UPDATE products SET stock = stock - 5 WHERE id = ?',
        [productId],
      );

      const stale = await asAdmin(api().patch(`/products/${productId}`)).send({
        stock: 20,
        expected_stock: 12,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STOCK_CHANGED');
      expect(await stockOf(productId)).toBe(7);

      const fresh = await asAdmin(api().patch(`/products/${productId}`)).send({
        stock: 20,
        expected_stock: 7,
      });
      expect(fresh.status).toBe(200);
      expect(await stockOf(productId)).toBe(20);
    });
  });

  // Adding a product that is already in the basket raises its quantity;
  // it never opens a second line for it.
  it('keeps one basket line per product', async () => {
    const { productId } = await productWithStock(5);

    await asCustomer(api().post('/products/basket')).send({
      product_id: productId,
    });
    await asCustomer(api().post('/products/basket')).send({
      product_id: productId,
      quantity: 2,
    });

    const basket = await asCustomer(
      api().get(`/products/basket/${customer.id}`),
    );
    const mine = (
      basket.body.data as Array<{ product: { id: number }; quantity: number }>
    ).filter((line) => line.product.id === productId);
    expect(mine).toHaveLength(1);
    expect(mine[0].quantity).toBe(3);
  });

  // Bookmarks were write-only: rows went in and nothing ever read them
  // back, so a signed-in customer's favourites vanished on refresh. The
  // literal route also has to be declared before `:id`, or Nest parses
  // "bookmark" as a product id.
  it('reads back the bookmarks it stores', async () => {
    const { productId } = await productWithStock(1);
    await asCustomer(api().post('/products/bookmark')).send({
      product_id: productId,
    });

    const res = await asCustomer(api().get('/products/bookmark'));

    expect(res.status).toBe(200);
    expect(res.body.data.productIds).toContain(productId);
  });

  // Access tokens were trusted for their whole lifetime without looking at
  // the database, so a password change left a stolen token working, a
  // demoted admin kept admin rights and a removed account stayed signed in.
  describe('tokens issued before a change of circumstances', () => {
    it('stops a token issued before the password changed', async () => {
      const victim = await createAccount(app, userRoleEnum.NormalUser);
      // iat has whole-second resolution; make sure the change lands in a
      // later second than the token so the comparison is unambiguous.
      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const changed = await api()
        .patch('/auth/password')
        .set('Authorization', `Bearer ${victim.token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'Rotated123x' });
      expect(changed.status).toBe(200);

      const stolen = await api()
        .get('/addresses')
        .set('Authorization', `Bearer ${victim.token}`);
      expect(stolen.status).toBe(401);
    }, 30_000);

    // The generic profile route accepted a new password with no current
    // password. Anyone holding a stolen access token for its 15 minutes
    // could pick a password, take the account over for good and lock the
    // owner out - and since that path wrote the password itself, the stolen
    // token even kept working afterwards.
    it('does not let the owner set a password without the current one', async () => {
      const victim = await createAccount(app, userRoleEnum.NormalUser);
      const hashOf = async () =>
        (
          await dataSource.query('SELECT password FROM users WHERE id = ?', [
            victim.id,
          ])
        )[0].password as string;
      const before = await hashOf();

      const hijack = await api()
        .patch(`/users/${victim.id}`)
        .set('Authorization', `Bearer ${victim.token}`)
        .send({ password: 'Hijack123x' });
      expect(hijack.status).toBe(403);

      // Checked in the database rather than by trying to sign in with the
      // attacker's password: a failed sign-in counts against the login rate
      // limit, which every later test in this file shares.
      expect(await hashOf()).toBe(before);
    });

    it('retires old tokens when an admin sets a password', async () => {
      const customer = await createAccount(app, userRoleEnum.NormalUser);
      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const set = await asAdmin(api().patch(`/users/${customer.id}`)).send({
        password: 'AdminSet9x',
      });
      expect(set.status).toBe(200);

      const old = await api()
        .get('/addresses')
        .set('Authorization', `Bearer ${customer.token}`);
      expect(old.status).toBe(401);
    }, 30_000);

    it('takes the role from the database, not the token', async () => {
      const demoted = await createAccount(app, userRoleEnum.AdminUser);
      const before = await api()
        .get('/users')
        .set('Authorization', `Bearer ${demoted.token}`);
      expect(before.status).toBe(200);

      await dataSource.query('UPDATE users SET role = ? WHERE id = ?', [
        userRoleEnum.NormalUser,
        demoted.id,
      ]);

      const after = await api()
        .get('/users')
        .set('Authorization', `Bearer ${demoted.token}`);
      expect(after.status).toBe(403);
    });

    it('stops a token whose account has been removed', async () => {
      const gone = await createAccount(app, userRoleEnum.NormalUser);
      await dataSource.query(
        'UPDATE users SET deletedAt = NOW(3) WHERE id = ?',
        [gone.id],
      );

      const res = await api()
        .get('/addresses')
        .set('Authorization', `Bearer ${gone.token}`);
      expect(res.status).toBe(401);
    });
  });
});
