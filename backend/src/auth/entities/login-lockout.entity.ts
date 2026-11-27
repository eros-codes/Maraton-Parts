import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Failed password sign-ins per mobile number, kept in the database so a
// restart (or a second instance) does not hand an attacker a fresh set of
// guesses. Keyed by the number as typed, account or not - a lock on a
// number nobody uses looks exactly like a lock on a real account, so this
// cannot be used to find out who is registered.
@Entity('login_lockouts')
export class LoginLockout {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  mobile!: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  failed_attempts!: number;

  @Column({ type: 'datetime' })
  window_started_at!: Date;

  @Column({ type: 'datetime', nullable: true })
  locked_until!: Date | null;

  // How many times this number has been locked in a row; each lock lasts
  // longer than the one before (15 min, 30 min, 1 h ... up to 24 h).
  @Column({ type: 'int', unsigned: true, default: 0 })
  lock_count!: number;

  @UpdateDateColumn()
  updated_at!: Date;
}
