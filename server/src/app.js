import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { log } from './lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '../../client/dist');

/**
 * Builds the Express app without starting it, so it can be mounted in tests
 * or behind a different server.
 *
 * In production this serves the built client from the SAME ORIGIN as the API.
 * That is a deliberate choice for a two-person app split across continents:
 *   - No CORS preflight. At ~300ms RTT an extra round trip on every mutating
 *     request is a visible cost.
 *   - The refresh cookie stays `SameSite=Strict`. Cross-site would force
 *     `SameSite=None`, which is strictly weaker.
 *   - One TLS handshake, one certificate, one thing to deploy.
 */
export function createApp() {
  const app = express();

  // Behind a proxy, req.ip must resolve to the real client or the rate limits
  // key every user to the proxy's address.
  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // The app is a bundled SPA with no inline scripts, but styles are injected
    // at runtime by the theme system, so style-src has to allow inline.
    contentSecurityPolicy: env.isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    } : false,
  }));

  // Matters more than usual here: bandwidth, not CPU, is the constraint on a
  // long-haul mobile link.
  app.use(compression());

  // Only needed when the client is served from somewhere else — i.e. the Vite
  // dev server. Same-origin production needs no CORS at all.
  if (!env.isProd) {
    app.use(cors({ origin: env.clientOrigin, credentials: true }));
    app.use(morgan('dev'));
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(`/${env.uploadDir}`, express.static(env.uploadDir, { maxAge: '7d' }));
  app.use('/api', routes);

  const hasClientBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

  if (hasClientBuild) {
    // Hashed assets are immutable and can be cached hard; index.html must not
    // be, or a deploy leaves people on the old bundle.
    app.use(express.static(CLIENT_DIST, {
      maxAge: '1y',
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));

    // SPA fallback — client-side routes like /chat/:id must return index.html.
    // Registered after /api so it can never swallow an API 404.
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  } else if (env.isProd) {
    log.warn(`No client build at ${CLIENT_DIST} — serving the API only. Run "npm run build".`);
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
