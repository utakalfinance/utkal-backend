const express = require('express');
const router = express.Router();
const {
  createLoanEnquiry,
  getLoanEnquiries,
  getLoanEnquiryById,
  updateLoanEnquiryStatus,
} = require('../controllers/loanEnquiryController');
const { protect, authorize } = require('../middleware/authMiddleware');

// POST /api/loan-enquiries - Public visitor loan interest submission (Unprotected)
router.post('/', createLoanEnquiry);

// GET /api/loan-enquiries - Fetch all enquiries with real summary counts (Admin Protected)
router.get('/', protect, authorize('admin'), getLoanEnquiries);

// GET /api/loan-enquiries/:id - Fetch single enquiry details (Admin Protected)
router.get('/:id', protect, authorize('admin'), getLoanEnquiryById);

// PATCH /api/loan-enquiries/:id/status - Update enquiry status & remarks (Admin Protected)
router.patch('/:id/status', protect, authorize('admin'), updateLoanEnquiryStatus);

// PATCH /api/loan-enquiries/:id - Alias update endpoint (Admin Protected)
router.patch('/:id', protect, authorize('admin'), updateLoanEnquiryStatus);

module.exports = router;
