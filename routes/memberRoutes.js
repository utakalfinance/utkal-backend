const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getMembers,
  getMemberById,
  updateMemberStatus,
  getMemberLoanOverview,
  getAvailableLoans,
  getMemberLoanHistory,
} = require('../controllers/memberController');

// GET /api/members/loan-overview - Fetch loan overview for authenticated member
router.get('/loan-overview', protect, getMemberLoanOverview);

// GET /api/members/available-loans - Fetch available loan offerings for authenticated member
router.get('/available-loans', protect, getAvailableLoans);

// GET /api/members/loan-history - Fetch real loan history records for authenticated member
router.get('/loan-history', protect, getMemberLoanHistory);

// GET /api/members - Get all real approved members from MongoDB
router.get('/', getMembers);

// GET /api/members/:id - Get single member details
router.get('/:id', getMemberById);

// PATCH /api/members/:id/status - Update member active/inactive status
router.patch('/:id/status', updateMemberStatus);

module.exports = router;

