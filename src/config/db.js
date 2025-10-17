// src/config/db.js
const mongoose = require('mongoose');

let isConnected = false;

async function connectWithUri(uri) {
  await mongoose.connect(uri, { dbName: uri.split('/').pop() || 'czyziumakro' });
  isConnected = true;
  if (process.env.NODE_ENV !== 'test') {
    console.log('MongoDB connected:', uri);
  }
}

async function connectDB() {
  if (isConnected) return;

  const WANT_MEMORY = (process.env.MONGO_URI || '').toLowerCase() === 'memory';
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/czyziumakro';

  mongoose.set('strictQuery', true);

  if (WANT_MEMORY) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mem = await MongoMemoryServer.create();
    const memUri = mem.getUri();
    await connectWithUri(memUri);
    return;
  }

  try {
    await connectWithUri(uri);
  } catch (err) {
    const allowFallback = (process.env.ALLOW_MEMORY_DB || 'true').toLowerCase() !== 'false';
    const isConnRefused = err?.message?.includes('ECONNREFUSED') || err?.code === 'ECONNREFUSED';

    if (process.env.NODE_ENV === 'development' && allowFallback && isConnRefused) {
      console.warn('Mongo not reachable, starting in-memory MongoDB for DEV...');
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mem = await MongoMemoryServer.create();
      const memUri = mem.getUri();
      await connectWithUri(memUri);
      return;
    }

    console.error('MongoDB connection error:', err.message);
    throw err;
  }
}

module.exports = connectDB;
