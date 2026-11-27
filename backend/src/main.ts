import './instrument';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

function basicAuth(username: string, password: string) {
  const compare = (given: string, expected: string): boolean => {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      // Split at the first colon only: a password may contain one.
      const decoded = Buffer.from(encoded, 'base64').toString();
      const colon = decoded.indexOf(':');
      const user = colon >= 0 ? decoded.slice(0, colon) : '';
      const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
      if (user && pass && compare(user, username) && compare(pass, password)) {
        return next();
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="API documentation"');
    res.status(401).send('Authentication required');
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // HTTPS-only, security headers, CORS, uploads, validation: app.setup.ts.
  configureApp(app);

  const isProduction = process.env.NODE_ENV === 'production';
  // Unset or empty: on outside production, off in it.
  const swaggerEnabled =
    (process.env.SWAGGER_ENABLED || (isProduction ? 'false' : 'true')) ===
    'true';
  if (swaggerEnabled) {
    const docsUser = process.env.SWAGGER_USER;
    const docsPassword = process.env.SWAGGER_PASSWORD;
    if (docsUser && docsPassword) {
      app.use(
        ['/api/docs', '/api/docs-json'],
        basicAuth(docsUser, docsPassword),
      );
    }

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Maraton Parts API')
      .setDescription('API documentation for the online shop backend')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    // Off in production unless asked for, and behind basic auth when
    // credentials are configured: the docs are a map of every route and DTO.
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  // In production only nginx, on this same machine, talks to the API: bound
  // to 127.0.0.1 the port is unreachable from outside even without a
  // firewall, so nobody can go around HTTPS and the proxy. HOST overrides it
  // (0.0.0.0 inside a container, for example).
  const host = process.env.HOST || (isProduction ? '127.0.0.1' : undefined);
  if (host) {
    await app.listen(process.env.PORT ?? 3000, host);
  } else {
    await app.listen(process.env.PORT ?? 3000);
  }
}
bootstrap();
