const Payment = require('../models/Payment');

/**
 * Generate a unique sequential Payment ID in format PAY-1001, PAY-1002, etc.
 * Uses index-accelerated latest record lookup instead of full collection scan.
 */
async function generatePaymentId(preferredDigits = null) {
  if (preferredDigits) {
    const candidateId = `PAY-${preferredDigits}`;
    const exists = await Payment.findOne({ paymentId: candidateId }).select('_id').lean();
    if (!exists) {
      return candidateId;
    }
  }

  // Fast single-record fetch sorted descending
  const latestPayment = await Payment.findOne({ paymentId: /^PAY-\d+$/ })
    .sort({ paymentId: -1 })
    .select('paymentId')
    .lean();

  let maxNum = 1000;
  if (latestPayment && latestPayment.paymentId) {
    const match = latestPayment.paymentId.match(/PAY-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }

  let nextNumber = maxNum + 1;
  let isUnique = false;
  let candidateId = '';
  let attempts = 0;

  while (!isUnique && attempts < 20) {
    candidateId = `PAY-${String(nextNumber).padStart(4, '0')}`;
    const existing = await Payment.findOne({ paymentId: candidateId }).select('_id').lean();
    if (!existing) {
      isUnique = true;
    } else {
      nextNumber++;
      attempts++;
    }
  }

  return candidateId || `PAY-${Date.now().toString().slice(-6)}`;
}

module.exports = {
  generatePaymentId,
};
