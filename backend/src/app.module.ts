import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { envValidationSchema } from './config/env.validation';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RateLimit } from './common/throttler/rate-limit.entity';
import { DatabaseThrottlerStorage } from './common/throttler/database-throttler.storage';
import { phoneThrottler } from './common/throttler/phone-throttle';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@sentry/nestjs/setup';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HealthModule } from './health/health.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AddressModule } from './address/address.module';
import { TicketsModule } from './tickets/tickets.module';
import { ProductsModule } from './products/products.module';
import { ShopModule } from './shop/shop.module';
import { CategoriesModule } from './categories/categories.module';
import { BrandsModule } from './brands/brands.module';
import { ShippingModule } from './shipping/shipping.module';
import { AttributesModule } from './attributes/attributes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { ReturnsModule } from './returns/returns.module';
import { ReportsModule } from './reports/reports.module';
import { OrdersModule } from './orders/orders.module';
import { CommentsModule } from './comments/comments.module';
import { DiscountCodesModule } from './discount-codes/discount-codes.module';
import { WalletsModule } from './wallets/wallets.module';
import { PaymentsModule } from './payments/payments.module';
import { CatalogCacheModule } from './common/cache/catalog-cache.module';
import { StorageModule } from './common/storage/storage.module';
import { InitialSchema1789600000000 } from './migrations/1789600000000-InitialSchema';
import { Phase2DataIntegrity1789624094221 } from './migrations/1789624094221-Phase2DataIntegrity';
import { Phase3PaymentIntegrity1789712004311 } from './migrations/1789712004311-Phase3PaymentIntegrity';
import { Phase4DeploymentHardening1789800000000 } from './migrations/1789800000000-Phase4DeploymentHardening';
import { SessionHardening1789900000000 } from './migrations/1789900000000-SessionHardening';
import { CatalogFoundation1790000000000 } from './migrations/1790000000000-CatalogFoundation';
import { ProductVariants1790100000000 } from './migrations/1790100000000-ProductVariants';
import { ShippingAndTax1790200000000 } from './migrations/1790200000000-ShippingAndTax';
import { InvoicesAndCashOnDelivery1790300000000 } from './migrations/1790300000000-InvoicesAndCashOnDelivery';
import { OrderNotifications1790400000000 } from './migrations/1790400000000-OrderNotifications';
import { ReturnsAndAudit1790500000000 } from './migrations/1790500000000-ReturnsAndAudit';
import { RichDiscountCodes1790600000000 } from './migrations/1790600000000-RichDiscountCodes';
import { ProductAttributes1790700000000 } from './migrations/1790700000000-ProductAttributes';
import { AccountsBestSellersRelated1790800000000 } from './migrations/1790800000000-AccountsBestSellersRelated';
import { TokensValidAfter1790900000000 } from './migrations/1790900000000-TokensValidAfter';
import { RetireVariantsOfDeletedProducts1791000000000 } from './migrations/1791000000000-RetireVariantsOfDeletedProducts';
import { ProductImageSizes1791100000000 } from './migrations/1791100000000-ProductImageSizes';
import { RemoveProductVariants1791200000000 } from './migrations/1791200000000-RemoveProductVariants';
import { ProductVideo1791300000000 } from './migrations/1791300000000-ProductVideo';
import { LoginLockouts1791400000000 } from './migrations/1791400000000-LoginLockouts';
import { AdminTwoFactor1791500000000 } from './migrations/1791500000000-AdminTwoFactor';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        // The refresh token rides in a cookie both ways: the browser sends
        // it back in `cookie` and login/refresh hand out a new one in
        // `set-cookie`. Logged as-is, every request line carried a 30-day
        // session anyone with read access to the logs could replay.
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        autoLogging: true,
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [TypeOrmModule.forFeature([RateLimit])],
      inject: [ConfigService, DataSource],
      useFactory: (configService: ConfigService, dataSource: DataSource) => ({
        // The site-wide cap is per IP and deliberately loose (see
        // phone-throttle.ts); the tight limits live on the routes that
        // need them.
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: configService.get<number>('THROTTLE_LIMIT_PER_MINUTE', 600),
          },
          phoneThrottler,
        ],
        ...(configService.get<string>('THROTTLE_STORAGE') === 'database'
          ? { storage: new DatabaseThrottlerStorage(dataSource) }
          : {}),
      }),
    }),
    ScheduleModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      ttl: 60000,
    }),
    CatalogCacheModule,
    StorageModule,
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT!,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
      migrations: [
        InitialSchema1789600000000,
        Phase2DataIntegrity1789624094221,
        Phase3PaymentIntegrity1789712004311,
        Phase4DeploymentHardening1789800000000,
        SessionHardening1789900000000,
        CatalogFoundation1790000000000,
        ProductVariants1790100000000,
        ShippingAndTax1790200000000,
        InvoicesAndCashOnDelivery1790300000000,
        OrderNotifications1790400000000,
        ReturnsAndAudit1790500000000,
        RichDiscountCodes1790600000000,
        ProductAttributes1790700000000,
        AccountsBestSellersRelated1790800000000,
        TokensValidAfter1790900000000,
        RetireVariantsOfDeletedProducts1791000000000,
        ProductImageSizes1791100000000,
        RemoveProductVariants1791200000000,
        ProductVideo1791300000000,
        LoginLockouts1791400000000,
        AdminTwoFactor1791500000000,
      ],
      migrationsRun: process.env.NODE_ENV !== 'production',
      extra: {
        connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
      },
      retryAttempts: 3,
      retryDelay: 3000,
    }),
    HealthModule,
    CleanupModule,
    UsersModule,
    AuthModule,
    AddressModule,
    TicketsModule,
    ProductsModule,
    ShopModule,
    CategoriesModule,
    BrandsModule,
    ShippingModule,
    AttributesModule,
    NotificationsModule,
    AuditModule,
    ReturnsModule,
    ReportsModule,
    OrdersModule,
    CommentsModule,
    DiscountCodesModule,
    WalletsModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
  exports: [UsersModule],
})
export class AppModule {}
