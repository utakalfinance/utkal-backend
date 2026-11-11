const mongoose = require('mongoose');
const Application = require('../models/Application');
const User = require('../models/User');
const Member = require('../models/Member');
const LoanEnquiry = require('../models/LoanEnquiry');
const { generateMemberId } = require('../utils/memberIdGenerator');

/**
 * Helper to format date into '29 Sep 2026'
 */
const formatDate = (dateInput) => {
  if (!dateInput) return 'N/A';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch (e) {
    return 'N/A';
  }
};

/**
 * Format a Member document from MongoDB into a standard API response
 */
const formatMemberRecord = (memberDoc) => {
  if (!memberDoc) return null;
  const m = memberDoc.toObject ? memberDoc.toObject() : memberDoc;
  const p = m.personalDetails || {};
  const c = m.contactDetails || {};
  const a = m.addressDetails || {};
  const n = m.nomineeDetails || {};
  const mem = m.membershipDetails || {};
  const doc = m.documentDetails || {};

  const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
  const applicantName = m.name || (nameParts.length > 0 ? nameParts.join(' ') : 'Valued Member');

  const memberId = m.memberId || 'NUF-M-0001';
  const membershipStatus = (m.status || 'active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

  // Build documents list
  const documentsList = [];
  const defaultVerification = 'Verified';

  const idType = (doc.idProofType || 'Aadhaar Card').trim();
  const addrType = (doc.addressProofType || 'Aadhaar Card').trim();
  const isIdAadhaar = idType.toLowerCase().includes('aadhaar');
  const isAddrAadhaar = addrType.toLowerCase().includes('aadhaar');
  const isSameUrl = doc.idProofUrl && doc.addressProofUrl && doc.idProofUrl === doc.addressProofUrl;

  if (doc.idProofUrl) {
    const isCombined = (isIdAadhaar && isAddrAadhaar) || isSameUrl;
    documentsList.push({
      id: `${m._id}-idproof`,
      documentType: isCombined ? 'Identity & Address Proof' : 'Identity Proof',
      documentName: isCombined ? `${idType} (Identity & Address Proof)` : `${idType} (ID Proof)`,
      documentUrl: doc.idProofUrl,
      uploadedAt: m.createdAt || m.joiningDate,
      verificationStatus: defaultVerification,
    });
  }

  if (doc.addressProofUrl) {
    const isDuplicateAadhaar = isAddrAadhaar && (isIdAadhaar || isSameUrl);
    if (!doc.idProofUrl || (!isDuplicateAadhaar && !documentsList.some((d) => d.documentUrl === doc.addressProofUrl))) {
      documentsList.push({
        id: `${m._id}-addressproof`,
        documentType: 'Address Proof',
        documentName: `${addrType || 'Address Document'} (Address Proof)`,
        documentUrl: doc.addressProofUrl,
        uploadedAt: m.createdAt || m.joiningDate,
        verificationStatus: defaultVerification,
      });
    }
  }

  if (doc.photoUrl) {
    documentsList.push({
      id: `${m._id}-photo`,
      documentType: 'Photograph',
      documentName: 'Passport Photograph',
      documentUrl: doc.photoUrl,
      uploadedAt: m.createdAt || m.joiningDate,
      verificationStatus: defaultVerification,
    });
  }

  if (doc.signatureUrl) {
    documentsList.push({
      id: `${m._id}-signature`,
      documentType: 'Signature',
      documentName: 'Digital Signature Specimen',
      documentUrl: doc.signatureUrl,
      uploadedAt: m.createdAt || m.joiningDate,
      verificationStatus: defaultVerification,
    });
  }

  if (Array.isArray(doc.additionalDocuments)) {
    doc.additionalDocuments.forEach((addDoc, idx) => {
      if (addDoc.documentUrl) {
        documentsList.push({
          id: addDoc._id ? addDoc._id.toString() : `${m._id}-add-${idx}`,
          documentType: addDoc.documentType || 'Additional Document',
          documentName: addDoc.documentName || addDoc.documentType || 'Supporting Document',
          documentUrl: addDoc.documentUrl,
          uploadedAt: addDoc.uploadedAt || m.createdAt || m.joiningDate,
          verificationStatus: defaultVerification,
        });
      }
    });
  }

  return {
    _id: m._id,
    id: memberId,
    memberId,
    applicationId: m.applicationRefId || (m.applicationId ? m.applicationId.toString() : ''),
    name: applicantName,
    applicantName,
    email: m.email || c.email || '',
    mobile: m.mobile || c.mobile || '',
    membershipType: m.membershipType || mem.membershipType || 'Associate Member',
    membershipAmount: String(m.membershipAmount || mem.membershipAmount || 200),
    numberOfShares: m.numberOfShares || mem.numberOfShares || 10,
    shareValue: m.shareValue || mem.shareValue || 10,
    processingFee: m.processingFee || mem.processingFee || 100,
    totalContribution: m.totalContribution || mem.totalContribution || 200,
    status: (m.status || 'active').toLowerCase(),
    membershipStatus,
    joiningDate: formatDate(m.joiningDate || m.createdAt),
    createdAt: m.createdAt || m.joiningDate,
    personalDetails: p,
    contactDetails: c,
    addressDetails: a,
    district: a.district || a.commDistrict || m.district || '',
    nomineeDetails: n,
    membershipDetails: mem,
    documentDetails: doc,
    documents: documentsList,
    paymentDetails: m.paymentDetails || {},
  };
};

/**
 * @desc    Get all real approved members from MongoDB members collection
 * @route   GET /api/members
 * @access  Public / Admin
 */
const getMembers = async (req, res) => {
  try {
    // 1. Fast check: find any approved application missing a Member document in MongoDB
    const existingMembers = await Member.find({}, 'applicationId').lean();
    const existingMemberAppIds = new Set(existingMembers.map((m) => String(m.applicationId)));

    const approvedApps = await Application.find({ status: 'approved' }).lean();
    const missingApps = approvedApps.filter((app) => !existingMemberAppIds.has(String(app._id)));

    if (missingApps.length > 0) {
      for (const app of missingApps) {
        let memberId = app.memberId;
        if (!memberId || !memberId.startsWith('NUF-M-')) {
          memberId = await generateMemberId();
          await Application.updateOne({ _id: app._id }, { $set: { memberId } });
        }

        const p = app.personalDetails || {};
        const nameParts = [p.title || app.title, p.firstName || app.firstName, p.middleName || app.middleName, p.lastName || app.lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(' ') : (app.applicantName || 'Applicant');
        const email = (app.contactDetails?.email || app.email || `member_${memberId.toLowerCase().replace(/[^a-z0-9]/g, '')}@utkalfinance.com`).toLowerCase().trim();
        const mobile = app.contactDetails?.mobile || app.mobile || '';

        await Member.findOneAndUpdate(
          { applicationId: app._id },
          {
            $set: {
              memberId,
              applicationId: app._id,
              applicationRefId: app.applicationId || app._id.toString(),
              name,
              email,
              mobile,
              membershipType: app.membershipDetails?.membershipType || 'Associate Member',
              membershipAmount: app.membershipDetails?.membershipAmount ? Number(app.membershipDetails.membershipAmount) : 200,
              numberOfShares: app.membershipDetails?.numberOfShares || 10,
              shareValue: app.membershipDetails?.shareValue || 10,
              processingFee: app.membershipDetails?.processingFee || 100,
              totalContribution: app.membershipDetails?.totalContribution || 200,
              status: 'active',
              joiningDate: app.reviewedAt || app.submittedAt || app.createdAt || new Date(),
              credentialsEmailStatus: app.credentialsEmailStatus || 'pending',
              personalDetails: app.personalDetails || {},
              contactDetails: app.contactDetails || {},
              addressDetails: app.addressDetails || {},
              nomineeDetails: app.nomineeDetails || {},
              membershipDetails: app.membershipDetails || {},
              documentDetails: app.documentDetails || {},
              paymentDetails: app.paymentDetails || {},
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    // 1b. Sync rejected applications so their Member records are marked suspended
    const rejectedApps = await Application.find({ status: 'rejected' }, '_id memberId').lean();
    if (rejectedApps.length > 0) {
      const rejectedAppIds = rejectedApps.map((a) => a._id);
      const rejectedMemberIds = rejectedApps.map((a) => a.memberId).filter(Boolean);
      await Member.updateMany(
        {
          $or: [
            { applicationId: { $in: rejectedAppIds } },
            { memberId: { $in: rejectedMemberIds } },
          ],
          status: { $ne: 'suspended' },
        },
        { $set: { status: 'suspended' } }
      );
    }

    // 2. Fetch directly from the real Member collection in MongoDB with lean()
    const membersFromDb = await Member.find().sort({ createdAt: -1 }).lean();
    const membersList = membersFromDb.map(formatMemberRecord);

    return res.status(200).json({
      success: true,
      count: membersList.length,
      members: membersList,
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch members',
    });
  }
};

/**
 * @desc    Get single member details by memberId or applicationId or _id
 * @route   GET /api/members/:id
 * @access  Public / Admin
 */
const getMemberById = async (req, res) => {
  try {
    const { id } = req.params;

    let member = await Member.findOne({
      $or: [
        { memberId: id },
        { applicationRefId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
      ],
    });

    if (!member) {
      // Fallback: check if approved application exists and create member
      const app = await Application.findOne({
        $or: [
          { memberId: id },
          { applicationId: id },
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
        ],
        status: 'approved',
      });

      if (app) {
        const p = app.personalDetails || {};
        const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(' ') : 'Applicant';
        const email = (app.contactDetails?.email || app.email || `member_${app._id}@utkalfinance.com`).toLowerCase().trim();
        const memberId = app.memberId || `NUF-M-${(app.applicationId || app._id.toString()).replace(/\D/g, '').slice(-4).padStart(4, '0')}`;

        member = await Member.findOneAndUpdate(
          {
            $or: [{ memberId }, { applicationId: app._id }],
          },
          {
            $set: {
              memberId,
              applicationId: app._id,
              applicationRefId: app.applicationId || app._id.toString(),
              name,
              email,
              mobile: app.contactDetails?.mobile || '',
              membershipType: app.membershipDetails?.membershipType || 'Associate Member',
              membershipAmount: app.membershipDetails?.membershipAmount ? Number(app.membershipDetails.membershipAmount) : 200,
              numberOfShares: app.membershipDetails?.numberOfShares || 10,
              shareValue: app.membershipDetails?.shareValue || 10,
              processingFee: app.membershipDetails?.processingFee || 100,
              totalContribution: app.membershipDetails?.totalContribution || 200,
              status: 'active',
              joiningDate: app.reviewedAt || new Date(),
              personalDetails: app.personalDetails || {},
              contactDetails: app.contactDetails || {},
              addressDetails: app.addressDetails || {},
              nomineeDetails: app.nomineeDetails || {},
              membershipDetails: app.membershipDetails || {},
              documentDetails: app.documentDetails || {},
              paymentDetails: app.paymentDetails || {},
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    if (!member) {
      return res.status(404).json({
        success: false,
        message: `Approved member not found for ID "${id}"`,
      });
    }

    return res.status(200).json({
      success: true,
      member: formatMemberRecord(member),
    });
  } catch (error) {
    console.error('Error fetching member details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch member details',
    });
  }
};

/**
 * @desc    Toggle/Update member status (Active / Inactive)
 * @route   PATCH /api/members/:id/status
 * @access  Public / Admin
 */
const updateMemberStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const newStatus = status.toLowerCase() === 'active' ? 'active' : 'inactive';

    const user = await User.findOne({
      $or: [
        { memberId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
      ],
    });

    if (user) {
      user.status = newStatus;
      await user.save();
    }

    // Update real Member document in MongoDB
    const updatedMember = await Member.findOneAndUpdate(
      {
        $or: [
          { memberId: id },
          { applicationRefId: id },
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
        ],
      },
      { $set: { status: newStatus } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: `Member status updated to ${newStatus}`,
      memberId: id,
      status: newStatus === 'active' ? 'Active' : 'Inactive',
      member: formatMemberRecord(updatedMember),
    });
  } catch (error) {
    console.error('Error updating member status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update member status',
    });
  }
};

/**
 * @desc    Get loan overview for authenticated member
 * @route   GET /api/members/loan-overview
 * @access  Private (Protected Member)
 */
const getMemberLoanOverview = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Member session required',
      });
    }

    const memberId = user.memberId;
    const isValidObjectId = mongoose.Types.ObjectId.isValid(user._id);

    // Look up real member and application record from MongoDB
    const [member, application] = await Promise.all([
      Member.findOne({
        $or: [
          ...(memberId ? [{ memberId }] : []),
          ...(user.applicationId ? [{ applicationId: user.applicationId }] : []),
          ...(isValidObjectId ? [{ userId: user._id }] : []),
        ],
      }),
      user.applicationId
        ? Application.findById(user.applicationId)
        : (memberId ? Application.findOne({ memberId }) : null),
    ]);

    // Check member approval status
    const isApproved = member?.status === 'active' || application?.status === 'approved';
    if (!isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Only approved statutory members can access member loan services.',
      });
    }

    // Active loan records (currently no active loan records)
    const activeLoanAmount = 0;
    const outstandingBalance = 0;
    const totalRepaid = 0;
    const currentLoanStatus = 'No Active Loan';
    const nextLoanEligibility = 'Locked (Requires full repayment and verification of first ₹10,000 loan within 2 months)';

    const overviewData = {
      member: {
        memberId: member?.memberId || user.memberId || '—',
        name: member?.name || user.name || 'Valued Member',
        email: member?.email || user.email,
        mobile: member?.mobile || user.mobile,
        membershipType: member?.membershipType || 'Associate Member',
        status: member?.status || 'active',
        isApprovedMember: true,
      },
      firstLoanOffer: {
        amount: 10000,
        formattedAmount: '₹10,000',
        interestRate: 5,
        interestRateDisplay: '5%',
        repaymentPeriod: 'Within 2 Months',
        tenureMonths: 2,
        purpose: 'Statutory Member Introductory Credit Facility',
        terms: 'Mandatory full repayment within two (2) calendar months to unlock subsequent loan tiers',
      },
      loanSummary: {
        activeLoanAmount,
        formattedActiveLoanAmount: '₹0',
        outstandingBalance,
        formattedOutstandingBalance: '₹0',
        totalRepaid,
        formattedTotalRepaid: '₹0',
        currentLoanStatus,
        nextLoanEligibility,
        hasApplied: false,
        activeLoansCount: 0,
        isNextTierEligible: false,
      },
      businessRules: {
        firstLoanAmount: 10000,
        interestRate: 5,
        repaymentPeriodMonths: 2,
        ruleText: 'The next loan application is unlocked only after the first loan (₹10,000) has been fully repaid and all payments have been verified within the required 2-month period.',
        disbursementNotice: 'Statutory procedural notice: Loan application review, approval, and money disbursement operate as separate stages.',
      },
    };

    return res.status(200).json({
      success: true,
      data: overviewData,
    });
  } catch (error) {
    console.error('Error fetching member loan overview:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan overview',
    });
  }
};

/**
 * @desc    Get available loans for authenticated member
 * @route   GET /api/members/available-loans
 * @access  Private (Protected Member)
 */
const getAvailableLoans = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Member session required',
      });
    }

    const availableLoans = [
      {
        id: 'member-loan-tier-1',
        title: 'First Member Term Loan',
        badge: 'FIRST LOAN OFFER',
        tier: 'Tier 1 (First Member Loan)',
        amount: 10000,
        formattedAmount: '₹10,000',
        interestRate: '5%',
        interestRateValue: 5,
        repaymentPeriod: 'Within 2 Months',
        tenureMonths: 2,
        status: 'available',
        isLocked: false,
        category: 'Statutory Member Privilege',
        description: 'Exclusive introductory loan facility designed for approved statutory members of New Utkal Finance Ltd.',
        eligibilityConditions: [
          'Approved statutory membership of New Utkal Finance Ltd.',
          'Active membership status with verified share capital contribution',
          'Completed KYC verification (Aadhaar Card, PAN Card, Photo and Signature on record)',
          'No delinquent or outstanding prior dues',
        ],
        repaymentGuidelines: [
          'Fixed interest rate: 5%',
          'Repayment timeline: Full repayment must happen within two (2) months',
          'Approval & Disbursement: Loan evaluation, approval, and funds disbursement operate as separate formal stages',
          'Progression rule: The next loan tier is unlocked only after this first loan is fully repaid and verified',
        ],
      },
      {
        id: 'member-loan-tier-2',
        title: 'Tier 2 Member Expansion Loan',
        badge: 'LOCKED TIER',
        tier: 'Tier 2',
        amount: 25000,
        formattedAmount: '₹25,000',
        interestRate: '5%',
        interestRateValue: 5,
        repaymentPeriod: 'Within 3 - 6 Months',
        tenureMonths: 6,
        status: 'locked',
        isLocked: true,
        category: 'Statutory Member Privilege',
        description: 'Higher credit tier unlocked exclusively for members with flawless repayment records.',
        lockReason: 'Unlocked only after your first loan of ₹10,000 has been fully repaid and verified within the required 2-month period.',
        eligibilityConditions: [
          '100% timely repayment of First Member Loan (₹10,000) within 2 months',
          'Ledger and audit reconciliation completed by branch administrator',
        ],
      },
      {
        id: 'member-loan-tier-3',
        title: 'Tier 3 Business & Personal Growth Loan',
        badge: 'LOCKED TIER',
        tier: 'Tier 3',
        amount: 50000,
        formattedAmount: '₹50,000',
        interestRate: '5%',
        interestRateValue: 5,
        repaymentPeriod: 'Within 6 - 12 Months',
        tenureMonths: 12,
        status: 'locked',
        isLocked: true,
        category: 'Statutory Member Privilege',
        description: 'Advanced credit tier for long-standing cooperative members.',
        lockReason: 'Unlocked only upon successful completion and verification of Tier 1 and Tier 2 loans.',
        eligibilityConditions: [
          'Completion of Tier 1 & Tier 2 repayment cycles',
          'Minimum 6 months active cooperative membership',
        ],
      },
    ];

    return res.status(200).json({
      success: true,
      data: availableLoans,
    });
  } catch (error) {
    console.error('Error fetching available loans:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch available loans',
    });
  }
};

