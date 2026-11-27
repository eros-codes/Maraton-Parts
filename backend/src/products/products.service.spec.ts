import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, QueryFailedError } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { BookmarkProduct } from './entities/product-bookmark.entity';
import { Category } from '../categories/entities/category.entity';
import { UsersService } from '../users/users.service';
import { FileStorage } from '../common/storage/file-storage';
import {
  CatalogCacheScope,
  CatalogCacheService,
} from '../common/cache/catalog-cache.service';
import { CategoriesService } from '../categories/categories.service';
import { AuditService } from '../audit/audit.service';
import { AttributesService } from '../attributes/attributes.service';
import { ErrorCodes } from '../common/errors/error-codes';
import { ProductImageProcessor } from './images/product-image-processor';

function makeQueryBuilder() {
  const qb: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'delete',
    'from',
    'update',
    'set',
    'orderBy',
    'addOrderBy',
    'offset',
    'limit',
    'relation',
    'of',
    'leftJoinAndMapOne',
    'leftJoin',
    'innerJoin',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.loadMany = jest.fn().mockResolvedValue([]);
  qb.addAndRemove = jest.fn().mockResolvedValue(undefined);
  return qb;
}

describe('ProductsService', () => {
  let service: ProductsService;
  let productsRepo: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;
  let repoOnManager: Record<string, jest.Mock>;
  let qb: Record<string, jest.Mock>;
  let fileStorage: Record<string, jest.Mock>;
  let imageProcessor: { renditions: jest.Mock };
  let catalogCache: { invalidate: jest.Mock };
  let attributesService: Record<string, jest.Mock>;
  let dataSource: Record<string, jest.Mock>;

  const png = {
    buffer: Buffer.from('png'),
    extension: 'png' as const,
    mimeType: 'image/png',
    size: 3,
  };
  const jpg = {
    buffer: Buffer.from('jpg'),
    extension: 'jpg' as const,
    mimeType: 'image/jpeg',
    size: 3,
  };

  beforeEach(async () => {
    qb = makeQueryBuilder();
    repoOnManager = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 21, ...data })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(1),
      delete: jest.fn(),
    };
    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn(() => repoOnManager),
      create: jest.fn((_entity, data) => ({ ...data })),
      save: jest.fn(async (entity) => ({ id: 1, ...entity })),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      maximum: jest.fn(),
      createQueryBuilder: jest.fn(() => qb),
    };
    productsRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 1, categories: [], images: [] }),
      find: jest.fn().mockResolvedValue([]),
      existsBy: jest.fn().mockResolvedValue(true),
      createQueryBuilder: jest.fn(() => qb),
    };
    fileStorage = {
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      getPublicUrl: jest.fn(
        (key: string) => `http://localhost:3000/uploads/${key}`,
      ),
    };
    catalogCache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    // Three widths per photo, as a large camera photo gives.
    imageProcessor = {
      renditions: jest.fn().mockResolvedValue(
        [400, 800, 1600].map((width) => ({
          width,
          height: width,
          buffer: Buffer.from(`w${width}`),
        })),
      ),
    };
    dataSource = {
      transaction: jest.fn((cb: any) => cb(manager)),
      getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([]) })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: AttributesService,
          useValue: {
            assertRequiredAnswered: jest.fn(),
            replaceProductValues: jest.fn(),
          },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: UsersService, useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: FileStorage, useValue: fileStorage },
        { provide: ProductImageProcessor, useValue: imageProcessor },
        { provide: CatalogCacheService, useValue: catalogCache },
        {
          provide: CategoriesService,
          useValue: {
            getDescendantIds: jest.fn(async (id: number) => [id]),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ProductsService);
    attributesService = moduleRef.get(AttributesService);
  });

  describe('create', () => {
    it('rejects invalid category IDs without writing anything', async () => {
      manager.find.mockResolvedValue([{ id: 1 }]);

      await expect(
        service.create({
          title: 'x',
          description: 'y',
          price: 10,
          stock: 5,
          categoryIds: [1, 2],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(catalogCache.invalidate).not.toHaveBeenCalled();
    });

    it('locks the categories it links and invalidates the cache after saving', async () => {
      manager.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await service.create({
        title: 'x',
        description: 'y',
        price: 10,
        stock: 5,
        categoryIds: [1, 2],
      });

      expect(manager.find).toHaveBeenCalledWith(
        Category,
        expect.objectContaining({ lock: { mode: 'pessimistic_read' } }),
      );
      expect(catalogCache.invalidate).toHaveBeenCalledWith(
        CatalogCacheScope.Products,
      );
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
        catalogCache.invalidate.mock.invocationCallOrder[0],
      );
    });
  });

  describe('findAll', () => {
    it('answers a search with no searchable characters with an empty page, without querying', async () => {
      const result = await service.findAll({
        search: '+-*"',
        page: 1,
        limit: 10,
      });

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });
      expect(qb.getManyAndCount).not.toHaveBeenCalled();
    });

    // The search conditions sit inside Brackets; this opens them up into a
    // flat list of [condition, params].
    const searchConditions = () => {
      const seen: unknown[][] = [];
      const recorder: Record<string, (...args: unknown[]) => unknown> = {};
      const record = (...args: unknown[]) => {
        if (args[0] instanceof Brackets) {
          (args[0] as any).whereFactory(recorder);
        } else {
          seen.push(args);
        }
        return recorder;
      };
      recorder.where = record;
      recorder.andWhere = record;
      recorder.orWhere = record;
      qb.andWhere.mock.calls.forEach((call: unknown[]) => record(...call));
      return seen;
    };

    it('needs every word, each in the title, a spec or a category name', async () => {
      await service.findAll({ search: 'پژو ۲۰۶', page: 1, limit: 10 });

      const conditions = searchConditions();
      const params = conditions.map(([, values]) => values);
      expect(params).toContainEqual({ searchTerm0_0: '%پژو%' });
      // A number goes in with both kinds of digits.
      expect(params).toContainEqual({ searchTerm1_0: '%206%' });
      expect(params).toContainEqual({ searchTerm1_1: '%۲۰۶%' });

      const [sql] = conditions.find(
        ([, values]) =>
          (values as Record<string, unknown> | undefined)?.searchTerm1_0,
      )!;
      expect(sql).toContain('product.title LIKE :searchTerm1_0');
      expect(sql).toContain('pav.value_text LIKE :searchTerm1_0');
      expect(sql).toContain('sc.title LIKE :searchTerm1_0');
    });

    it('selects a cover image instead of every image', async () => {
      await service.findAll({ page: 1, limit: 10 });

      expect(qb.leftJoinAndMapOne).toHaveBeenCalledWith(
        'product.coverImage',
        'product.images',
        'cover',
        'cover.order = 0',
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith('product.id', 'DESC');
    });
  });

  describe('update', () => {
    it('is a 404 - not a resurrection - when the product was deleted meanwhile', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.update(1, { price: 20 })).rejects.toThrow(
        NotFoundException,
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('updates only the given columns, and only on a live row', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });

      await service.update(1, { price: 20 });

      expect(manager.update).toHaveBeenCalledWith(
        Product,
        { id: 1, deleted_at: IsNull() },
        { price: 20 },
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(catalogCache.invalidate).toHaveBeenCalledWith(
        CatalogCacheScope.Products,
      );
    });

    it('adds and removes only the category links that changed', async () => {
      manager.find.mockResolvedValue([{ id: 2 }, { id: 3 }]);
      manager.findOne.mockResolvedValue({ id: 1 });
      qb.loadMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await service.update(1, { categoryIds: [2, 3] });

      expect(qb.addAndRemove).toHaveBeenCalledWith([3], [1]);
    });
  });

  describe('remove', () => {
    it('soft-deletes, clears basket lines in the same transaction, keeps image files', async () => {
      manager.findOne.mockResolvedValue({ id: 5 });

      await service.remove(5);

      expect(manager.softDelete).toHaveBeenCalledWith(Product, { id: In([5]) });
      expect(qb.where).toHaveBeenCalledWith('productId IN (:...ids)', {
        ids: [5],
      });
      expect(qb.execute).toHaveBeenCalled();
      expect(fileStorage.delete).not.toHaveBeenCalled();
      expect(catalogCache.invalidate).toHaveBeenCalledWith(
        CatalogCacheScope.Products,
      );
    });

    it('throws NotFoundException for a product that does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
      expect(manager.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('addImages', () => {
    it('continues positions after the current highest one, under the product lock', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });
      manager.maximum.mockResolvedValue(2);

      await service.addImages(1, [png, jpg]);

      expect(manager.findOne).toHaveBeenCalledWith(
        Product,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      const [entity, rows] = manager.insert.mock.calls[0];
      expect(entity).toBe(ProductImage);
      expect(rows.map((row: any) => row.order)).toEqual([3, 4]);
      expect(fileStorage.save).toHaveBeenCalledTimes(6);
    });

    it('stores every width as WebP; the largest is the image itself', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });
      manager.maximum.mockResolvedValue(null);

      await service.addImages(1, [jpg]);

      const [row] = manager.insert.mock.calls[0][1];
      const id = row.filename.replace(/\.webp$/, '');
      expect(row.filename).toMatch(/^[0-9a-f-]{36}\.webp$/);
      expect(fileStorage.save.mock.calls.map((call) => call[0])).toEqual([
        `products/${id}-400.webp`,
        `products/${id}-800.webp`,
        `products/${id}.webp`,
      ]);
      expect(row.sizes).toEqual([
        {
          width: 400,
          url: `http://localhost:3000/uploads/products/${id}-400.webp`,
        },
        {
          width: 800,
          url: `http://localhost:3000/uploads/products/${id}-800.webp`,
        },
        {
          width: 1600,
          url: `http://localhost:3000/uploads/products/${id}.webp`,
        },
      ]);
      expect(row.url).toBe(row.sizes[2].url);
    });

    it('removes what it wrote when a later photo cannot be read', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });
      imageProcessor.renditions
        .mockResolvedValueOnce([
          { width: 400, height: 400, buffer: Buffer.from('a') },
        ])
        .mockRejectedValueOnce(new Error('unreadable'));

      await expect(service.addImages(1, [png, jpg])).rejects.toThrow(
        'unreadable',
      );

      expect(fileStorage.delete.mock.calls.map((call) => call[0])).toEqual(
        fileStorage.save.mock.calls.map((call) => call[0]),
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('starts at position 0 for a product without images', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });
      manager.maximum.mockResolvedValue(null);

      await service.addImages(1, [png]);

      expect(manager.insert.mock.calls[0][1][0].order).toBe(0);
    });

    it('removes the files it wrote when the database part fails', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });
      manager.maximum.mockResolvedValue(0);
      manager.insert.mockRejectedValue(new Error('db down'));

      await expect(service.addImages(1, [png, jpg])).rejects.toThrow('db down');

      const savedKeys = fileStorage.save.mock.calls.map((call) => call[0]);
      expect(fileStorage.delete.mock.calls.map((call) => call[0])).toEqual(
        savedKeys,
      );
      expect(catalogCache.invalidate).not.toHaveBeenCalled();
    });

    it('is a 404 before any file is written for a missing product', async () => {
      productsRepo.existsBy.mockResolvedValue(false);

      await expect(service.addImages(9, [png])).rejects.toThrow(
        NotFoundException,
      );
      expect(fileStorage.save).not.toHaveBeenCalled();
    });
  });

  describe('removeImage', () => {
    it('deletes every stored width of the image', async () => {
      manager.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({
        id: 9,
        filename: 'abc.webp',
        order: 0,
        sizes: [
          { width: 400, url: 'http://x/uploads/products/abc-400.webp' },
          { width: 1600, url: 'http://x/uploads/products/abc.webp' },
        ],
      });

      await service.removeImage(1, 9);

      expect(fileStorage.delete.mock.calls.map((call) => call[0])).toEqual([
        'products/abc.webp',
        'products/abc-400.webp',
      ]);
    });

    it('deletes the row, closes the gap, and only then deletes the file', async () => {
      manager.findOne
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 9, filename: 'a.png', order: 1 });

      await service.removeImage(1, 9);

      expect(manager.delete).toHaveBeenCalledWith(ProductImage, { id: 9 });
      expect(qb.where).toHaveBeenCalledWith(
        'productId = :productId AND `order` > :removedOrder',
        {
          productId: 1,
          removedOrder: 1,
        },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('`order`', 'ASC');
      expect(fileStorage.delete).toHaveBeenCalledWith('products/a.png');
      expect(manager.delete.mock.invocationCallOrder[0]).toBeLessThan(
        fileStorage.delete.mock.invocationCallOrder[0],
      );
    });

    it('throws NotFoundException for an image not on that product, keeping every file', async () => {
      manager.findOne
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce(null);

      await expect(service.removeImage(1, 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(fileStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe('makeCoverImage', () => {
    it('moves the picture to the front without two ever sharing a place', async () => {
      manager.findOne
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 9, order: 2 });

      await service.makeCoverImage(1, 9);

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        ProductImage,
        { id: 9 },
        { order: -1 },
      );
      expect(qb.where).toHaveBeenCalledWith(
        'productId = :productId AND `order` >= 0 AND `order` < :from',
        { productId: 1, from: 2 },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('`order`', 'DESC');
      expect(manager.update).toHaveBeenLastCalledWith(
        ProductImage,
        { id: 9 },
        { order: 0 },
      );
      expect(catalogCache.invalidate).toHaveBeenCalled();
    });

    it('leaves the order alone when it already is the cover', async () => {
      manager.findOne
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 9, order: 0 });

      await service.makeCoverImage(1, 9);

      expect(manager.update).not.toHaveBeenCalled();
    });
  });

  describe('product video', () => {
    const video = { buffer: Buffer.from('mp4'), durationMs: 12_000, size: 3 };

    it('stores the file and records where it is and how long it runs', async () => {
      manager.findOne.mockResolvedValue({ id: 1, video_filename: null });

      await service.setVideo(1, video);

      const key = fileStorage.save.mock.calls[0][0];
      expect(key).toMatch(/^products\/videos\/1-[0-9a-f-]+\.mp4$/);
      expect(manager.update).toHaveBeenCalledWith(
        Product,
        { id: 1 },
        {
          video_url: `http://localhost:3000/uploads/${key}`,
          video_filename: key,
          video_duration_ms: 12_000,
          video_size_bytes: 3,
        },
      );
      expect(fileStorage.delete).not.toHaveBeenCalled();
    });

    // The old file goes only once the product points at the new one.
    it('replaces an earlier video and only then deletes its file', async () => {
      manager.findOne.mockResolvedValue({
        id: 1,
        video_filename: 'products/videos/1-old.mp4',
      });

      await service.setVideo(1, video);

      expect(fileStorage.delete).toHaveBeenCalledWith(
        'products/videos/1-old.mp4',
      );
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        fileStorage.delete.mock.invocationCallOrder[0],
      );
    });

    it('removes the new file when the product could not be updated', async () => {
      manager.findOne.mockResolvedValue({ id: 1, video_filename: 'old.mp4' });
      manager.update.mockRejectedValueOnce(new Error('db down'));

      await expect(service.setVideo(1, video)).rejects.toThrow('db down');

      const key = fileStorage.save.mock.calls[0][0];
      expect(fileStorage.delete).toHaveBeenCalledWith(key);
      // ...and the previous video is still there.
      expect(fileStorage.delete).not.toHaveBeenCalledWith('old.mp4');
    });

    it('stores nothing for a product that does not exist', async () => {
      productsRepo.existsBy.mockResolvedValue(false);

      await expect(service.setVideo(9, video)).rejects.toThrow(
        NotFoundException,
      );
      expect(fileStorage.save).not.toHaveBeenCalled();
    });

    it('removes the video and its file', async () => {
      manager.findOne.mockResolvedValue({
        id: 1,
        video_filename: 'products/videos/1-a.mp4',
      });

      await service.removeVideo(1);

      expect(manager.update).toHaveBeenCalledWith(
        Product,
        { id: 1 },
        {
          video_url: null,
          video_filename: null,
          video_duration_ms: null,
          video_size_bytes: null,
        },
      );
      expect(fileStorage.delete).toHaveBeenCalledWith(
        'products/videos/1-a.mp4',
      );
    });

    it('says so when there is no video to remove', async () => {
      manager.findOne.mockResolvedValue({ id: 1, video_filename: null });

      await expect(service.removeVideo(1)).rejects.toThrow(NotFoundException);
      expect(fileStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe('stock', () => {
    // A product is one thing with one stock count: the panel sets it
    // directly on the product.
    it('writes the stock straight onto the product', async () => {
      manager.findOne.mockResolvedValue({ id: 1, price: 100, stock: 4 });

      await service.update(1, { stock: 9 });

      expect(manager.update).toHaveBeenCalledWith(
        Product,
        { id: 1, deleted_at: IsNull() },
        { stock: 9 },
      );
    });

    // The editor was opened at 4; two sold since. Writing 9 would hand
    // those two units back.
    it('refuses a stock edit made against a stale number', async () => {
      manager.findOne.mockResolvedValue({ id: 1, price: 100, stock: 2 });

      await expect(
        service.update(1, { stock: 9, expected_stock: 4 }),
      ).rejects.toMatchObject({
        code: ErrorCodes.STOCK_CHANGED,
        details: { current: 2, expected: 4 },
      });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('accepts it when nothing sold in the meantime', async () => {
      manager.findOne.mockResolvedValue({ id: 1, price: 100, stock: 4 });

      await service.update(1, { stock: 9, expected_stock: 4 });

      expect(manager.update).toHaveBeenCalledWith(Product, expect.anything(), {
        stock: 9,
      });
    });

    it('creates the product with its own stock and no options', async () => {
      await service.create({
        title: 'تسمه تایم',
        description: 'y',
        price: 10,
        stock: 7,
      });

      expect(manager.create).toHaveBeenCalledWith(
        Product,
        expect.objectContaining({ stock: 7 }),
      );
      expect(manager.query).not.toHaveBeenCalled();
    });

    it("checks the category's required attributes on create", async () => {
      manager.find.mockResolvedValue([{ id: 4 }]);
      const attributes = [{ attributeId: 2, optionId: 21 }];

      await service.create({
        title: 'x',
        description: 'y',
        price: 10,
        stock: 1,
        categoryIds: [4],
        attributes,
      });

      expect(attributesService.assertRequiredAnswered).toHaveBeenCalledWith(
        [4],
        attributes,
        manager,
      );
    });
  });

  describe('toggleBookmark', () => {
    it('creates a bookmark when none exists', async () => {
      manager.findOne.mockResolvedValue({ id: 1, is_published: true });
      qb.getOne.mockResolvedValue(null);

      const result = await service.toggleBookmark(7, { product_id: 1 });

      expect(result.bookmarked).toBe(true);
      expect(manager.insert).toHaveBeenCalledWith(BookmarkProduct, {
        user: { id: 7 },
        product: { id: 1 },
      });
    });

    it('removes the bookmark when one already exists', async () => {
      manager.findOne.mockResolvedValue({ id: 1 });
      qb.getOne.mockResolvedValue({ id: 3 });

      const result = await service.toggleBookmark(7, { product_id: 1 });

      expect(result.bookmarked).toBe(false);
      expect(manager.delete).toHaveBeenCalledWith(BookmarkProduct, { id: 3 });
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('can not bookmark a deleted product', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.toggleBookmark(7, { product_id: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  it('keeps In/IsNull imports meaningful for the category helpers', () => {
    expect(In([1]).type).toBe('in');
  });

  describe('drafts', () => {
    // A draft's id, price and description are the shop's unreleased work.
    it('answers 404 for an unpublished product on the public lookups', async () => {
      productsRepo.findOne.mockResolvedValue({ id: 5, is_published: false });

      await expect(service.findOne(5)).rejects.toThrow(NotFoundException);
      await expect(service.findBySlug('secret')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('shows it to the admin panel', async () => {
      productsRepo.findOne.mockResolvedValue({ id: 5, is_published: false });

      await expect(
        service.findOne(5, { includeDrafts: true }),
      ).resolves.toMatchObject({ id: 5 });
    });

    it('lists only published products unless drafts are asked for', async () => {
      await service.findAll({ page: 1, limit: 10 });
      expect(qb.where).toHaveBeenLastCalledWith('product.is_published = TRUE');

      await service.findAll({ page: 1, limit: 10 }, { includeDrafts: true });
      expect(qb.where).toHaveBeenLastCalledWith('1 = 1');
    });

    it('will not let a customer bookmark one', async () => {
      manager.findOne.mockResolvedValue({ id: 1, is_published: false });
      qb.getOne.mockResolvedValue(null);

      await expect(
        service.toggleBookmark(7, { product_id: 1 }),
      ).rejects.toMatchObject({ code: ErrorCodes.PRODUCT_NOT_FOR_SALE });
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('slugs', () => {
    const product = {
      title: 'Phone',
      description: 'A phone',
      price: 100,
      stock: 1,
    };

    // Two products with the same title used to die on the unique index.
    it('gives a second product with the same title the next free slug', async () => {
      qb.getRawMany.mockResolvedValue([{ slug: 'phone' }]);

      await service.create(product);

      expect(manager.create).toHaveBeenCalledWith(
        Product,
        expect.objectContaining({ slug: 'phone-2' }),
      );
    });

    it('turns a clash on a slug the admin typed into a 409', async () => {
      manager.save.mockRejectedValueOnce(
        Object.assign(new QueryFailedError('INSERT', [], new Error('dup')), {
          driverError: {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
            sqlMessage:
              "Duplicate entry 'phone' for key 'UQ_products_active_slug'",
          },
        }),
      );

      await expect(
        service.create({ ...product, slug: 'phone' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update - descriptive attributes and sale price', () => {
    beforeEach(() => {
      manager.findOne.mockResolvedValue({
        id: 1,
        price: 100,
        sale_price: null,
      });
    });

    // The panel sends them on every save; they were silently dropped.
    it('saves the descriptive attributes it is given', async () => {
      const attributes = [{ attributeId: 3, value_text: 'AMOLED' }];

      await service.update(1, { attributes });

      expect(attributesService.replaceProductValues).toHaveBeenCalledWith(
        manager,
        1,
        attributes,
      );
    });

    it('refuses a sale price above the price the edit leaves', async () => {
      await expect(service.update(1, { sale_price: 150 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.update(1, { price: 80, sale_price: 90 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets a sale be ended by clearing it', async () => {
      await service.update(1, { sale_price: null } as never);

      expect(manager.update).toHaveBeenCalledWith(
        Product,
        expect.anything(),
        expect.objectContaining({ sale_price: null }),
      );
    });
  });

  describe('facets', () => {
    // Each option used to run the whole listing (rows, categories, option
    // lookups) just to read its total.
    it('counts each option with a COUNT and never loads rows', async () => {
      dataSource.getRepository.mockReturnValue({
        find: jest.fn().mockResolvedValue([
          {
            id: 1,
            title: 'Colour',
            code: 'colour',
            type: 'select',
            options: [
              { id: 10, value: 'Black', slug: 'black', sort_order: 0 },
              { id: 11, value: 'White', slug: 'white', sort_order: 1 },
            ],
          },
        ]),
      });
      qb.getCount.mockResolvedValue(3);

      const facets = await service.facets({ page: 1, limit: 24 });

      expect(qb.getCount).toHaveBeenCalledTimes(2);
      expect(qb.getManyAndCount).not.toHaveBeenCalled();
      expect(facets[0].options.map((option) => option.count)).toEqual([3, 3]);
    });
  });
});
