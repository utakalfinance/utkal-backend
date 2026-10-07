const express = require('express');
const router = express.Router();
const {
  getProfileUpdateRequests,
  getProfileUpdateRequestById,
  approveProfileUpdateRequest,
  rejectProfileUpdateRequest,
} = require('../controllers/profileUpdateController');

// GET /api/profile-updates - Get all profile update requests
router.get('/', getProfileUpdateRequests);

// GET /api/profile-updates/:id - Get single request details
router.get('/:id', getProfileUpdateRequestById);

// PATCH /api/profile-updates/:id/approve - Approve request and apply changes
router.patch('/:id/approve', approveProfileUpdateRequest);

// PATCH /api/profile-updates/:id/reject - Reject request
router.patch('/:id/reject', rejectProfileUpdateRequest);

module.exports = router;