/**
 * @desc    Get loan history for authenticated member from MongoDB
 * @route   GET /api/members/loan-history
 * @access  Private (Protected Member)
 */
const getMemberLoanHistory = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Member session required',
      });
    }

    const memberId = user.memberId;
    const userEmail = (user.email || '').toLowerCase().trim();
    const userMobile = (user.mobile || '').trim();
    const isValidObjectId = mongoose.Types.ObjectId.isValid(user._id);

    // 1. Resolve member record from MongoDB
    const [memberDoc, appDoc] = await Promise.all([
      Member.findOne({
        $or: [
          ...(memberId ? [{ memberId }] : []),
          ...(user.applicationId ? [{ applicationId: user.applicationId }] : []),
          ...(isValidObjectId ? [{ userId: user._id }] : []),
          ...(userEmail ? [{ email: userEmail }] : []),
        ],
      }),
      user.applicationId
        ? Application.findById(user.applicationId)
        : (memberId ? Application.findOne({ memberId }) : null),
    ]);

    // Ensure member is approved and active
    const isApproved = memberDoc?.status === 'active' || appDoc?.status === 'approved';
    if (!isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Only approved statutory members can access member loan history.',
      });
    }

    const resolvedMemberId = memberDoc?.memberId || user.memberId || '—';
    const resolvedEmail = (memberDoc?.email || userEmail).toLowerCase().trim();
    const resolvedMobile = (memberDoc?.mobile || userMobile).trim();

    // 2. Query actual MongoDB loan records for THIS member only (scoped to this member)
    const queryConditions = [];
    if (resolvedEmail) queryConditions.push({ email: resolvedEmail });
    if (resolvedMobile) queryConditions.push({ mobileNumber: resolvedMobile });

    let loanRecords = [];
    if (queryConditions.length > 0) {
      const enquiries = await LoanEnquiry.find({ $or: queryConditions }).sort({ createdAt: -1 });

      loanRecords = enquiries.map((enq) => {
        const isConverted = enq.status === 'Converted';
        const isClosed = enq.status === 'Closed';

        return {
          id: enq.enquiryId || enq._id.toString(),
          loanId: enq.enquiryId || `LN-${enq._id.toString().slice(-6).toUpperCase()}`,
          category: enq.loanCategory || 'Member Term Loan',
          loanAmount: enq.expectedAmount || 10000,
          formattedLoanAmount: enq.expectedAmount ? `₹${Number(enq.expectedAmount).toLocaleString('en-IN')}` : '₹10,000',
          interestRate: '5%',
          applicationDate: formatDate(enq.submittedAt || enq.createdAt),
          approvalDate: enq.convertedAt ? formatDate(enq.convertedAt) : (isConverted ? formatDate(enq.updatedAt) : '—'),
          disbursementDate: isConverted ? formatDate(enq.convertedAt || enq.updatedAt) : '—',
          repaymentDeadline: isConverted && enq.convertedAt
            ? formatDate(new Date(new Date(enq.convertedAt).getTime() + 60 * 24 * 60 * 60 * 1000))
            : 'Within 2 Months',
          totalRepaid: '₹0',
          outstandingBalance: isConverted
            ? (enq.expectedAmount ? `₹${Number(enq.expectedAmount).toLocaleString('en-IN')}` : '₹10,000')
            : '₹0',
          loanStatus: isConverted
            ? 'Active'
            : isClosed
            ? 'Rejected'
            : enq.status === 'Contacted' || enq.status === 'Membership Registration Informed'
            ? 'Under Review'
            : 'Pending Approval',
          rawStatus: enq.status,
          adminRemarks: enq.adminRemarks || '',
        };
      });
    }

    // Return strictly actual records from MongoDB (0 if member hasn't applied)
    return res.status(200).json({
      success: true,
      memberId: resolvedMemberId,
      count: loanRecords.length,
      data: loanRecords,
    });
  } catch (error) {
    console.error('Error fetching member loan history:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan history',
    });
  }
};

module.exports = {
  getMembers,
  getMemberById,
  updateMemberStatus,
  getMemberLoanOverview,
  getAvailableLoans,
  getMemberLoanHistory,
};

