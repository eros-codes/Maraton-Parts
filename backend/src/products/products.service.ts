import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { CreateProductDto } from './dto/create-product.dto';
import { slugify, uniqueSlug } from '../common/utils/slugify';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AttributesService } from '../attributes/attributes.service';
import { Attribute } from '../attributes/entities/attribute.entity';
import { AttributeOption } from '../attributes/entities/attribute-option.entity';
import { CategoriesService } from '../categories/categories.service';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { BasketItemDto } from './dto/basket-item.dto';
import { MergeBasketDto } from './dto/merge-basket.dto';
import { FilterProductDto } from './dto/filter-product.dto';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductImageProcessor } from './images/product-image-processor';
import {
  StoredImage,
  storedKeysOf,
  storeRenditions,
} from './images/image-files';
import { BookmarkProduct } from './entities/product-bookmark.entity';
import { Category } from '../categories/entities/category.entity';
import { Brand } from '../brands/entities/brand.entity';
import { UsersService } from '../users/users.service';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { FileStorage } from '../common/storage/file-storage';
import {
  CatalogCacheScope,
  CatalogCacheService,
} from '../common/cache/catalog-cache.service';
import {
  buildProductSearchPlan,
  escapeLikePattern,
} from './utils/product-search';
import { assertPublished, lockActiveProduct } from './utils/product-locks';
import { softDeleteProducts } from './utils/product-delete';
import { lockUserRow } from '../users/utils/lock-user-row';
import { ValidatedImage } from './pipes/product-images.pipe';
import { ValidatedVideo } from './pipes/product-video.pipe';
import { randomUUID } from 'crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/errors/error-codes';

export interface ProductFacetOption {
  optionId: number;
  value: string;
  slug: string;
  hex: string | null;
  count: number;
}

export interface ProductViewOptions {
  // Unpublished products are the admin's work in progress. Only the admin
  // panel asks for them, and the controller only lets it when the caller
  // really is an admin.
  includeDrafts?: boolean;
}

// What the facet counts would otherwise look up once per option: the
// category subtree and which attribute each option belongs to.
interface FilterContext {
  categoryIds?: number[];
  optionMeta?: Map<number, number>;
}

export interface ProductFacet {
  attributeId: number;
  title: string;
  code: string;
  type: string;
  options: ProductFacetOption[];
}

