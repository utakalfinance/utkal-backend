const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const env = require('./config/env');
const connectDB = require('./config/db');

const app = express();

// CORS Configuration
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/+$/, '');
      if (env.ALLOWED_ORIGINS.includes(cleanOrigin) || !env.IS_PROD) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy violation: origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);

// Request Body Parsing Middleware (Allow higher limits for KYC base64 images and documents)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory exists on server launch
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads/documents');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve Uploaded Files Statically with cross-origin headers
app.use(
  '/uploads',
  cors(),
  express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })
);

// Test Route: GET /
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'New Utkal Finance API is running',
  });
});

const applicationRoutes = require('./routes/applicationRoutes');
const memberRoutes = require('./routes/memberRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const authRoutes = require('./routes/authRoutes');
const profileUpdateRoutes = require('./routes/profileUpdateRoutes');

// Health Check Route: GET /api/health
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({
    success: true,
    message: 'New Utkal Finance backend is healthy',
    database: dbStatus,
  });
});

// API Routes
app.use('/api/applications', applicationRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/profile-updates', profileUpdateRoutes);

// Serve Frontend Production Build if present on Hostinger
const clientDistPaths = [
  path.join(__dirname, '../frontend/dist'),
  path.join(__dirname, 'dist'),
  path.join(__dirname, 'public'),
];

let activeDistPath = null;
for (const p of clientDistPaths) {
  if (fs.existsSync(p)) {
    activeDistPath = p;
    break;
  }
}

if (activeDistPath) {
  console.log(`Serving static frontend build from: ${activeDistPath}`);
  app.use(express.static(activeDistPath));
  // Fallback to index.html for React SPA routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(activeDistPath, 'index.html'));
  });
}

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Something went wrong',
  });
});

const PORT = env.PORT;

// Start Express server only after MongoDB connection succeeds
const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running in ${env.NODE_ENV} mode on port ${PORT}`);
  });
};

startServer();


