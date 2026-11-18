const mongoose = require('mongoose');
const Application = require('../models/Application');
const User = require('../models/User');
const Member = require('../models/Member');
const LoanEnquiry = require('../models/LoanEnquiry');
const LoanApplication = require('../models/LoanApplication');
const LoanSetting = require('../models/LoanSetting');
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

  const isAssociate = m.role === 'associate';
  const resolvedMembershipType = isAssociate ? 'Associate Member' : 'Regular Member';

  return {
    _id: m._id,
    id: memberId,
    memberId,
    applicationId: m.applicationRefId || (m.applicationId ? m.applicationId.toString() : ''),
    name: applicantName,
    applicantName,
    email: m.email || c.email || '',
    mobile: m.mobile || c.mobile || '',
    membershipType: resolvedMembershipType,
    role: isAssociate ? 'associate' : 'member',
    isAssociate,
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

        const appRole = app.role === 'associate' ? 'associate' : 'member';
        const appMembershipType = appRole === 'associate'
          ? 'Associate Member'
          : (app.membershipDetails?.membershipType && app.membershipDetails.membershipType !== 'Associate Member'
            ? app.membershipDetails.membershipType
            : 'Regular Member');

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
              role: appRole,
              membershipType: appMembershipType,
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

    // 1c. Harmonize associate vs regular member status strictly based on admin approved applications
    try {
      const approvedAssociateApps = await Application.find(
        { role: 'associate', status: 'approved' },
        '_id applicationId memberId email'
      ).lean();

      const associateMemberIds = new Set(approvedAssociateApps.map((a) => a.memberId).filter(Boolean));
      const associateAppIds = new Set(approvedAssociateApps.map((a) => String(a._id)));
      const associateRefIds = new Set(approvedAssociateApps.map((a) => a.applicationId).filter(Boolean));

      // 1. Any member not in the approved associate applications MUST be role: 'member', membershipType: 'Regular Member'
      await Member.updateMany(
        {
          memberId: { $nin: Array.from(associateMemberIds) },
          applicationId: { $nin: Array.from(associateAppIds) },
          applicationRefId: { $nin: Array.from(associateRefIds) },
        },
        {
          $set: {
            role: 'member',
            membershipType: 'Regular Member',
          },
        }
      );

      // 2. The genuine approved associate members are set to role: 'associate', membershipType: 'Associate Member'
      if (associateMemberIds.size > 0 || associateAppIds.size > 0 || associateRefIds.size > 0) {
        await Member.updateMany(
          {
            $or: [
              { memberId: { $in: Array.from(associateMemberIds) } },
              { applicationId: { $in: Array.from(associateAppIds) } },
              { applicationRefId: { $in: Array.from(associateRefIds) } },
            ],
          },
          {
            $set: {
              role: 'associate',
              membershipType: 'Associate Member',
            },
          }
        );
      }
    } catch (syncErr) {
      console.warn('Note: Could not sync associate vs regular roles in MongoDB:', syncErr.message);
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

        const appRole = app.role === 'associate' ? 'associate' : 'member';
        const appMembershipType = appRole === 'associate'
          ? 'Associate Member'
          : (app.membershipDetails?.membershipType && app.membershipDetails.membershipType !== 'Associate Member'
            ? app.membershipDetails.membershipType
            : 'Regular Member');

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
              role: appRole,
              membershipType: appMembershipType,
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

    const resolvedMemberId = member?.memberId || user.memberId || '—';
    const userEmail = (member?.email || user.email || '').toLowerCase().trim();
    const userMobile = (member?.mobile || user.mobile || '').trim();

    const loanSetting = await LoanSetting.getOrCreateDefault();
    const defaultAmount = loanSetting.defaultAmount || 10000;
    const monthlyRate = loanSetting.monthlyInterestRate || 1;
    const tenureMonthsList = Array.isArray(loanSetting.availableTenureMonths) && loanSetting.availableTenureMonths.length > 0
      ? loanSetting.availableTenureMonths
      : [3, 6, 9];
    const tenureDisplay = tenureMonthsList.map((m) => `${m} Months`).join(', ');

    // Query real loan applications for this member
    const customerFilter = {
      $or: [
        ...(resolvedMemberId && resolvedMemberId !== '—' ? [{ memberId: resolvedMemberId }] : []),
        ...(isValidObjectId ? [{ userId: user._id }] : []),
        ...(userEmail ? [{ email: userEmail }] : []),
        ...(userMobile ? [{ mobile: userMobile }] : []),
      ],
    };

    const loanApps = await LoanApplication.find(customerFilter).sort({ createdAt: -1 });
    const latestApp = loanApps[0] || null;
    const activeDisbursed = loanApps.filter(
      (a) => a.disbursement?.isDisbursed === true && (a.repayment?.outstandingBalance || 0) > 0
    );
    const fullyRepaid = loanApps.filter(
      (a) => a.disbursement?.isDisbursed === true && (a.repayment?.outstandingBalance || 0) === 0 && (a.repayment?.totalPaidAmount || 0) > 0
    );

    const activeLoanAmount = activeDisbursed.reduce((s, a) => s + (a.disbursement?.disbursedAmount || a.sanctionedAmount || 0), 0);
    const outstandingBalance = activeDisbursed.reduce((s, a) => s + (a.repayment?.outstandingBalance || 0), 0);
    const totalRepaid = loanApps.reduce((s, a) => s + (a.repayment?.totalPaidAmount || 0), 0);
    const currentLoanStatus = latestApp ? latestApp.status : 'No Active Loan';
    const isNextTierEligible = fullyRepaid.length > 0;
    const nextLoanEligibility = isNextTierEligible
      ? 'Unlocked (Tier 2 Eligible)'
      : activeDisbursed.length > 0
      ? 'Active Loan in Repayment'
      : `Requires full repayment of First ₹${defaultAmount.toLocaleString('en-IN')} Loan`;

    const overviewData = {
      member: {
        memberId: resolvedMemberId,
        name: member?.name || user.name || 'Valued Member',
        email: member?.email || user.email,
        mobile: member?.mobile || user.mobile,
        membershipType: member?.membershipType || 'Associate Member',
        status: member?.status || 'active',
        isApprovedMember: true,
      },
      firstLoanOffer: {
        amount: defaultAmount,
        formattedAmount: `₹${defaultAmount.toLocaleString('en-IN')}`,
        interestRate: monthlyRate,
        interestRateDisplay: `${monthlyRate}% / Month`,
        repaymentPeriod: tenureDisplay,
        tenureMonths: loanSetting.defaultTenureMonths || tenureMonthsList[0] || 3,
        purpose: 'Statutory Member Introductory Credit Facility',
        terms: `Repayment scheduled across ${tenureDisplay} under reducing balance methodology`,
      },
      loanSummary: {
        activeLoanAmount,
        formattedActiveLoanAmount: `₹${activeLoanAmount.toLocaleString('en-IN')}`,
        outstandingBalance,
        formattedOutstandingBalance: `₹${outstandingBalance.toLocaleString('en-IN')}`,
        totalRepaid,
        formattedTotalRepaid: `₹${totalRepaid.toLocaleString('en-IN')}`,
        currentLoanStatus,
        nextLoanEligibility,
        hasApplied: loanApps.length > 0,
        activeLoansCount: activeDisbursed.length,
        isNextTierEligible,
      },
      businessRules: {
        firstLoanAmount: defaultAmount,
        interestRate: monthlyRate,
        repaymentPeriodMonths: loanSetting.defaultTenureMonths || 3,
        ruleText: `The next loan tier is unlocked once your first loan (₹${defaultAmount.toLocaleString('en-IN')}) has been fully repaid and verified.`,
        disbursementNotice: 'Statutory notice: Loan evaluation, sanction, and funds disbursement operate as separate formal stages.',
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

    const loanSetting = await LoanSetting.getOrCreateDefault();
    const defaultAmount = loanSetting.defaultAmount || 10000;
    const monthlyRate = loanSetting.monthlyInterestRate || 1;
    const tenureMonthsList = Array.isArray(loanSetting.availableTenureMonths) && loanSetting.availableTenureMonths.length > 0
      ? loanSetting.availableTenureMonths
      : [3, 6, 9];
    const tenureDisplay = tenureMonthsList.map((m) => `${m} Months`).join(', ');

    const availableLoans = [
      {
        id: 'member-loan-tier-1',
        title: 'First Member Term Loan',
        badge: 'FIRST LOAN OFFER',
        tier: 'Tier 1 (First Member Loan)',
        amount: defaultAmount,
        formattedAmount: `₹${defaultAmount.toLocaleString('en-IN')}`,
        interestRate: `${monthlyRate}% / Month`,
        interestRateValue: monthlyRate,
        repaymentPeriod: tenureDisplay,
        tenureMonths: loanSetting.defaultTenureMonths || tenureMonthsList[0] || 3,
        status: 'available',
        isLocked: false,
        category: 'Statutory Member Privilege',
        description: `Exclusive introductory loan facility of ₹${defaultAmount.toLocaleString('en-IN')} designed for approved statutory members of New Utkal Finance Ltd.`,
        eligibilityConditions: [
          'Approved statutory membership of New Utkal Finance Ltd.',
          'Active membership status with verified share capital contribution (minimum 10 shares)',
          'Completed KYC verification (Aadhaar Card, PAN Card, Photo and Signature on record)',
          'No delinquent or outstanding prior dues',
        ],
        repaymentGuidelines: [
          `Monthly interest rate: ${monthlyRate}% / Month (Reducing Balance)`,
          `Repayment options: Select ${tenureDisplay}`,
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
        interestRate: `${monthlyRate}% / Month`,
        interestRateValue: monthlyRate,
        repaymentPeriod: 'Within 3 - 6 Months',
        tenureMonths: 6,
        status: 'locked',
        isLocked: true,
        category: 'Statutory Member Privilege',
        description: 'Higher credit tier unlocked exclusively for members with flawless repayment records.',
        lockReason: `Unlocked only after your first loan of ₹${defaultAmount.toLocaleString('en-IN')} has been fully repaid and verified.`,
        eligibilityConditions: [
          `100% timely repayment of First Member Loan (₹${defaultAmount.toLocaleString('en-IN')})`,
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
        interestRate: `${monthlyRate}% / Month`,
        interestRateValue: monthlyRate,
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

    // 2. Query actual MongoDB loan applications first
    const customerFilter = {
      $or: [
        ...(resolvedMemberId && resolvedMemberId !== '—' ? [{ memberId: resolvedMemberId }] : []),
        ...(isValidObjectId ? [{ userId: user._id }] : []),
        ...(resolvedEmail ? [{ email: resolvedEmail }] : []),
        ...(resolvedMobile ? [{ mobile: resolvedMobile }] : []),
      ],
    };

    const loanApps = await LoanApplication.find(customerFilter).sort({ createdAt: -1 });

    let loanRecords = [];

    if (loanApps.length > 0) {
      loanRecords = loanApps.map((app) => {
        const isDisbursed = app.disbursement?.isDisbursed === true || app.status === 'Disbursed';
        const isApprovedStatus = app.status === 'Approved' || isDisbursed;
        const loanAmt = app.sanctionedAmount || app.requestedAmount || 10000;
        const rate = app.interestRate || 1;

        return {
          id: app._id.toString(),
          loanId: app.loanId || app.applicationId,
          category: app.loanCategory || 'Statutory Member Credit Facility',
          loanAmount: loanAmt,
          formattedLoanAmount: `₹${Number(loanAmt).toLocaleString('en-IN')}`,
          interestRate: rate <= 5 ? `${rate}% / Month` : `${rate}% p.a.`,
          applicationDate: formatDate(app.createdAt),
          approvalDate: app.finalApproval?.approvedAt
            ? formatDate(app.finalApproval.approvedAt)
            : isApprovedStatus
            ? formatDate(app.updatedAt)
            : '—',
          disbursementDate: isDisbursed && app.disbursement?.disbursedAt
            ? formatDate(app.disbursement.disbursedAt)
            : '—',
          repaymentDeadline: `${app.preferredTenureMonths || 3} Months`,
          totalRepaid: `₹${Number(app.repayment?.totalPaidAmount || 0).toLocaleString('en-IN')}`,
          outstandingBalance: isDisbursed
            ? `₹${Number(app.repayment?.outstandingBalance || loanAmt).toLocaleString('en-IN')}`
            : '₹0',
          loanStatus: app.status,
          rawStatus: app.status,
          adminRemarks: app.finalApproval?.remarks || app.districtVerification?.districtRemarks || '',
        };
      });
    } else {
      // Fallback: check loan enquiries if no formal loan application yet
      const queryConditions = [];
      if (resolvedEmail) queryConditions.push({ email: resolvedEmail });
      if (resolvedMobile) queryConditions.push({ mobileNumber: resolvedMobile });

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
            interestRate: '1% / Month',
            applicationDate: formatDate(enq.submittedAt || enq.createdAt),
            approvalDate: enq.convertedAt ? formatDate(enq.convertedAt) : (isConverted ? formatDate(enq.updatedAt) : '—'),
            disbursementDate: isConverted ? formatDate(enq.convertedAt || enq.updatedAt) : '—',
            repaymentDeadline: '3 Months',
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
    }

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

