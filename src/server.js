// server.js
require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');

const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/czyziumakro';

let server;

// Połącz z MongoDB, dopiero potem odpal HTTP
(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✅ MongoDB connected: ${MONGO_URI}`);

    server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`🚀 CzyziuMakro API listening on port ${PORT}`);
    });

    server.on('error', (err) => {
      console.error('❌ HTTP server error:', err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
})();

// Graceful shutdown
const shutdown = async (signal) => {
  try {
    console.log(`\n🛑 Received ${signal}. Closing server...`);
    if (server) {
      await new Promise((res) => server.close(res));
      console.log('🧰 HTTP server closed.');
    }
    await mongoose.connection.close();
    console.log('🗄️ MongoDB connection closed.');
  } catch (e) {
    console.error('⚠️ Error during shutdown:', e.message);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  shutdown('uncaughtException');
});
