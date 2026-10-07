const express = require('express');
const router = express.Router();
const {
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  verifyPayment,
  refundPayment,
} = require('../controllers/paymentController');

router.get('/', getPayments);
router.post('/', createPayment);
router.get('/:id', getPaymentById);
router.patch('/:id', updatePayment);
router.patch('/:id/status', updatePayment);
router.post('/:id/verify', verifyPayment);
router.post('/:id/refund', refundPayment);

module.exports = router;
