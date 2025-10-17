// src/config/db.js
const mongoose = require('mongoose');

let isConnected = false;
let mongod = null; // in-memory instance (mongodb-memory-server), jeśli użyta

function log(...args) {
  if (process.env.NODE_ENV !== 'test') console.log(...args);
}

async function connectWithUri(uri, dbNameFromEnv) {
  // Nie wymuszaj dbName jeśli nie trzeba – najlepiej wstawić nazwę bazy w samym URI.
  // Jeśli jednak chcesz nadpisać z env, to tylko wtedy użyj dbName:
  const opts = {};
  if (dbNameFromEnv) opts.dbName = dbNameFromEnv;

  await mongoose.connect(uri, opts);
  isConnected = true;
  log('✅ MongoDB connected');
}

async function connectDB() {
  if (isConnected) return;

  const WANT_MEMORY = (process.env.MONGO_URI || '').toLowerCase() === 'memory';
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/czyziumakro';
  const dbName = process.env.MONGO_DB_NAME || ''; // opcjonalne nadpisanie nazwy bazy

  mongoose.set('strictQuery', true);

  if (WANT_MEMORY) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    const memUri = mongod.getUri();
    await connectWithUri(memUri);
    log('🧠 Using in-memory MongoDB');
    return;
  }

  try {
    await connectWithUri(uri, dbName || undefined);
  } catch (err) {
    const allowFallback = (process.env.ALLOW_MEMORY_DB || 'true').toLowerCase() !== 'false';
    const isConnRefused =
      err?.message?.includes('ECONNREFUSED') ||
      err?.code === 'ECONNREFUSED' ||
      err?.name === 'MongoServerSelectionError';

    if (process.env.NODE_ENV === 'development' && allowFallback && isConnRefused) {
      console.warn('⚠️ Mongo not reachable, starting in-memory MongoDB for DEV...');
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongod = await MongoMemoryServer.create();
      const memUri = mongod.getUri();
      await connectWithUri(memUri);
      log('🧠 Using in-memory MongoDB (DEV fallback)');
      return;
    }

    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }

  // Graceful shutdown
  mongoose.connection.on('error', (e) => console.error('MongoDB error:', e));
  const cleanup = async () => {
    try {
      await disconnectDB();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
}

async function disconnectDB() {
  if (isConnected) {
    await mongoose.connection.close();
    isConnected = false;
    log('🛑 MongoDB connection closed');
  }
  if (mongod) {
    await mongod.stop();
    mongod = null;
    log('🧽 In-memory MongoDB stopped');
  }
}

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;
