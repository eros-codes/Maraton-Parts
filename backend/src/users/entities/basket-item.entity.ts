import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Product } from '../../products/entities/product.entity';

// One line per (user, product): adding the same product again raises the
// quantity rather than opening a second line.
@Unique('UQ_basket_user_product', ['user', 'product'])
@Entity('basket_items')
export class BasketItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (user) => user.basket_items, { onDelete: 'CASCADE' })
  user!: User;

  @ManyToOne(() => Product, (product) => product.basket_items, {
    onDelete: 'CASCADE',
  })
  product!: Product;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
