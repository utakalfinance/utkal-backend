const Member = require('../models/Member');
const Application = require('../models/Application');
const User = require('../models/User');

/**
 * Generate a unique sequential Member ID in format NUF-M-0001, NUF-M-0002, etc.
 * Checks Member, Application, and User collections to prevent any ID collision.
 */
async function generateMemberId() {
  let maxNum = 0;

  // Search existing members, users and applications with NUF-M-XXXX format
  const [membersWithId, usersWithMemberId, appsWithMemberId] = await Promise.all([
    Member.find({ memberId: /^NUF-M-\d+$/ }).select('memberId').lean(),
    User.find({ memberId: /^NUF-M-\d+$/ }).select('memberId').lean(),
    Application.find({ memberId: /^NUF-M-\d+$/ }).select('memberId').lean(),
  ]);

  const allMemberIds = [
    ...membersWithId.map((m) => m.memberId),
    ...usersWithMemberId.map((u) => u.memberId),
    ...appsWithMemberId.map((a) => a.memberId),
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

  while (!isUnique && attempts < 100) {
    candidateId = `NUF-M-${String(nextNumber).padStart(4, '0')}`;
    const [existingMember, existingUser, existingApp] = await Promise.all([
      Member.findOne({ memberId: candidateId }).lean(),
      User.findOne({ memberId: candidateId }).lean(),
      Application.findOne({ memberId: candidateId }).lean(),
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
