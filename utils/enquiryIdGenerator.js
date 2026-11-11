const LoanEnquiry = require('../models/LoanEnquiry');

/**
 * Generate a unique sequential Enquiry ID in format ENQ-1001, ENQ-1002, etc.
 */
async function generateEnquiryId(preferredDigits = null) {
  if (preferredDigits) {
    const candidateId = `ENQ-${preferredDigits}`;
    const exists = await LoanEnquiry.findOne({ enquiryId: candidateId }).lean();
    if (!exists) {
      return candidateId;
    }
  }

  let maxNum = 1000;
  const enquiries = await LoanEnquiry.find({ enquiryId: /^ENQ-\d+$/ })
    .select('enquiryId')
    .lean();

  enquiries.forEach((item) => {
    if (item.enquiryId) {
      const match = item.enquiryId.match(/ENQ-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  });

  let nextNumber = maxNum + 1;
  let isUnique = false;
  let candidateId = '';
  let attempts = 0;

  while (!isUnique && attempts < 100) {
    candidateId = `ENQ-${String(nextNumber).padStart(4, '0')}`;
    const existing = await LoanEnquiry.findOne({ enquiryId: candidateId }).lean();
    if (!existing) {
      isUnique = true;
    } else {
      nextNumber++;
      attempts++;
    }
  }

  if (!isUnique) {
    candidateId = `ENQ-${Date.now().toString().slice(-6)}`;
  }

  return candidateId;
}

module.exports = {
  generateEnquiryId,
};
