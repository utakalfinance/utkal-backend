const Member = require('../models/Member');
const Application = require('../models/Application');
const User = require('../models/User');

/**
 * Generate a unique sequential Member ID in format NUF-M-0001, NUF-M-0002, etc.
 * Checks Member, Application, and User collections to prevent any ID collision.
 */
async function generateMemberId() {
  let maxNum = 0;

  // Search existing highest members, users and applications with NUF-M-XXXX format
  const [lastMembers, lastUsers, lastApps] = await Promise.all([
    Member.find({ memberId: /^NUF-M-\d+$/ }).sort({ memberId: -1 }).limit(10).select('memberId').lean(),
    User.find({ memberId: /^NUF-M-\d+$/ }).sort({ memberId: -1 }).limit(10).select('memberId').lean(),
    Application.find({ memberId: /^NUF-M-\d+$/ }).sort({ memberId: -1 }).limit(10).select('memberId').lean(),
  ]);

  const allMemberIds = [
    ...(lastMembers || []).map((m) => m.memberId),
    ...(lastUsers || []).map((u) => u.memberId),
    ...(lastApps || []).map((a) => a.memberId),
  ].filter(Boolean);

  allMemberIds.forEach((idStr) => {
    const match = idStr.match(/NUF-M-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  let nextNumber = maxNum + 1;
  let isUnique = false;
  let candidateId = '';
  let attempts = 0;

  while (!isUnique && attempts < 20) {
    candidateId = `NUF-M-${String(nextNumber).padStart(4, '0')}`;
    const [existingMember, existingUser, existingApp] = await Promise.all([
      Member.findOne({ memberId: candidateId }).select('_id').lean(),
      User.findOne({ memberId: candidateId }).select('_id').lean(),
      Application.findOne({ memberId: candidateId }).select('_id').lean(),
    ]);

    if (!existingMember && !existingUser && !existingApp) {
      isUnique = true;
    } else {
      nextNumber++;
      attempts++;
    }
  }

  return candidateId;
}

module.exports = {
  generateMemberId,
};
