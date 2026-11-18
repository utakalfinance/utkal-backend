const mongoose = require('mongoose');
const env = require('./env');

let retryTimeout = null;

const connectDB = async () => {
  // Prevent duplicate listeners on reconnect
  mongoose.connection.removeAllListeners('connected');
  mongoose.connection.removeAllListeners('disconnected');
  mongoose.connection.removeAllListeners('error');

  mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected successfully to database');
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB connection disconnected. Attempting to reconnect...');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err.message);
  });

  try {
    await mongoose.connect(env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error(`❌ MongoDB connection failed: ${error.message}`);
    if (error.message.includes('ECONNREFUSED')) {
      console.warn(
        '\n💡 [MongoDB Troubleshooting]\n' +
        '   Local MongoDB server is NOT running on port 27017.\n' +
        '   To start it, choose one of these options:\n' +
        '   1. Open cmd as Administrator and run: net start MongoDB\n' +
        '   2. Open Windows Services (services.msc) and Start "MongoDB Server (MongoDB)"\n' +
        '   3. Or switch MONGO_URI in backend/.env to your MongoDB Atlas cloud database URI.\n' +
        '   Backend server is still running and will retry connecting in the background...\n'
      );
    }
    // Schedule background retry every 8 seconds instead of killing process
    if (!retryTimeout) {
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        connectDB().catch(() => {});
      }, 8000);
    }
  }
};

module.exports = connectDB;

