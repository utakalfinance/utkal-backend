const Payment = require('../models/Payment');

/**
 * Generate a unique sequential Payment ID in format PAY-1001, PAY-1002, etc.
 */
async function generatePaymentId(preferredDigits = null) {
  if (preferredDigits) {
    const candidateId = `PAY-${preferredDigits}`;
    const exists = await Payment.findOne({ paymentId: candidateId }).lean();
    if (!exists) {
      return candidateId;
    }
  }

  let maxNum = 1000;
  const payments = await Payment.find({ paymentId: /^PAY-\d+$/ }).select('paymentId').lean();

  payments.forEach((p) => {
    const match = p.paymentId.match(/PAY-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  let nextNumber = maxNum + 1;
  let isUnique = false;
  let candidateId = '';
  let attempts = 0;

  while (!isUnique && attempts < 100) {
    candidateId = `PAY-${String(nextNumber).padStart(4, '0')}`;
    const existing = await Payment.findOne({ paymentId: candidateId }).lean();
    if (!existing) {
      isUnique = true;
    } else {
      nextNumber++;
      attempts++;
    }
  }

  return candidateId;
}

module.exports = {
  generatePaymentId,
};
