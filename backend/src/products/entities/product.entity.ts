import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { BookmarkProduct } from './product-bookmark.entity';
import { Comment } from '../../comments/entities/comment.entity';
import { OrderItem } from '../../orders/entities/order-item.entity';
import { BasketItem } from '../../users/entities/basket-item.entity';
import { ProductImage } from './product-image.entity';
import { ProductAttributeValue } from '../../attributes/entities/product-attribute-value.entity';
import { Brand } from '../../brands/entities/brand.entity';

@Entity('products')
@Index('IDX_products_title_fulltext', ['title'], { fulltext: true })
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  title!: string;

  @Column({ nullable: false })
  description!: string;

  @Column({ nullable: false, unsigned: true })
  price!: number;

  // Units on hand. Checkout takes from it under a row lock, cancellations
  // and accepted returns give back to it.
  @Column({ nullable: false, unsigned: true })
  stock!: number;

  @Column({ type: 'varchar', length: 190 })
  slug!: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  sale_price?: number | null;

  @Column({ type: 'datetime', nullable: true })
  sale_starts_at?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  sale_ends_at?: Date | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  rating_avg!: string | number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  rating_count!: number;

  // How many units have actually been sold, maintained when an order is
  // paid and given back when one is cancelled. Kept here rather than
  // summed from order lines on every request: "best selling" is a sort
  // on a listing page, and that has to be one indexed read.
  @Index('IDX_product_sales_count', ['sales_count'])
  @Column({ type: 'int', unsigned: true, default: 0 })
  sales_count!: number;

  // Descriptive properties: screen size, colour, storage. They filter and
  // display. A product is one thing with one price and one stock count -
  // a second colour or capacity is a product of its own.
  @OneToMany(() => ProductAttributeValue, (value) => value.product)
  attributeValues!: ProductAttributeValue[];

  @Column({ type: 'int', unsigned: true, default: 0 })
  weight_grams!: number;

  // One short video (at most 30 seconds, H.264 MP4), shown in the gallery
  // next to the photos. All four are NULL when the product has none.
  @Column({ type: 'varchar', length: 500, nullable: true })
  video_url!: string | null;

  // The storage key, for deleting the file when it is replaced or removed.
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  video_filename!: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  video_duration_ms!: number | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  video_size_bytes!: number | null;

  @Column({ type: 'boolean', default: true })
  is_published!: boolean;

  @ManyToOne(() => Brand, (brand) => brand.products, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'brand_id',
    foreignKeyConstraintName: 'FK_products_brand',
  })
  brand?: Brand | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deleted_at?: Date;

  @ManyToMany(() => Category, (category) => category.products)
  @JoinTable({
    name: 'product_category',
    joinColumn: {
      name: 'product_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'category_id',
      referencedColumnName: 'id',
    },
  })
  categories!: Category[];

  // Unique among live rows only: a deleted product must not hold its slug
  // forever.
  @Index('UQ_products_active_slug', { unique: true })
  @Column({
    type: 'varchar',
    length: 190,
    nullable: true,
    asExpression: 'IF(`deleted_at` IS NULL, `slug`, NULL)',
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
  })
  active_slug?: string | null;

  @OneToMany(() => BasketItem, (basketItem) => basketItem.product)
  basket_items!: BasketItem[];

  @OneToMany(() => BookmarkProduct, (b) => b.product)
  bookmarks!: BookmarkProduct[];

  @OneToMany(() => Comment, (c) => c.product)
  comments!: Comment[];

  @OneToMany(() => OrderItem, (item) => item.product)
  order_items!: OrderItem[];

  @OneToMany(() => ProductImage, (image) => image.product)
  images!: ProductImage[];

  coverImage?: ProductImage | null;

  effectivePrice(at: Date = new Date()): number {
    if (this.sale_price === null || this.sale_price === undefined) {
      return Number(this.price);
    }
    if (this.sale_starts_at && at < this.sale_starts_at) {
      return Number(this.price);
    }
    if (this.sale_ends_at && at > this.sale_ends_at) {
      return Number(this.price);
    }
    return Number(this.sale_price);
  }
}
