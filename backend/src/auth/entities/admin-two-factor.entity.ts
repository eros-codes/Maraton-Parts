import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

// An admin's second factor: the authenticator app's secret, encrypted (see
// secret-box.ts). A row with only `pending_secret` is a setup in progress;
// `enabled_at` set means every sign-in needs a code.
@Entity('admin_two_factor')
export class AdminTwoFactor {
  @PrimaryColumn({ type: 'int' })
  user_id!: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_two_factor_user',
  })
  user?: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  secret!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pending_secret!: string | null;

  @Column({ type: 'datetime', nullable: true })
  enabled_at!: Date | null;

  // The 30-second step of the last code accepted; that code and every
  // earlier one are refused from then on.
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  last_used_step!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
