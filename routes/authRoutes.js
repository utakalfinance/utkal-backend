const express = require('express');
const router = express.Router();
const {
  loginUser,
  getMe,
  changePassword,
  updateProfile,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/auth/member-login - Member Login API (accepts Member ID or Email + Password)
router.post('/member-login', loginUser);

// POST /api/auth/login - Universal Login API
router.post('/login', loginUser);

// GET /api/auth/me - Authenticated Member Profile & Application Info
router.get('/me', protect, getMe);

// PUT /api/auth/profile - Update Member Profile
router.put('/profile', protect, updateProfile);

// POST /api/auth/change-password - Member Password Change
router.post('/change-password', protect, changePassword);

module.exports = router;
