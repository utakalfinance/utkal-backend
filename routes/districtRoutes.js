const express = require('express');
const router = express.Router();
const {
  getDistricts,
  getDistrictById,
  createDistrict,
  updateDistrict,
  updateDistrictStatus,
  deleteDistrict,
} = require('../controllers/districtController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Super Admin protected endpoints
router.get('/', protect, authorize('admin'), getDistricts);
router.get('/:id', protect, authorize('admin'), getDistrictById);
router.post('/', protect, authorize('admin'), createDistrict);
router.put('/:id', protect, authorize('admin'), updateDistrict);
router.patch('/:id/status', protect, authorize('admin'), updateDistrictStatus);
router.delete('/:id', protect, authorize('admin'), deleteDistrict);

module.exports = router;
