import mongoose from 'mongoose';
import { env } from './env.js';
import { log } from '../lib/logger.js';

let memoryServer = null;

/**
 * Connects to MongoDB.
 *
 * With no MONGO_URI set we boot `mongodb-memory-server`: a real MongoDB binary
 * managed in-process. This is what makes `npm run dev` work on a machine with
 * no Docker and no local mongod. Data is lost on restart, which is fine for
 * development and unacceptable for anything else — hence the production guard.
 */
export async function connectDb() {
  let uri = env.mongoUri;

  if (!uri) {
    if (env.isProd) {
      throw new Error('MONGO_URI is required in production');
    }
    log.warn('No MONGO_URI set — starting an in-memory MongoDB (data is not persisted)');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('halo');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  log.info(`MongoDB connected (${memoryServer ? 'in-memory' : 'external'})`);
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
