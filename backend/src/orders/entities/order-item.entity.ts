import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';
import { bigintTransformer } from '../../common/database/bigint.transformer';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @ManyToOne(() => Product, (product) => product.order_items)
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({
    type: 'bigint',
    transformer: bigintTransformer,
  })
  price!: number;

  @Column({ type: 'int' })
  quantity!: number;

  // Read-only history. Before products stopped having options, a line
  // recorded which option was sold ("مشکی / 256"); orders placed back then
  // still show it on their invoice. Nothing writes it any more.
  @Column({ type: 'varchar', length: 120, nullable: true })
  variant_title?: string | null;
}