// Where product videos live in the upload storage.
const PRODUCT_VIDEOS_FOLDER = 'products/videos';
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorage,
    private readonly catalogCache: CatalogCacheService,
    private readonly categoriesService: CategoriesService,
    private readonly auditService: AuditService,
    private readonly attributesService: AttributesService,
    private readonly imageProcessor: ProductImageProcessor,
  ) {}

  private static readonly EFFECTIVE_PRICE_SQL = `IF(
    product.sale_price IS NOT NULL
      AND (product.sale_starts_at IS NULL OR product.sale_starts_at <= NOW())
      AND (product.sale_ends_at IS NULL OR product.sale_ends_at >= NOW()),
    product.sale_price, product.price)`;

  async create(createProductDto: CreateProductDto): Promise<Product> {
    const {
      title,
      description,
      price,
      stock,
      categoryIds,
      brandId,
      slug,
      sale_price,
      sale_starts_at,
      sale_ends_at,
      weight_grams,
      is_published,
    } = createProductDto;

    const baseSlug = slugify(slug ?? title);
    if (!baseSlug) {
      throw new BadRequestException(
        'This title cannot be turned into a URL slug - please provide one explicitly',
      );
    }
    // Two products with the same title are normal ("Galaxy S25" from two
    // sellers); the second one used to die on the unique index with a 500.
    // A slug the admin typed is theirs to fix, so that one still conflicts.
    const productSlug =
      slug === undefined ? await this.freeSlug(baseSlug) : baseSlug;
    if (sale_price !== undefined && sale_price !== null && sale_price > price) {
      throw new BadRequestException(
        'A sale price above the normal price is not a sale',
      );
    }

    const productId = await this.inSlugTransaction(async (manager) => {
      const product = manager.create(Product, {
        title,
        description,
        price,
        stock,
        slug: productSlug,
        ...(brandId !== undefined ? { brand: { id: brandId } as Brand } : {}),
        ...(sale_price !== undefined ? { sale_price } : {}),
        ...(sale_starts_at !== undefined
          ? { sale_starts_at: new Date(sale_starts_at) }
          : {}),
        ...(sale_ends_at !== undefined
          ? { sale_ends_at: new Date(sale_ends_at) }
          : {}),
        ...(weight_grams !== undefined ? { weight_grams } : {}),
        ...(is_published !== undefined ? { is_published } : {}),
      });
      if (categoryIds?.length) {
        product.categories = await this.lockActiveCategories(
          manager,
          categoryIds,
        );
      }
      const saved = await manager.save(product);

      await this.attributesService.assertRequiredAnswered(
        categoryIds ?? [],
        createProductDto.attributes ?? [],
        manager,
      );
      await this.attributesService.replaceProductValues(
        manager,
        saved.id,
        createProductDto.attributes ?? [],
      );

      return saved.id;
    });

    await this.catalogCache.invalidate(CatalogCacheScope.Products);
    return this.findOne(productId, { includeDrafts: true });
  }

  // The first free "base", "base-2", "base-3"... among live products.
  private async freeSlug(base: string): Promise<string> {
    const rows = await this.productsRepository
      .createQueryBuilder('product')
      .select('product.slug', 'slug')
      .where('product.slug LIKE :prefix', {
        prefix: `${escapeLikePattern(base)}%`,
      })
      .getRawMany<{ slug: string }>();
    return uniqueSlug(
      base,
      rows.map((row) => row.slug),
    );
  }

  // A clash on the unique slug index is the admin's input colliding with an
  // existing product - a 409, not a 500.
  private async inSlugTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(
          'Another product already uses this slug - choose a different one',
        );
      }
      throw error;
    }
  }

  async findAll(
    query: FilterProductDto,
    options: ProductViewOptions = {},
  ): Promise<PaginatedResult<Product>> {
    const { sortBy, sortOrder, page, limit } = query;
    const direction = sortOrder ?? 'DESC';
    const effectivePrice = ProductsService.EFFECTIVE_PRICE_SQL;

    const qb = this.productsRepository
      .createQueryBuilder('product')
      .select([
        'product.id',
        'product.title',
        'product.slug',
        'product.price',
        'product.sale_price',
        'product.sale_starts_at',
        'product.sale_ends_at',
        'product.stock',
        'product.rating_avg',
        'product.rating_count',
        // The admin list badges each row published/draft from this; left
        // out, every product in the panel read "draft".
        'product.is_published',
        'product.created_at',
        'product.updated_at',
      ])
      .leftJoin('product.brand', 'brand')
      .addSelect(['brand.id', 'brand.title', 'brand.slug'])
      .where(options.includeDrafts ? '1 = 1' : 'product.is_published = TRUE')
      .leftJoinAndMapOne(
        'product.coverImage',
        'product.images',
        'cover',
        'cover.order = 0',
      )
      .addSelect(['cover.id', 'cover.url', 'cover.order', 'cover.sizes']);

    if (!(await this.applyFilters(qb, query))) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    const orderExpression =
      sortBy === 'price'
        ? effectivePrice
        : sortBy === 'rating'
          ? 'product.rating_avg'
          : sortBy === 'best_selling'
            ? 'product.sales_count'
            : `product.${sortBy ?? 'created_at'}`;
    if (sortBy === 'rating') {
      qb.addSelect('product.rating_count', 'rating_count_sort');
    }
    qb.orderBy(orderExpression, direction)
      .addOrderBy('product.id', direction)
      .offset((page - 1) * limit)
      .limit(limit);

    const [items, total] = await qb.getManyAndCount();
    await this.attachCategories(items);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Every filter the listing understands, shared by the listing itself and
  // by the facet counts. Returns false when the search has nothing usable
  // in it, i.e. nothing can match.
  private async applyFilters(
    qb: SelectQueryBuilder<Product>,
    query: FilterProductDto,
    context: FilterContext = {},
  ): Promise<boolean> {
    const {
      categoryId,
      brandId,
      minPrice,
      maxPrice,
      inStock,
      onSale,
      attributeOptions,
      search,
    } = query;
    const effectivePrice = ProductsService.EFFECTIVE_PRICE_SQL;

    if (categoryId) {
      const categoryIds =
        context.categoryIds ??
        (await this.categoriesService.getDescendantIds(categoryId));
      qb.andWhere(
        'EXISTS (SELECT 1 FROM product_category pc INNER JOIN categories c ON c.id = pc.category_id AND c.deleted_at IS NULL WHERE pc.product_id = product.id AND pc.category_id IN (:...categoryIds))',
        { categoryIds },
      );
    }

    if (brandId) {
      qb.andWhere('product.brand_id = :brandId', { brandId });
    }

    if (minPrice !== undefined) {
      qb.andWhere(`${effectivePrice} >= :minPrice`, { minPrice });
    }
    if (maxPrice !== undefined) {
      qb.andWhere(`${effectivePrice} <= :maxPrice`, { maxPrice });
    }
    if (attributeOptions?.length) {
      await this.applyAttributeFilter(qb, attributeOptions, context.optionMeta);
    }
    if (inStock === 'true') {
      qb.andWhere('product.stock > 0');
    }
    if (onSale === 'true') {
      qb.andWhere(`${effectivePrice} < product.price`);
    }

    if (search) {
      const plan = buildProductSearchPlan(search);
      if (!plan) {
        return false;
      }
      // Every word has to be found, and each one may be found in the
      // title, in a spec (part number, "suitable for", origin...) or in the
      // name of one of the product's categories - so "206" brings every
      // part filed under the car, whatever its title says. A catalogue of
      // parts is small enough for LIKE to scan.
      plan.terms.forEach((forms, termIndex) => {
        qb.andWhere(
          new Brackets((word) => {
            forms.forEach((pattern, formIndex) => {
              const key = `searchTerm${termIndex}_${formIndex}`;
              word.orWhere(
                `(product.title LIKE :${key}` +
                  ' OR EXISTS (SELECT 1 FROM product_attribute_values pav' +
                  ' LEFT JOIN attribute_options ao ON ao.id = pav.option_id AND ao.deleted_at IS NULL' +
                  ` WHERE pav.product_id = product.id AND (pav.value_text LIKE :${key} OR ao.value LIKE :${key}))` +
                  ' OR EXISTS (SELECT 1 FROM product_category spc' +
                  ' INNER JOIN categories sc ON sc.id = spc.category_id AND sc.deleted_at IS NULL' +
                  // The parent counts too: "سواری" finds every passenger-car bearing.
                  ' LEFT JOIN categories scp ON scp.id = sc.parent_id AND scp.deleted_at IS NULL' +
                  ` WHERE spc.product_id = product.id AND (sc.title LIKE :${key} OR scp.title LIKE :${key})))`,
                { [key]: pattern },
              );
            });
          }),
        );
      });
    }
    return true;
  }

  async findOne(
    id: number,
    options: ProductViewOptions = {},
  ): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id },
      relations: {
        categories: true,
        images: true,
        brand: true,
        attributeValues: { attribute: true, option: true },
      },
      order: { images: { order: 'ASC' } },
    });
    // A draft answers exactly like a product that does not exist: its id,
    // price and description are the shop's unreleased work.
    if (!product || (!product.is_published && !options.includeDrafts))
      throw new NotFoundException(`Product with ID ${id} not found`);
    return product;
  }

  async findBySlug(
    slug: string,
    options: ProductViewOptions = {},
  ): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { slug },
      relations: {
        categories: true,
        images: true,
        brand: true,
        attributeValues: { attribute: true, option: true },
      },
      order: { images: { order: 'ASC' } },
    });
    if (!product || (!product.is_published && !options.includeDrafts)) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }
    return product;
  }

  async update(
    id: number,
    updateProductDto: UpdateProductDto,
    actor?: AuditActor,
  ): Promise<Product> {
    const {
      categoryIds,
      title,
      description,
      price,
      stock,
      expected_stock,
      brandId,
      slug,
      sale_price,
      sale_starts_at,
      sale_ends_at,
      weight_grams,
      is_published,
      attributes,
    } = updateProductDto;
    const changes: Record<string, unknown> = {};
    if (title !== undefined) changes.title = title;
    if (description !== undefined) changes.description = description;
    if (price !== undefined) changes.price = price;
    if (weight_grams !== undefined) changes.weight_grams = weight_grams;
    if (is_published !== undefined) changes.is_published = is_published;
    if (sale_price !== undefined) changes.sale_price = sale_price;
    if (sale_starts_at !== undefined)
      changes.sale_starts_at =
        sale_starts_at === null ? null : new Date(sale_starts_at);
    if (sale_ends_at !== undefined)
      changes.sale_ends_at =
        sale_ends_at === null ? null : new Date(sale_ends_at);
    if (slug !== undefined) {
      const nextSlug = slugify(slug);
      if (!nextSlug) {
        throw new BadRequestException('That slug has no usable characters');
      }
      changes.slug = nextSlug;
    }
    if (brandId !== undefined) {
      changes.brand = brandId === null ? null : { id: brandId };
    }

    await this.inSlugTransaction(async (manager) => {
      const categories =
        categoryIds !== undefined
          ? await this.lockActiveCategories(manager, categoryIds)
          : undefined;
      const current = await lockActiveProduct(manager, id, 'pessimistic_write');

      // Same rule create enforces, against the price this edit leaves.
      const nextPrice = price ?? Number(current.price);
      const nextSale =
        sale_price !== undefined ? sale_price : current.sale_price;
      if (nextSale !== null && nextSale !== undefined && nextSale > nextPrice) {
        throw new BadRequestException(
          'A sale price above the normal price is not a sale',
        );
      }

      if (stock !== undefined) {
        // Optimistic check. The product row is locked above and checkout
        // takes the same lock, so the stock read here is the live value -
        // if it no longer matches what the editor saw, someone bought in the
        // meantime and writing the old number back would undo that sale.
        if (
          expected_stock !== undefined &&
          Number(current.stock) !== expected_stock
        ) {
          throw AppError.conflict(
            ErrorCodes.STOCK_CHANGED,
            'Stock changed since you opened this product - reload and try again',
            { current: Number(current.stock), expected: expected_stock },
          );
        }
        changes.stock = stock;
      }

      if (Object.keys(changes).length > 0) {
        await manager.update(Product, { id, deleted_at: IsNull() }, changes);
      }

      if (categories) {
        const relation = manager
          .createQueryBuilder()
          .relation(Product, 'categories')
          .of(id);
        const current = await relation.loadMany<Category>();
        const wanted = new Set(categories.map((category) => category.id));
        const existing = new Set(current.map((category) => category.id));
        await relation.addAndRemove(
          [...wanted].filter((categoryId) => !existing.has(categoryId)),
          [...existing].filter((categoryId) => !wanted.has(categoryId)),
        );
      }

      // The descriptive properties (screen size, colour...). The panel sends
      // them on every save; they used to be dropped here without a word.
      if (attributes !== undefined) {
        const categoryIdsNow =
          categories?.map((category) => category.id) ??
          (
            await manager
              .createQueryBuilder()
              .relation(Product, 'categories')
              .of(id)
              .loadMany<Category>()
          ).map((category) => category.id);
        await this.attributesService.assertRequiredAnswered(
          categoryIdsNow,
          attributes,
          manager,
        );
        await this.attributesService.replaceProductValues(
          manager,
          id,
          attributes,
        );
      }
    });

    await this.catalogCache.invalidate(CatalogCacheScope.Products);

    if (
      price !== undefined ||
      sale_price !== undefined ||
      stock !== undefined
    ) {
      await this.auditService.record({
        action: 'product.pricing_changed',
        entityType: 'product',
        entityId: id,
        actor,
        changes: {
          ...(price !== undefined ? { price } : {}),
          ...(sale_price !== undefined ? { sale_price } : {}),
          ...(stock !== undefined ? { stock } : {}),
        },
      });
    }

    return this.findOne(id, { includeDrafts: true });
  }

  async remove(id: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await lockActiveProduct(manager, id, 'pessimistic_write');
      await softDeleteProducts(manager, [id]);
    });
    await this.catalogCache.invalidate(CatalogCacheScope.Products);
  }

  async addImages(
    productId: number,
    images: ValidatedImage[],
  ): Promise<Product> {
    if (!(await this.productsRepository.existsBy({ id: productId }))) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const storedKeys: string[] = [];
    try {
      // Each photo is stored at every width in IMAGE_WIDTHS, as WebP. One
      // unreadable file fails the whole upload, and whatever was already
      // written is removed below.
      const prepared: StoredImage[] = [];
      for (const [index, image] of images.entries()) {
        const renditions = await this.imageProcessor.renditions(
          image.buffer,
          index,
        );
        prepared.push(
          await storeRenditions(this.fileStorage, renditions, (key) =>
            storedKeys.push(key),
          ),
        );
      }

      await this.dataSource.transaction(async (manager) => {
        await lockActiveProduct(manager, productId, 'pessimistic_write');
        const maxOrder = await manager.maximum(ProductImage, 'order', {
          product: { id: productId },
        });
        const firstOrder = (maxOrder ?? -1) + 1;

        await manager.insert(
          ProductImage,
          prepared.map((image, index) => ({
            ...image,
            order: firstOrder + index,
            product: { id: productId },
          })),
        );
      });
    } catch (error) {
      await Promise.all(storedKeys.map((key) => this.fileStorage.delete(key)));
      throw error;
    }

    await this.catalogCache.invalidate(CatalogCacheScope.Products);
    return this.findOne(productId, { includeDrafts: true });
  }

  async removeImage(productId: number, imageId: number): Promise<Product> {
    const removed = await this.dataSource.transaction(async (manager) => {
      await lockActiveProduct(manager, productId, 'pessimistic_write');

      const image = await manager.findOne(ProductImage, {
        select: { id: true, filename: true, order: true, sizes: true },
        where: { id: imageId, product: { id: productId } },
      });
      if (!image) {
        throw new NotFoundException(
          `Image ${imageId} not found on product ${productId}`,
        );
      }

      await manager.delete(ProductImage, { id: image.id });
      await manager
        .createQueryBuilder()
        .update(ProductImage)
        .set({ order: () => '`order` - 1' })
        .where('productId = :productId AND `order` > :removedOrder', {
          productId,
          removedOrder: image.order,
        })
        .orderBy('`order`', 'ASC')
        .execute();

      return image;
    });

    for (const key of storedKeysOf(removed)) {
      await this.fileStorage.delete(key);
    }
    await this.catalogCache.invalidate(CatalogCacheScope.Products);
    return this.findOne(productId, { includeDrafts: true });
  }

  // The product's one video. A new upload replaces the old one; the old
  // file is removed only after the database points at the new one, so a
  // failed upload never leaves the product without its previous video.
  async setVideo(productId: number, video: ValidatedVideo): Promise<Product> {
    if (!(await this.productsRepository.existsBy({ id: productId }))) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const key = `${PRODUCT_VIDEOS_FOLDER}/${productId}-${randomUUID()}.mp4`;
    await this.fileStorage.save(key, video.buffer);

    let previous: string | null = null;
    try {
      previous = await this.dataSource.transaction(async (manager) => {
        await lockActiveProduct(manager, productId, 'pessimistic_write');
        const current = await manager.findOne(Product, {
          select: { id: true, video_filename: true },
          where: { id: productId },
        });
        await manager.update(
          Product,
          { id: productId },
          {
            video_url: this.fileStorage.getPublicUrl(key),
            video_filename: key,
            video_duration_ms: video.durationMs,
            video_size_bytes: video.size,
          },
        );
        return current?.video_filename ?? null;
      });
    } catch (error) {
      await this.fileStorage.delete(key);
      throw error;
    }

    if (previous) await this.fileStorage.delete(previous);
    await this.catalogCache.invalidate(CatalogCacheScope.Products);
    return this.findOne(productId, { includeDrafts: true });
  }

  async removeVideo(productId: number): Promise<Product> {
    const previous = await this.dataSource.transaction(async (manager) => {
      await lockActiveProduct(manager, productId, 'pessimistic_write');
      const current = await manager.findOne(Product, {
        select: { id: true, video_filename: true },
        where: { id: productId },
      });
      if (!current?.video_filename) {
        throw new NotFoundException(`Product ${productId} has no video`);
      }
      await manager.update(
        Product,
        { id: productId },
        {
          video_url: null,
          video_filename: null,
          video_duration_ms: null,
          video_size_bytes: null,
        },
      );
      return current.video_filename;
    });

    await this.fileStorage.delete(previous);
    await this.catalogCache.invalidate(CatalogCacheScope.Products);
    return this.findOne(productId, { includeDrafts: true });
  }

  // Which picture leads: the thumbnail in every listing and the first one
  // on the product page. It was always whichever was uploaded first, and
  // changing it meant deleting every picture and uploading them again.
  async makeCoverImage(productId: number, imageId: number): Promise<Product> {
    await this.dataSource.transaction(async (manager) => {
      await lockActiveProduct(manager, productId, 'pessimistic_write');

      const image = await manager.findOne(ProductImage, {
        select: { id: true, order: true },
        where: { id: imageId, product: { id: productId } },
      });
      if (!image) {
        throw new NotFoundException(
          `Image ${imageId} not found on product ${productId}`,
        );
      }
      if (image.order === 0) return;

      // (product, order) is unique, so it moves in three steps: the new
      // cover steps aside, the ones before it shift down one place -
      // highest first, so no two ever share a place - and it takes 0.
      await manager.update(ProductImage, { id: image.id }, { order: -1 });
      await manager
        .createQueryBuilder()
        .update(ProductImage)
        .set({ order: () => '`order` + 1' })
        .where('productId = :productId AND `order` >= 0 AND `order` < :from', {
          productId,
          from: image.order,
        })
        .orderBy('`order`', 'DESC')
        .execute();
      await manager.update(ProductImage, { id: image.id }, { order: 0 });
    });

    await this.catalogCache.invalidate(CatalogCacheScope.Products);
    return this.findOne(productId, { includeDrafts: true });
  }

  // Bookmarks used to be write-only: rows went in and nothing ever read
  // them back, so a signed-in customer's favourites vanished on refresh.
  async listBookmarkedProductIds(userId: number): Promise<number[]> {
    const rows = await this.dataSource
      .createQueryBuilder(BookmarkProduct, 'bookmark')
      .select('bookmark.product_id', 'productId')
      // Deleted or unpublished products drop out of the list; their ids
      // only produced a row of failed lookups on the favourites page.
      .innerJoin(
        Product,
        'product',
        'product.id = bookmark.product_id AND product.deleted_at IS NULL AND product.is_published = TRUE',
      )
      .where('bookmark.user_id = :userId', { userId })
      .orderBy('bookmark.id', 'DESC')
      .getRawMany<{ productId: number }>();
    return rows.map((row) => Number(row.productId));
  }

  async toggleBookmark(
    userId: number,
    createBookmarkDto: CreateBookmarkDto,
  ): Promise<{ bookmarked: boolean; product: Product | null }> {
    const productId = createBookmarkDto.product_id;

    const bookmarked = await this.dataSource.transaction(async (manager) => {
      const product = await lockActiveProduct(
        manager,
        productId,
        'pessimistic_read',
      );
      await lockUserRow(manager, userId);

      const existing = await manager
        .createQueryBuilder(BookmarkProduct, 'bookmark')
        .select('bookmark.id')
        .where(
          'bookmark.user_id = :userId AND bookmark.product_id = :productId',
          {
            userId,
            productId,
          },
        )
        .getOne();

      if (existing) {
        await manager.delete(BookmarkProduct, { id: existing.id });
        return false;
      }
      // Taking one off is always allowed; a draft cannot be added.
      assertPublished(product);
      await manager.insert(BookmarkProduct, {
        user: { id: userId },
        product: { id: productId },
      });
      return true;
    });

    return {
      bookmarked,
      product: await this.findOne(productId).catch(() => null),
    };
  }

  mergeBasket(userId: number, dto: MergeBasketDto) {
    return this.usersService.mergeBasket(
      userId,
      dto.items.map((line) => ({
        productId: line.product_id,
        quantity: line.quantity,
      })),
    );
  }

  addProductToBasket(userId: number, dto: BasketItemDto) {
    return this.usersService.addProductToBasket(
      userId,
      dto.product_id,
      dto.quantity,
    );
  }

  removeProductFromBasket(userId: number, dto: BasketItemDto) {
    return this.usersService.removeProductFromBasket(
      userId,
      dto.product_id,
      dto.quantity,
    );
  }

  getUserBasket(userId: number) {
    return this.usersService.getUserBasket(userId);
  }

  // Values of one attribute are an OR ("black or white"); different
  // attributes are an AND ("black AND 256 GB"). Each attribute becomes its
  // own EXISTS, which is also what keeps the query from multiplying rows the
  // way a chain of joins would.
  private async applyAttributeFilter(
    qb: SelectQueryBuilder<Product>,
    optionIds: number[],
    known?: Map<number, number>,
  ): Promise<void> {
    const attributeOf = new Map(known ?? []);
    const unknown = optionIds.filter((id) => !attributeOf.has(id));
    if (unknown.length > 0) {
      const options = await this.dataSource
        .getRepository(AttributeOption)
        .find({ where: { id: In(unknown) }, relations: { attribute: true } });
      for (const option of options) {
        attributeOf.set(option.id, option.attribute.id);
      }
    }
    const resolved = optionIds.filter((id) => attributeOf.has(id));
    if (resolved.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }

    const groups = new Map<number, number[]>();
    for (const optionId of resolved) {
      const attributeId = attributeOf.get(optionId)!;
      const list = groups.get(attributeId) ?? [];
      list.push(optionId);
      groups.set(attributeId, list);
    }

    let index = 0;
    for (const ids of groups.values()) {
      const parameter = `productAttrOptions${index++}`;
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM \`product_attribute_values\` pav
          WHERE pav.\`product_id\` = product.id
            AND pav.\`option_id\` IN (:...${parameter})
        )`,
        { [parameter]: ids },
      );
    }
  }

  // What the filter panel shows next to each value: how many products
  // would be left if the shopper also picked it. Counted against the
  // filters already applied, minus the attribute being counted - so
  // choosing "black" does not make every other colour read zero.
  async facets(query: FilterProductDto): Promise<ProductFacet[]> {
    const attributes = await this.dataSource.getRepository(Attribute).find({
      where: { is_filterable: true },
      relations: { options: true },
      order: { sort_order: 'ASC', id: 'ASC' },
    });

    // Looked up once here rather than inside every count. Counting used to
    // run the whole listing - rows, categories and these lookups - once per
    // option: 100+ statements for one filter panel.
    const optionMeta = new Map<number, number>();
    for (const attribute of attributes) {
      for (const option of attribute.options ?? []) {
        optionMeta.set(option.id, attribute.id);
      }
    }
    const selected = query.attributeOptions ?? [];
    const missing = selected.filter((id) => !optionMeta.has(id));
    if (missing.length > 0) {
      const extra = await this.dataSource.getRepository(AttributeOption).find({
        where: { id: In(missing) },
        relations: { attribute: true },
      });
      for (const option of extra) {
        optionMeta.set(option.id, option.attribute.id);
      }
    }
    const context: FilterContext = {
      optionMeta,
      categoryIds: query.categoryId
        ? await this.categoriesService.getDescendantIds(query.categoryId)
        : undefined,
    };

    const result: ProductFacet[] = [];
    for (const attribute of attributes) {
      const others = selected.filter(
        (id) => optionMeta.get(id) !== attribute.id,
      );

      const options: ProductFacetOption[] = [];
      for (const option of (attribute.options ?? []).sort(
        (a, b) => a.sort_order - b.sort_order || a.id - b.id,
      )) {
        const count = await this.countForOptions(
          query,
          [...others, option.id],
          context,
        );
        options.push({
          optionId: option.id,
          value: option.value,
          slug: option.slug,
          hex: option.hex ?? null,
          count,
        });
      }

      if (options.some((option) => option.count > 0)) {
        result.push({
          attributeId: attribute.id,
          title: attribute.title,
          code: attribute.code,
          type: attribute.type,
          options,
        });
      }
    }
    return result;
  }

  // One COUNT, nothing else: no rows, no ordering, no category lookups.
  private async countForOptions(
    query: FilterProductDto,
    optionIds: number[],
    context: FilterContext,
  ): Promise<number> {
    const qb = this.productsRepository
      .createQueryBuilder('product')
      .where('product.is_published = TRUE');
    const matches = await this.applyFilters(
      qb,
      { ...query, attributeOptions: optionIds },
      context,
    );
    return matches ? qb.getCount() : 0;
  }

  // "You might also like": other products from the same categories,
  // preferring the same brand, ordered by what actually sells.
  //
  // Deliberately plain SQL on data the shop already has - a
  // recommendation engine would be a different project, and this is the
  // part of one that earns its keep on a product page.
  async related(productId: number, limit = 8): Promise<Product[]> {
    const product = await this.productsRepository.findOne({
      where: { id: productId },
      relations: { categories: true, brand: true },
    });
    if (!product) {
      throw new NotFoundException(`Product with id ${productId} not found`);
    }

    const categoryIds = (product.categories ?? []).map(
      (category) => category.id,
    );
    const qb = this.productsRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.brand', 'brand')
      // The same cover the listing serves; without it every card in "you
      // might also like" rendered as a broken image.
      .leftJoinAndMapOne(
        'product.coverImage',
        'product.images',
        'cover',
        'cover.order = 0',
      )
      .where('product.id != :productId', { productId })
      .andWhere('product.deleted_at IS NULL')
      .andWhere('product.is_published = 1');

    if (categoryIds.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM \`product_category\` pc
          WHERE pc.\`product_id\` = product.id
            AND pc.\`category_id\` IN (:...categoryIds)
        )`,
        { categoryIds },
      );
    } else if (product.brand) {
      qb.andWhere('product.brand_id = :brandId', { brandId: product.brand.id });
    } else {
      // Nothing to be related to.
      return [];
    }

    if (product.brand) {
      qb.addSelect(
        'CASE WHEN product.brand_id = :sameBrand THEN 1 ELSE 0 END',
        'same_brand',
      ).setParameter('sameBrand', product.brand.id);
      qb.orderBy('same_brand', 'DESC').addOrderBy(
        'product.sales_count',
        'DESC',
      );
    } else {
      qb.orderBy('product.sales_count', 'DESC');
    }

    const items = await qb
      .addOrderBy('product.rating_avg', 'DESC')
      .addOrderBy('product.id', 'DESC')
      .limit(limit)
      .getMany();

    await this.attachCategories(items);
    return items;
  }

  private async attachCategories(products: Product[]): Promise<void> {
    if (products.length === 0) {
      return;
    }
    const rows = await this.productsRepository.find({
      select: { id: true, categories: { id: true, title: true } },
      where: { id: In(products.map((product) => product.id)) },
      relations: { categories: true },
    });
    const categoriesByProduct = new Map(
      rows.map((row) => [row.id, row.categories]),
    );
    for (const product of products) {
      product.categories = categoriesByProduct.get(product.id) ?? [];
      product.coverImage = product.coverImage ?? null;
    }
  }

  private async lockActiveCategories(
    manager: EntityManager,
    categoryIds: number[],
  ): Promise<Category[]> {
    const ids = [...new Set(categoryIds)];
    if (ids.length === 0) {
      return [];
    }
    const categories = await manager.find(Category, {
      select: { id: true, title: true },
      where: { id: In(ids) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    if (categories.length !== ids.length) {
      throw new BadRequestException('One or more category IDs are invalid');
    }
    return categories;
  }
}
