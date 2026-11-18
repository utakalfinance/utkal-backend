const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const Investor = require('../models/Investor');
const InvestorPayment = require('../models/InvestorPayment');
const InvestmentPlan = require('../models/InvestmentPlan');
const InvestorLedgerEntry = require('../models/InvestorLedgerEntry');
const InvestorPayout = require('../models/InvestorPayout');
const InvestorAuditLog = require('../models/InvestorAuditLog');
const InvestmentRecord = require('../models/InvestmentRecord');
const LoanApplication = require('../models/LoanApplication');
const {
  maskEmail,
  maskBankAccount,
  maskPan,
  maskAadhaar,
  sendInvestorRegistrationEmail,
  sendKycStatusEmail,
  sendInvestmentConfirmationEmail,
  sendPlanActivationEmail,
  sendAgreementEmail,
  sendMaturityReminderEmail,
  sendPayoutConfirmationEmail,
  sendRefundConfirmationEmail,
  sendCustomEmail,
} = require('../utils/investorEmailService');
const {
  maskMobile,
  sendInvestorRegistrationSms,
  sendKycStatusSms,
  sendPaymentConfirmationSms,
  sendPlanActivationSms,
  sendAgreementSms,
  sendMaturityReminderSms,
  sendPayoutConfirmationSms,
  sendRefundConfirmationSms,
  sendCustomSms,
} = require('../utils/investorSmsService');
const env = require('../config/env');

/**
 * Centralized Helper to log communication into Investor model
 */
const logCommunicationRecord = async (investorId, entry) => {
  try {
    const updateObj = {
      $push: {
        communicationLogs: {
          channel: entry.channel || 'Email',
          category: entry.category || 'General',
          recipient: entry.recipient || '',
          subject: entry.subject || '',
          messageSummary: entry.messageSummary || '',
          status: entry.status || 'Sent',
          provider: entry.provider || (entry.channel === 'SMS' ? 'SMS Gateway' : 'SMTP'),
          messageId: entry.messageId || '',
          errorMessage: entry.errorMessage || '',
          sentAt: new Date(),
          sentBy: entry.sentBy || 'Super Admin',
        },
      },
    };

    // If channel is Email, also push to legacy emailLogs for backwards compatibility
    if (entry.channel === 'Email') {
      const emailTypeMap = {
        Registration: 'RegistrationAcknowledgement',
        KycStatus: 'KycStatus',
        PaymentConfirmation: 'InvestmentConfirmation',
        PlanActivation: 'PlanAssignment',
        Agreement: 'Agreement',
        MaturityReminder: 'MaturityReminder',
        Payout: 'Payout',
        Refund: 'Refund',
      };
      updateObj.$push.emailLogs = {
        emailType: emailTypeMap[entry.category] || 'Other',
        sentAt: new Date(),
        recipient: entry.recipient || '',
        status: entry.status === 'Sent' ? 'Sent' : 'Failed',
        messageId: entry.messageId || '',
        details: entry.messageSummary || '',
      };
    }

    await Investor.updateOne({ _id: investorId }, updateObj);
  } catch (err) {
    console.error('Error logging communication record:', err.message);
  }
};

/**
 * Check if a recent identical communication was dispatched in the last N minutes to prevent duplicates
 */
const hasRecentCommunication = (investor, channel, category, windowMinutes = 5) => {
  if (!investor.communicationLogs || !investor.communicationLogs.length) {
    return false;
  }
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  return investor.communicationLogs.some(
    (log) =>
      log.channel === channel &&
      log.category === category &&
      log.status === 'Sent' &&
      new Date(log.sentAt).getTime() > cutoff
  );
};

/**
 * Generate Next Unique Investor ID (e.g. UF-INV-1001, UF-INV-1002)
 */
const generateNextInvestorId = async () => {
  const lastInvestor = await Investor.findOne({}, { investorId: 1 })
    .sort({ createdAt: -1 })
    .lean();

  if (!lastInvestor || !lastInvestor.investorId) {
    return 'UF-INV-1001';
  }

  const match = lastInvestor.investorId.match(/UF-INV-(\d+)/);
  if (match && match[1]) {
    const nextNum = parseInt(match[1], 10) + 1;
    return `UF-INV-${nextNum}`;
  }

  // Fallback timestamp-based ID
  return `UF-INV-${Date.now().toString().slice(-4)}`;
};

/**
 * Generate Next Unique Sequential Investment ID for an Investor (e.g. UF-INV-1001-01, UF-INV-1001-02)
 */
const generateNextInvestmentId = async (investorId) => {
  const count = await InvestmentRecord.countDocuments({ investorId: investorId.toUpperCase() });
  const seq = (count + 1).toString().padStart(2, '0');
  return `${investorId.toUpperCase()}-${seq}`;
};

/**
 * Helper to ensure the initial investment (-01) exists as an InvestmentRecord for existing profiles
 */
const ensureInitialInvestmentRecord = async (investor) => {
  if (!investor) return;
  try {
    const count = await InvestmentRecord.countDocuments({ investor: investor._id });
    if (count === 0 && (investor.totalInvestment > 0 || investor.verifiedInvestment > 0)) {
      const initPayment = await InvestorPayment.findOne({ investor: investor._id }).sort({ createdAt: 1 });
      const invAmount = investor.totalInvestment || (initPayment ? initPayment.amount : 0) || 0;
      const plan = investor.assignedPlan || {};
      const mult = Number(plan.multiplier || investor.tracking2x?.multiplier || 2);
      const target = Math.round(invAmount * mult);

      const firstInvestmentId = `${investor.investorId}-01`;

      const initialRecord = new InvestmentRecord({
        investmentId: firstInvestmentId,
        investor: investor._id,
        investorId: investor.investorId,
        investorName: investor.fullName,
        amount: invAmount,
        investmentDate: investor.investmentDate || (initPayment ? initPayment.paymentDate : investor.createdAt) || new Date(),
        paymentMode: initPayment ? initPayment.paymentMethod : 'UPI',
        utrNumber: initPayment?.utrNumber ? initPayment.utrNumber : 'INITIAL-ALLOTMENT',
        receiptUrl: initPayment ? initPayment.receiptUrl : '',
        paymentStatus: investor.paymentStatus === 'Verified' ? 'Verified' : 'Pending',
        verifiedBy: initPayment?.verifiedBy || (investor.paymentStatus === 'Verified' ? 'Super Admin' : ''),
        verifiedAt: initPayment?.verifiedAt || (investor.paymentStatus === 'Verified' ? new Date() : null),
        adminRemarks: 'Primary initial investment registered on onboarding.',
        planId: (plan.planId && mongoose.Types.ObjectId.isValid(plan.planId)) ? plan.planId : undefined,
        planCode: plan.planCode || 'UF-TERM-DEFAULT',
        planName: plan.planName || 'Standard Term Plan',
        version: plan.version || '1.0',
        multiplier: mult,
        contractualPercentage: plan.contractualPercentage ?? 100,
        percentageBasis: plan.percentageBasis || 'Total Contractual Percentage',
        durationMonths: plan.durationMonths || 24,
        assignedDate: plan.assignedDate || investor.createdAt || new Date(),
        maturityDate: plan.maturityDate || (plan.durationMonths ? new Date(Date.now() + plan.durationMonths * 30 * 24 * 3600 * 1000) : null),
        planStatus: (plan.status && plan.status !== 'None') ? plan.status : (investor.paymentStatus === 'Verified' ? 'Active' : 'Pending'),
        agreementNumber: investor.agreement?.agreementNumber || `UF-AGR-${investor.investorId}-01`,
        agreementUrl: investor.agreement?.agreementUrl || investor.assignedPlan?.agreementUrl || '',
        agreementStatus: investor.agreement?.status || investor.assignedPlan?.agreementStatus || 'Draft',
        tracking2x: {
          originalInvestment: invAmount,
          multiplier: mult,
          contractualPercentage: plan.contractualPercentage ?? 100,
          percentageBasis: plan.percentageBasis || 'Total Contractual Percentage',
          targetAmount: target,
          durationMonths: plan.durationMonths || 24,
          startDate: plan.assignedDate || investor.createdAt || new Date(),
          maturityDate: plan.maturityDate,
          totalEligiblePayouts: 0,
          remainingPayout: target,
          status: (plan.status && plan.status !== 'None') ? plan.status : (investor.paymentStatus === 'Verified' ? 'Active' : 'Pending'),
          activatedAt: investor.paymentStatus === 'Verified' ? (investor.tracking2x?.activatedAt || new Date()) : null,
          activatedBy: investor.tracking2x?.activatedBy || (investor.paymentStatus === 'Verified' ? 'Super Admin' : ''),
        },
        paymentRecordId: (initPayment?._id && mongoose.Types.ObjectId.isValid(initPayment._id)) ? initPayment._id : undefined,
        ledgerEntryId: (initPayment?.ledgerEntryId && mongoose.Types.ObjectId.isValid(initPayment.ledgerEntryId)) ? initPayment.ledgerEntryId : undefined,
        createdBy: investor.createdBy || 'Super Admin',
      });

      await initialRecord.save();
    }
  } catch (err) {
    console.warn('ensureInitialInvestmentRecord notice:', err.message);
  }
};

/**
 * Seed Default Company Authorized Investment Plans if none exist
 */
const ensureDefaultPlansSeeded = async () => {
  const count = await InvestmentPlan.countDocuments();
  if (count === 0) {
    const defaultPlans = [
      {
        planCode: 'UF-2X-GROWTH-24M',
        name: 'Utkal Mutual 2X Capital Growth Plan (24M)',
        version: '1.0',
        multiplier: 2,
        approvedPercentage: 100,
        percentageBasis: 'Total Contractual Percentage',
        durationMonths: 24,
        availableDurations: [12, 18, 24, 36, 48, 60],
        minAmount: 5000,
        maxAmount: 10000000,
        status: 'Approved',
        is2x3xStructure: false,
        terms: 'Contractual 2X total payout target upon maturity. Verified capital repaid in accordance with approved company agreement rules.',
        regulatoryNotice: 'Compliant with statutory cooperative guidelines and Utkal Finance mutual credit framework.',
      },
      {
        planCode: 'UF-TERM-12M',
        name: 'Regular Mutual Benefit Term Plan (12M)',
        version: '1.0',
        multiplier: 1,
        approvedPercentage: 12,
        percentageBasis: 'Annual',
        durationMonths: 12,
        availableDurations: [6, 12, 18, 24],
        minAmount: 1000,
        maxAmount: 10000000,
        status: 'Approved',
        is2x3xStructure: false,
        terms: '12 Months statutory mutual tenure. Capital secured under Utkal Finance mutual credit framework. No unapproved speculative promises.',
        regulatoryNotice: 'Compliant with statutory cooperative guidelines.',
      },
      {
        planCode: 'UF-TERM-24M',
        name: 'Secured Capital Growth Plan (24M)',
        version: '1.0',
        multiplier: 1.5,
        approvedPercentage: 50,
        percentageBasis: 'Total Contractual Percentage',
        durationMonths: 24,
        availableDurations: [12, 18, 24, 36],
        minAmount: 5000,
        maxAmount: 10000000,
        status: 'Approved',
        is2x3xStructure: false,
        terms: '24 Months contractual duration. Periodic ledger audits and statutory member certificates issued upon verification.',
        regulatoryNotice: 'Compliant with statutory cooperative guidelines.',
      },
      {
        planCode: 'UF-TERM-36M',
        name: 'Long-Term Mutual Endowment Plan (36M)',
        version: '1.0',
        multiplier: 1.8,
        approvedPercentage: 80,
        percentageBasis: 'Total Contractual Percentage',
        durationMonths: 36,
        availableDurations: [24, 36, 48],
        minAmount: 10000,
        maxAmount: 25000000,
        status: 'Approved',
        is2x3xStructure: false,
        terms: '36 Months approved duration with annual statutory audit and member equity participation rights.',
        regulatoryNotice: 'Compliant with statutory cooperative guidelines.',
      },
      {
        planCode: 'UF-SPEC-3X-DRAFT',
        name: '3X Accelerated Return Plan (PENDING BOARD APPROVAL)',
        version: '0.9-DRAFT',
        multiplier: 3,
        approvedPercentage: 200,
        percentageBasis: 'Total Contractual Percentage',
        durationMonths: 60,
        availableDurations: [60],
        minAmount: 50000,
        status: 'Draft',
        is2x3xStructure: true,
        terms: 'DISABLED: Awaiting formal company legal, risk, and statutory compliance clearance. Cannot be assigned to investors.',
        regulatoryNotice: 'STRICT COMPLIANCE NOTICE: 3X return promises remain disabled in draft status until formal company executive approval.',
      },
    ];

    await InvestmentPlan.insertMany(defaultPlans);
    console.log('[InvestorController] Seeded default authorized investment plans.');
  } else {
    // Backfill any missing multiplier or availableDurations in existing plans
    await InvestmentPlan.updateMany(
      { multiplier: { $exists: false } },
      {
        $set: {
          multiplier: 2,
          approvedPercentage: 100,
          percentageBasis: 'Total Contractual Percentage',
          availableDurations: [12, 18, 24, 36, 48, 60],
        },
      }
    );
  }
};

/**
 * 1. Get Summary Stats for Top KPI Cards
 */
const getInvestorStats = async (req, res) => {
  try {
    const isAssociate = req.user?.role === 'associate';
    const filter = isAssociate
      ? {
          $or: [
            { 'sourcedBy.associateId': req.user._id },
            ...(req.user.memberId ? [{ 'sourcedBy.associateMemberId': req.user.memberId }] : []),
            ...(req.user.email ? [{ 'sourcedBy.associateEmail': req.user.email.toLowerCase() }] : []),
            { createdBy: req.user.name || req.user.email },
          ],
        }
      : {};

    const totalInvestors = await Investor.countDocuments(filter);
    const verifiedInvestors = await Investor.countDocuments({ ...filter, kycStatus: 'Verified' });
    const activeInvestors = await Investor.countDocuments({
      ...filter,
      status: 'Active',
      kycStatus: 'Verified',
    });
    const pendingKyc = await Investor.countDocuments({ ...filter, kycStatus: 'Pending' });
    const pendingPayment = await Investor.countDocuments({ ...filter, paymentStatus: 'Pending' });
    const pendingAssociateApproval = await Investor.countDocuments({
      ...filter,
      approvalStage: 'pending_associate',
    });
    const approvedByAssociate = await Investor.countDocuments({
      ...filter,
      approvalStage: 'approved_by_associate',
    });

    // Role-based calculation for investment collections and liabilities
    let totalInvestmentCollection = 0;
    let totalCapitalMobilized = 0;
    let contractualLiabilitiesSum = 0;
    let totalPaidPayouts = 0;

    if (isAssociate) {
      // Find all investors belonging strictly to this associate
      const associateInvestors = await Investor.find(filter)
        .select('_id totalInvestment verifiedInvestment paymentStatus')
        .lean();
      const associateInvestorIds = associateInvestors.map((i) => i._id);

      // Total Capital Mobilized by this Associate (real sum from their investors)
      totalCapitalMobilized = associateInvestors.reduce(
        (acc, curr) => acc + (Number(curr.totalInvestment) || 0),
        0
      );

      // Verified Investment Received from this associate's investors only
      if (associateInvestorIds.length > 0) {
        const verifiedPaymentsAgg = await InvestorPayment.aggregate([
          { $match: { status: 'Verified', investor: { $in: associateInvestorIds } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        totalInvestmentCollection = verifiedPaymentsAgg[0]?.total || 0;

        if (!totalInvestmentCollection) {
          totalInvestmentCollection = associateInvestors
            .filter((i) => i.paymentStatus === 'Verified')
            .reduce((acc, curr) => acc + (Number(curr.verifiedInvestment) || 0), 0);
        }

        const liabilitiesAgg = await Investor.aggregate([
          { $match: { _id: { $in: associateInvestorIds }, 'assignedPlan.status': 'Active' } },
          { $group: { _id: null, total: { $sum: '$assignedPlan.contractualLiability' } } },
        ]);
        contractualLiabilitiesSum = liabilitiesAgg[0]?.total || 0;

        const payoutsAgg = await InvestorPayout.aggregate([
          { $match: { status: 'Paid', investor: { $in: associateInvestorIds } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        totalPaidPayouts = payoutsAgg[0]?.total || 0;
      }
    } else {
      // Super Admin: global system-wide aggregates
      const verifiedPaymentsAgg = await InvestorPayment.aggregate([
        { $match: { status: 'Verified' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      totalInvestmentCollection = verifiedPaymentsAgg[0]?.total || 0;

      const allInvestors = await Investor.find({}).select('totalInvestment').lean();
      totalCapitalMobilized = allInvestors.reduce(
        (acc, curr) => acc + (Number(curr.totalInvestment) || 0),
        0
      );

      const liabilitiesAgg = await Investor.aggregate([
        { $match: { 'assignedPlan.status': 'Active' } },
        { $group: { _id: null, total: { $sum: '$assignedPlan.contractualLiability' } } },
      ]);
      contractualLiabilitiesSum = liabilitiesAgg[0]?.total || totalInvestmentCollection;

      const payoutsAgg = await InvestorPayout.aggregate([
        { $match: { status: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      totalPaidPayouts = payoutsAgg[0]?.total || 0;
    }

    const outstandingLiabilities = isAssociate
      ? contractualLiabilitiesSum
      : Math.max(0, contractualLiabilitiesSum - totalPaidPayouts);

    return res.status(200).json({
      success: true,
      stats: {
        totalInvestors,
        verifiedInvestors,
        totalCapitalMobilized,
        totalInvestmentReceived: totalInvestmentCollection,
        totalInvestmentCollection,
        activeInvestors,
        totalPayouts: totalPaidPayouts,
        outstandingLiabilities,
        outstandingBalance: outstandingLiabilities,
        pendingKyc,
        pendingPayment,
        pendingAssociateApproval,
        approvedByAssociate,
      },
    });
  } catch (error) {
    console.error('getInvestorStats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve investor statistics: ' + error.message,
    });
  }
};

/**
 * 2. Get Investors List with Search & Filtering
 */
const getInvestors = async (req, res) => {
  try {
    const {
      search = '',
      district = '',
      kycStatus = '',
      paymentStatus = '',
      planStatus = '',
      approvalStage = '',
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};

    if (search.trim()) {
      const s = search.trim();
      query.$or = [
        { fullName: { $regex: s, $options: 'i' } },
        { investorId: { $regex: s, $options: 'i' } },
        { mobile: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
      ];
    }

    if (district && district !== 'All') {
      query.district = { $regex: `^${district}$`, $options: 'i' };
    }

    if (kycStatus && kycStatus !== 'All') {
      query.kycStatus = kycStatus;
    }

    if (paymentStatus && paymentStatus !== 'All') {
      query.paymentStatus = paymentStatus;
    }

    if (approvalStage && approvalStage !== 'All') {
      query.approvalStage = approvalStage;
    }

    if (planStatus && planStatus !== 'All') {
      if (planStatus === 'Assigned') {
        query['assignedPlan.status'] = 'Active';
      } else if (planStatus === 'Not Assigned') {
        query.$or = [
          { 'assignedPlan.status': { $in: ['None', 'Draft', null] } },
          { 'assignedPlan.planCode': { $in: ['', null] } },
        ];
      }
    }

    // Role-based data scoping for Associates
    if (req.user?.role === 'associate') {
      const associateFilter = {
        $or: [
          { 'sourcedBy.associateId': req.user._id },
          ...(req.user.memberId ? [{ 'sourcedBy.associateMemberId': req.user.memberId }] : []),
          ...(req.user.email ? [{ 'sourcedBy.associateEmail': req.user.email.toLowerCase() }] : []),
          { createdBy: req.user.name || req.user.email },
        ],
      };
      if (query.$or) {
        query.$and = [{ $or: query.$or }, associateFilter];
        delete query.$or;
      } else {
        query.$or = associateFilter.$or;
      }
    } else {
      // Super Admin: allow filtering by associateId if provided in query
      if (req.query.associateId && req.query.associateId !== 'All') {
        if (req.query.associateId === 'none' || req.query.associateId === 'direct') {
          query.$or = [
            { 'sourcedBy.associateId': { $exists: false } },
            { 'sourcedBy.associateId': null },
            { 'sourcedBy.associateName': { $in: ['', null] } },
          ];
        } else {
          query['sourcedBy.associateId'] = req.query.associateId;
        }
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const total = await Investor.countDocuments(query);
    const investors = await Investor.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Fetch payouts for these investors to compute totalPaid and remainingLiability
    const investorIds = investors.map((inv) => inv._id);
    const payoutsAgg = await InvestorPayout.aggregate([
      { $match: { investor: { $in: investorIds }, status: 'Paid' } },
      { $group: { _id: '$investor', total: { $sum: '$amount' } } },
    ]);
    const payoutsMap = {};
    payoutsAgg.forEach((p) => {
      payoutsMap[p._id.toString()] = p.total;
    });

    // Mask sensitive documents in list view
    const maskedInvestors = investors.map((inv) => {
      let maskedAadhaar = '';
      if (inv.aadhaarNumber) {
        const clean = inv.aadhaarNumber.replace(/\D/g, '');
        maskedAadhaar = clean.length >= 4 ? `•••• •••• ${clean.slice(-4)}` : clean;
      }
      let maskedPan = '';
      if (inv.panNumber) {
        const clean = inv.panNumber.trim().toUpperCase();
        maskedPan = clean.length >= 5 ? `•••••${clean.slice(5, 9)}${clean.slice(9) || '•'}` : clean;
      }
      let maskedAccount = '';
      if (inv.bankDetails?.accountNumber) {
        const cleanAcct = inv.bankDetails.accountNumber.trim();
        maskedAccount = cleanAcct.length > 4 ? `•••• •••• ${cleanAcct.slice(-4)}` : cleanAcct;
      }

      const totalPaid = payoutsMap[inv._id.toString()] || 0;
      const investmentAmt = inv.verifiedInvestment || inv.totalInvestment || 0;
      const contractualLiability = inv.assignedPlan?.contractualLiability || investmentAmt;
      const remainingLiability = Math.max(0, contractualLiability - totalPaid);

      return {
        ...inv,
        aadhaarNumber: maskedAadhaar,
        panNumber: maskedPan,
        bankDetails: {
          ...inv.bankDetails,
          accountNumber: maskedAccount,
        },
        totalPaid,
        remainingLiability,
        remainingBalance: remainingLiability,
      };
    });

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      investors: maskedInvestors,
    });
  } catch (error) {
    console.error('getInvestors error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve investors list: ' + error.message,
    });
  }
};

/**
 * 3. Get Single Investor Complete Details (with Payments, Ledger, Payouts, Audit)
 */
const getInvestorById = async (req, res) => {
  try {
    const { id } = req.params;
    let investor = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      investor = await Investor.findById(id).lean();
    }
    if (!investor) {
      investor = await Investor.findOne({ investorId: id.toUpperCase() }).lean();
    }

    if (!investor) {
      return res.status(404).json({
        success: false,
        message: 'Investor not found with ID: ' + id,
      });
    }

    // Ensure initial investment record exists for this investor if they have capital
    await ensureInitialInvestmentRecord(investor);

    // Fetch all separate investment records for this investor
    const investments = await InvestmentRecord.find({ investor: investor._id })
      .sort({ investmentId: 1 })
      .lean();

    // Fetch related payment records
    const payments = await InvestorPayment.find({ investor: investor._id })
      .sort({ paymentDate: -1 })
      .lean();

    // Fetch chronological ledger entries
    const ledgerEntries = await InvestorLedgerEntry.find({ investor: investor._id })
      .sort({ date: 1, createdAt: 1 })
      .lean();

    // Fetch payouts & refunds
    const payouts = await InvestorPayout.find({ investor: investor._id })
      .sort({ payoutDate: -1 })
      .lean();

    // Fetch audit logs
    const auditLogs = await InvestorAuditLog.find({ investor: investor._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Compute live ledger balance
    const currentBalance = ledgerEntries.length > 0
      ? ledgerEntries[ledgerEntries.length - 1].runningBalance
      : 0;

    // Calculate overall investor profile summary
    const totalInvestmentCount = investments.length;
    const totalInvestmentAmount = investments.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const totalVerifiedPayments = investments
      .filter((inv) => inv.paymentStatus === 'Verified')
      .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const totalPaidPayouts = payouts
      .filter((p) => p.status === 'Paid')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalOutstandingLiability = investments.reduce(
      (sum, inv) => sum + Number(inv.tracking2x?.remainingPayout || 0),
      0
    );

    const investmentsSummary = {
      totalInvestmentCount,
      totalInvestmentAmount,
      totalVerifiedPayments,
      totalPayouts: totalPaidPayouts,
      totalOutstandingLiability,
    };

    // Compute or sync live 2X tracking record
    const origInv = totalVerifiedPayments > 0 ? totalVerifiedPayments : Number(investor.verifiedInvestment || investor.totalInvestment || 0);
    const planMult = Number(investor.assignedPlan?.multiplier || investor.tracking2x?.multiplier || 2);
    const targetAmt = totalOutstandingLiability > 0 ? (totalVerifiedPayments * planMult) : (investor.assignedPlan?.contractualTarget || (origInv * planMult));
    const paidSum = totalPaidPayouts;
    const remainingObligation = Math.max(0, targetAmt - paidSum);

    const liveTracking2x = {
      originalInvestment: origInv,
      multiplier: planMult,
      contractualPercentage: investor.assignedPlan?.contractualPercentage ?? (investor.tracking2x?.contractualPercentage || 100),
      percentageBasis: investor.assignedPlan?.percentageBasis || investor.tracking2x?.percentageBasis || 'Total Contractual Percentage',
      targetAmount: targetAmt,
      durationMonths: investor.assignedPlan?.durationMonths || investor.tracking2x?.durationMonths || 12,
      startDate: investor.assignedPlan?.assignedDate || investor.tracking2x?.startDate || investor.createdAt,
      maturityDate: investor.assignedPlan?.maturityDate || investor.tracking2x?.maturityDate || investor.maturityDate,
      totalEligiblePayouts: paidSum,
      remainingPayout: remainingObligation,
      status: investor.assignedPlan?.status || investor.tracking2x?.status || 'Pending',
      activatedAt: investor.tracking2x?.activatedAt || (investor.assignedPlan?.status === 'Active' ? investor.assignedPlan?.assignedDate : null),
      activatedBy: investor.tracking2x?.activatedBy || (investor.assignedPlan?.assignedBy || ''),
    };

    return res.status(200).json({
      success: true,
      investor: {
        ...investor,
        tracking2x: liveTracking2x,
        investments,
        investmentsSummary,
      },
      investments,
      investmentsSummary,
      payments,
      ledgerEntries,
      payouts,
      auditLogs,
      currentBalance,
      tracking2x: liveTracking2x,
    });
  } catch (error) {
    console.error('getInvestorById error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve investor details: ' + error.message,
    });
  }
};

/**
 * 4. Create New Investor (with KYC and Initial Payment Details)
 */
const createInvestor = async (req, res) => {
  try {
    const {
      fullName,
      mobile,
      email,
      dateOfBirth,
      address,
      state = 'Odisha',
      district,
      pinCode,
      aadhaarNumber,
      panNumber,
      bankAccountNumber,
      bankAccountHolderName,
      bankName,
      bankIfscCode,
      bankBranchName,
      investmentAmount,
      paymentDate,
      paymentMethod = 'UPI',
      utrNumber,
      adminRemarks,
      planCode,
      sendAcknowledgement = true,
    } = req.body;

    if (!fullName || !mobile || !email || !district) {
      return res.status(400).json({
        success: false,
        message: 'Full Name, Mobile Number, Email, and District are mandatory.',
      });
    }

    // Check duplicate mobile or email
    const existing = await Investor.findOne({
      $or: [{ mobile: mobile.trim() }, { email: email.trim().toLowerCase() }],
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `An investor with mobile ${mobile} or email ${email} is already registered (${existing.investorId}).`,
      });
    }

    // Check duplicate payment reference / UTR if provided on registration
    if (utrNumber && utrNumber.trim() && utrNumber.trim() !== 'PENDING-REF') {
      const existingPayment = await InvestorPayment.findOne({ utrNumber: utrNumber.trim() });
      if (existingPayment) {
        return res.status(400).json({
          success: false,
          message: `A payment with UTR / Transaction Reference "${utrNumber.trim()}" already exists in the system. Duplicate transactions are prevented.`,
        });
      }
    }

    const nextId = await generateNextInvestorId();

    // Process file uploads from multer
    const files = req.files || {};
    const getFileUrl = (field) => {
      if (files[field] && files[field][0]) {
        return `/uploads/documents/${files[field][0].filename}`;
      }
      return '';
    };

    const aadhaarFrontUrl = getFileUrl('aadhaarFront') || req.body.aadhaarFrontUrl || '';
    const aadhaarBackUrl = getFileUrl('aadhaarBack') || req.body.aadhaarBackUrl || '';
    const panCardUrl = getFileUrl('panCard') || req.body.panCardUrl || '';
    const paymentReceiptUrl = getFileUrl('paymentReceipt') || req.body.paymentReceiptUrl || '';
    const agreementDocUrl = getFileUrl('agreement') || getFileUrl('investmentAgreement') || req.body.agreementUrl || '';

    // Resolve Sourced By / Associate Referral Assignment
    let sourcedByData = undefined;
    if (req.user?.role === 'associate') {
      sourcedByData = {
        associateId: req.user._id,
        associateName: req.user.name || '',
        associateMobile: req.user.mobile || '',
        associateEmail: req.user.email || '',
        associateMemberId: req.user.memberId || '',
      };
    } else if (req.body.associateId && req.body.associateId !== 'none' && req.body.associateId !== '') {
      const assocUser = await User.findById(req.body.associateId).lean();
      if (assocUser) {
        let assocMobile = assocUser.mobile || '';
        if (assocUser.memberId) {
          const mem = await Member.findOne({ memberId: assocUser.memberId }).select('mobile contactDetails').lean();
          if (!assocMobile) assocMobile = mem?.mobile || mem?.contactDetails?.mobile || '';
        }
        sourcedByData = {
          associateId: assocUser._id,
          associateName: assocUser.name || '',
          associateMobile: assocMobile,
          associateEmail: assocUser.email || '',
          associateMemberId: assocUser.memberId || '',
        };
      }
    } else if (req.body.associateName || req.body.associateMobile) {
      sourcedByData = {
        associateName: (req.body.associateName || '').trim(),
        associateMobile: (req.body.associateMobile || '').trim(),
        associateEmail: (req.body.associateEmail || '').trim(),
        associateMemberId: (req.body.associateMemberId || '').trim(),
      };
    }

    const newInvestor = new Investor({
      investorId: nextId,
      fullName: fullName.trim(),
      mobile: mobile.trim(),
      email: email.trim().toLowerCase(),
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      address: (address || '').trim(),
      state: (state || 'Odisha').trim(),
      district: district.trim(),
      pinCode: (pinCode || '').trim(),
      aadhaarNumber: (aadhaarNumber || '').trim(),
      aadhaarFrontUrl,
      aadhaarBackUrl,
      panNumber: (panNumber || '').trim().toUpperCase(),
      panCardUrl,
      bankDetails: {
        accountNumber: (bankAccountNumber || '').trim(),
        accountHolderName: (bankAccountHolderName || fullName).trim(),
        bankName: (bankName || '').trim(),
        ifscCode: (bankIfscCode || '').trim().toUpperCase(),
        branchName: (bankBranchName || '').trim(),
      },
      investmentType: (req.body.investmentType || 'Term Capital').trim(),
      agreedReturnTerms: (req.body.agreedReturnTerms || 'As per Approved Agreement').trim(),
      investmentDate: paymentDate ? new Date(paymentDate) : new Date(),
      maturityDate: req.body.maturityDate ? new Date(req.body.maturityDate) : undefined,
      agreement: agreementDocUrl
        ? {
            agreementNumber: `UF-AGR-${nextId}`,
            status: 'Executed',
            agreementUrl: agreementDocUrl,
            generatedAt: new Date(),
            executedAt: new Date(),
            notes: 'Statutory investor agreement uploaded upon registration.',
          }
        : undefined,
      kycStatus: 'Pending',
      totalInvestment: Number(investmentAmount) || 0,
      verifiedInvestment: 0,
      // IMPORTANT: Payment uploaded is PENDING verification until admin approves
      paymentStatus: investmentAmount ? 'Pending' : 'None',
      status: req.user?.role === 'associate' ? 'Pending' : 'Active',
      approvalStage: req.user?.role === 'associate' ? 'pending_associate' : 'approved_by_admin',
      associateApproval: req.user?.role === 'associate' ? {
        status: 'Pending',
      } : undefined,
      adminApproval: req.user?.role === 'associate' ? {
        status: 'Pending',
      } : {
        status: 'Approved',
        approvedAt: new Date(),
        approvedBy: req.user?.name || 'Super Admin',
      },
      sourcedBy: sourcedByData,
      createdBy: req.user?.name || (req.user?.role === 'associate' ? 'Associate Member' : 'Super Admin'),
      adminRemarks: (adminRemarks || '').trim(),
    });

    // Optional initial plan assignment (Section 4)
    if (planCode) {
      await ensureDefaultPlansSeeded();
      const plan = await InvestmentPlan.findOne({ planCode: planCode.toUpperCase() });
      if (plan && plan.status === 'Approved') {
        const mult = req.body.multiplier ? Number(req.body.multiplier) : (plan.multiplier || 2);
        const duration = req.body.planDuration ? parseInt(req.body.planDuration, 10) : (plan.durationMonths || 12);
        const startDate = req.body.planAssignmentDate ? new Date(req.body.planAssignmentDate) : new Date();
        const maturityDate = new Date(startDate);
        maturityDate.setMonth(maturityDate.getMonth() + duration);

        const invAmount = Number(investmentAmount) || 0;
        const targetAmount = invAmount * mult;
        const contractualPercentage = req.body.contractualPercentage !== undefined && req.body.contractualPercentage !== ''
          ? Number(req.body.contractualPercentage)
          : (plan.approvedPercentage || 100);
        const percentageBasis = req.body.percentageBasis || plan.percentageBasis || 'Total Contractual Percentage';
        const agreementStatus = req.body.agreementStatus || (agreementDocUrl ? 'Signed' : 'Draft');
        const planActivationStatus = req.body.planActivationStatus || 'Pending';

        newInvestor.assignedPlan = {
          planId: plan._id,
          planCode: plan.planCode,
          planName: plan.name,
          version: plan.version || '1.0',
          multiplier: mult,
          contractualPercentage,
          percentageBasis,
          durationMonths: duration,
          terms: plan.terms,
          assignedAt: startDate,
          assignedDate: startDate,
          assignedBy: req.user?.name || 'Super Admin',
          status: planActivationStatus === 'Active' ? 'Active' : 'Pending',
          maturityDate,
          contractualTarget: targetAmount,
          contractualLiability: targetAmount,
          agreementStatus,
          agreementUrl: agreementDocUrl,
          planActivationStatus,
          notes: req.body.planNotes || '',
        };

        newInvestor.agreement = {
          agreementNumber: `UF-AGR-${nextId}`,
          status: agreementStatus === 'Approved' ? 'Executed' : agreementStatus,
          agreementUrl: agreementDocUrl,
          generatedAt: new Date(),
          notes: `Agreement initialized under ${plan.name} (${duration}M, ${mult}X target).`,
        };

        // Initialize 2X tracking record
        newInvestor.tracking2x = {
          originalInvestment: invAmount,
          multiplier: mult,
          contractualPercentage,
          percentageBasis,
          targetAmount,
          durationMonths: duration,
          startDate,
          maturityDate,
          totalEligiblePayouts: 0,
          remainingPayout: targetAmount,
          status: planActivationStatus === 'Active' ? 'Active' : 'Pending',
          activatedAt: planActivationStatus === 'Active' ? new Date() : undefined,
          activatedBy: planActivationStatus === 'Active' ? (req.user?.name || 'Super Admin') : '',
        };
      }
    }

    await newInvestor.save();

    // Create separate payment record if investment amount is provided
    let createdPayment = null;
    if (investmentAmount && Number(investmentAmount) > 0) {
      const paymentCount = await InvestorPayment.countDocuments();
      const paymentId = `PAY-INV-${(paymentCount + 1001).toString()}`;

      createdPayment = new InvestorPayment({
        paymentId,
        investor: newInvestor._id,
        investorId: nextId,
        investorName: newInvestor.fullName,
        amount: Number(investmentAmount),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        paymentMethod: paymentMethod || 'UPI',
        utrNumber: (utrNumber || 'PENDING-REF').trim(),
        receiptUrl: paymentReceiptUrl,
        status: 'Pending', // Strictly pending verification
        adminRemarks: (adminRemarks || 'Initial payment submitted on registration').trim(),
      });

      await createdPayment.save();
    }

    // Log Audit
    await InvestorAuditLog.create({
      investor: newInvestor._id,
      investorId: nextId,
      action: 'Investor Registered',
      category: 'Registration',
      performedBy: req.user?.name || 'Super Admin',
      details: `Registered new investor ${newInvestor.fullName} (${nextId}) with initial investment ₹${investmentAmount || 0}.`,
    });

    // Send registration email and SMS acknowledgements
    if (sendAcknowledgement === true || sendAcknowledgement === 'true') {
      // 1. Email Acknowledgement
      sendInvestorRegistrationEmail(newInvestor)
        .then(async (emailRes) => {
          await logCommunicationRecord(newInvestor._id, {
            channel: 'Email',
            category: 'Registration',
            recipient: emailRes.recipient || maskEmail(newInvestor.email),
            subject: emailRes.subject || `Registration Acknowledgement [${nextId}]`,
            messageSummary: emailRes.messageSummary || emailRes.error,
            status: emailRes.success ? 'Sent' : 'Failed',
            provider: 'SMTP / Nodemailer',
            messageId: emailRes.messageId || '',
            errorMessage: emailRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Registration email error:', err.message));

      // 2. SMS Acknowledgement
      sendInvestorRegistrationSms(newInvestor)
        .then(async (smsRes) => {
          await logCommunicationRecord(newInvestor._id, {
            channel: 'SMS',
            category: 'Registration',
            recipient: smsRes.recipient || maskMobile(newInvestor.mobile),
            subject: 'SMS: Registration Acknowledgement',
            messageSummary: smsRes.messageSummary || smsRes.error,
            status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
            provider: smsRes.provider || 'SMS Gateway',
            messageId: smsRes.messageId || '',
            errorMessage: smsRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Registration SMS error:', err.message));
    }

    return res.status(201).json({
      success: true,
      message: `Investor ${newInvestor.fullName} (${nextId}) registered successfully.`,
      investor: newInvestor,
      payment: createdPayment,
    });
  } catch (error) {
    console.error('createInvestor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create investor: ' + error.message,
    });
  }
};

/**
 * 5. Update Investor Personal & Bank Details
 */
const updateInvestor = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName,
      mobile,
      email,
      dateOfBirth,
      address,
      state,
      district,
      pinCode,
      aadhaarNumber,
      panNumber,
      bankAccountNumber,
      bankAccountHolderName,
      bankName,
      bankIfscCode,
      bankBranchName,
      adminRemarks,
      status,
    } = req.body;

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found' });
    }

    if (fullName) investor.fullName = fullName.trim();
    if (mobile) investor.mobile = mobile.trim();
    if (email) investor.email = email.trim().toLowerCase();
    if (dateOfBirth) investor.dateOfBirth = new Date(dateOfBirth);
    if (address !== undefined) investor.address = address.trim();
    if (state !== undefined) investor.state = state.trim();
    if (district) investor.district = district.trim();
    if (pinCode !== undefined) investor.pinCode = pinCode.trim();
    if (aadhaarNumber !== undefined && !aadhaarNumber.includes('••••')) {
      investor.aadhaarNumber = aadhaarNumber.trim();
    }
    if (panNumber !== undefined && !panNumber.includes('••••')) {
      investor.panNumber = panNumber.trim().toUpperCase();
    }

    if (bankAccountNumber !== undefined) investor.bankDetails.accountNumber = bankAccountNumber.trim();
    if (bankAccountHolderName !== undefined) investor.bankDetails.accountHolderName = bankAccountHolderName.trim();
    if (bankName !== undefined) investor.bankDetails.bankName = bankName.trim();
    if (bankIfscCode !== undefined) investor.bankDetails.ifscCode = bankIfscCode.trim().toUpperCase();
    if (bankBranchName !== undefined) investor.bankDetails.branchName = bankBranchName.trim();
    if (adminRemarks !== undefined) investor.adminRemarks = adminRemarks.trim();
    if (status) investor.status = status;

    // Handle Associate assignment update by Super Admin
    if (req.user?.role !== 'associate' && req.body.associateId !== undefined) {
      if (req.body.associateId === 'none' || req.body.associateId === '' || !req.body.associateId) {
        investor.sourcedBy = {
          associateId: null,
          associateName: '',
          associateMobile: '',
          associateEmail: '',
          associateMemberId: '',
        };
      } else {
        const assocUser = await User.findById(req.body.associateId).lean();
        if (assocUser) {
          let assocMobile = assocUser.mobile || '';
          if (assocUser.memberId) {
            const mem = await Member.findOne({ memberId: assocUser.memberId }).select('mobile contactDetails').lean();
            if (!assocMobile) assocMobile = mem?.mobile || mem?.contactDetails?.mobile || '';
          }
          investor.sourcedBy = {
            associateId: assocUser._id,
            associateName: assocUser.name || '',
            associateMobile: assocMobile,
            associateEmail: assocUser.email || '',
            associateMemberId: assocUser.memberId || '',
          };
        }
      }
    }

    // Handle uploaded files if provided
    const files = req.files || {};
    if (files.aadhaarFront && files.aadhaarFront[0]) {
      investor.aadhaarFrontUrl = `/uploads/documents/${files.aadhaarFront[0].filename}`;
    }
    if (files.aadhaarBack && files.aadhaarBack[0]) {
      investor.aadhaarBackUrl = `/uploads/documents/${files.aadhaarBack[0].filename}`;
    }
    if (files.panCard && files.panCard[0]) {
      investor.panCardUrl = `/uploads/documents/${files.panCard[0].filename}`;
    }
    if (files.paymentReceipt && files.paymentReceipt[0]) {
      investor.paymentReceiptUrl = `/uploads/documents/${files.paymentReceipt[0].filename}`;
    }
    if (files.agreement && files.agreement[0]) {
      if (!investor.assignedPlan) investor.assignedPlan = {};
      investor.assignedPlan.agreementUrl = `/uploads/documents/${files.agreement[0].filename}`;
      investor.agreement = investor.agreement || {};
      investor.agreement.agreementUrl = `/uploads/documents/${files.agreement[0].filename}`;
    }

    await investor.save();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Investor Details Updated',
      category: 'Registration',
      performedBy: req.user?.name || 'Super Admin',
      details: `Profile and bank details updated for ${investor.fullName}.`,
    });

    return res.status(200).json({
      success: true,
      message: 'Investor updated successfully.',
      investor,
    });
  } catch (error) {
    console.error('updateInvestor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update investor: ' + error.message,
    });
  }
};

/**
 * 6. Verify or Reject KYC
 */
const verifyKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason = '' } = req.body;

    if (!['Verified', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid KYC status. Must be Verified, Rejected, or Pending.',
      });
    }

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found' });
    }

    investor.kycStatus = status;
    investor.kycVerifiedBy = req.user?.name || 'Super Admin';
    investor.kycVerifiedAt = new Date();
    investor.kycRejectionReason = status === 'Rejected' ? rejectionReason : '';

    await investor.save();

    // Trigger KYC Status notifications (Email & SMS) in background
    if (status === 'Verified' || status === 'Rejected') {
      sendKycStatusEmail({
        investor,
        status,
        reason: rejectionReason,
      })
        .then(async (emailRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'Email',
            category: 'KycStatus',
            recipient: emailRes.recipient || maskEmail(investor.email),
            subject: emailRes.subject || `KYC Status: ${status}`,
            messageSummary: emailRes.messageSummary || emailRes.error,
            status: emailRes.success ? 'Sent' : 'Failed',
            provider: 'SMTP / Nodemailer',
            messageId: emailRes.messageId || '',
            errorMessage: emailRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('KYC status email error:', err.message));

      sendKycStatusSms({
        investor,
        status,
        reason: rejectionReason,
      })
        .then(async (smsRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'SMS',
            category: 'KycStatus',
            recipient: smsRes.recipient || maskMobile(investor.mobile),
            subject: `SMS: KYC ${status}`,
            messageSummary: smsRes.messageSummary || smsRes.error,
            status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
            provider: smsRes.provider || 'SMS Gateway',
            messageId: smsRes.messageId || '',
            errorMessage: smsRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('KYC status SMS error:', err.message));
    }

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: `KYC ${status}`,
      category: 'KYC',
      performedBy: req.user?.name || 'Super Admin',
      details: status === 'Verified' ? 'KYC documents verified and approved.' : `KYC rejected: ${rejectionReason}`,
    });

    return res.status(200).json({
      success: true,
      message: `KYC marked as ${status} for ${investor.fullName}.`,
      investor,
    });
  } catch (error) {
    console.error('verifyKyc error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update KYC status: ' + error.message,
    });
  }
};

/**
 * 7. Record Additional Payment
 */
const recordPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentDate, paymentMethod = 'UPI', utrNumber, adminRemarks } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required.' });
    }
    if (!utrNumber || !utrNumber.trim()) {
      return res.status(400).json({ success: false, message: 'UTR / Transaction reference is required.' });
    }

    // Prevent duplicate payment entry with same UTR
    const existingPayment = await InvestorPayment.findOne({ utrNumber: utrNumber.trim() });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: `A payment record with UTR / Transaction Reference "${utrNumber.trim()}" already exists. Duplicate transactions are prevented.`,
      });
    }

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found' });
    }

    let receiptUrl = '';
    if (req.file) {
      receiptUrl = `/uploads/documents/${req.file.filename}`;
    }

    const paymentCount = await InvestorPayment.countDocuments();
    const paymentId = `PAY-INV-${(paymentCount + 1001).toString()}`;

    const newPayment = new InvestorPayment({
      paymentId,
      investor: investor._id,
      investorId: investor.investorId,
      investorName: investor.fullName,
      amount: Number(amount),
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod,
      utrNumber: utrNumber.trim(),
      receiptUrl,
      status: 'Pending', // strictly pending until authorized admin verifies
      adminRemarks: (adminRemarks || '').trim(),
    });

    await newPayment.save();

    // Update investor's cumulative total investment
    investor.totalInvestment = (investor.totalInvestment || 0) + Number(amount);
    if (investor.paymentStatus !== 'Verified') {
      investor.paymentStatus = 'Pending';
    }
    await investor.save();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Additional Payment Recorded',
      category: 'Payment',
      performedBy: req.user?.name || 'Super Admin',
      details: `Recorded ₹${amount} with UTR ${utrNumber} (Status: Pending Verification).`,
    });

    return res.status(201).json({
      success: true,
      message: 'Payment recorded successfully. Awaiting admin verification.',
      payment: newPayment,
      investor,
    });
  } catch (error) {
    console.error('recordPayment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record payment: ' + error.message,
    });
  }
};

/**
 * 8. Verify or Reject Payment
 * CRITICAL FINANCIAL LOGIC:
 * When payment is verified by admin:
 * 1. Mark payment as 'Verified'
 * 2. Update investor.verifiedInvestment
 * 3. Automatically post Credit transaction to InvestorLedgerEntry
 * 4. Update running balance
 */
const verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { status, adminRemarks = '', rejectionReason = '' } = req.body;

    if (!['Verified', 'Rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status. Must be Verified or Rejected.',
      });
    }

    const payment = await InvestorPayment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    if (payment.status === 'Verified' && status === 'Verified') {
      return res.status(400).json({ success: false, message: 'Payment is already verified.' });
    }

    const investor = await Investor.findById(payment.investor);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor associated with this payment not found.' });
    }

    payment.status = status;
    payment.verifiedBy = req.user?.name || 'Super Admin';
    payment.verifiedAt = new Date();
    if (adminRemarks) payment.adminRemarks = adminRemarks.trim();
    if (status === 'Rejected') payment.rejectionReason = rejectionReason.trim();

    if (status === 'Verified') {
      // 1. Recalculate verified investment sum from all verified payments
      const existingVerifiedSum = await InvestorPayment.aggregate([
        { $match: { investor: investor._id, status: 'Verified', _id: { $ne: payment._id } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const prevVerified = existingVerifiedSum[0]?.total || 0;
      const newVerified = prevVerified + payment.amount;

      investor.verifiedInvestment = newVerified;
      investor.paymentStatus = 'Verified';

      // 2. Fetch last ledger entry to determine current running balance
      const lastLedger = await InvestorLedgerEntry.findOne({ investor: investor._id })
        .sort({ date: -1, createdAt: -1 })
        .lean();

      const prevBalance = lastLedger ? Number(lastLedger.runningBalance || 0) : 0;
      const newBalance = prevBalance + payment.amount;

      const ledgerCount = await InvestorLedgerEntry.countDocuments();
      const transactionId = `TXN-INV-${(ledgerCount + 5001).toString()}`;

      const ledgerCategory = prevBalance === 0 ? 'Initial Investment' : 'Additional Verified Receipt';

      const ledgerEntry = new InvestorLedgerEntry({
        transactionId,
        investor: investor._id,
        investorId: investor.investorId,
        date: payment.paymentDate || new Date(),
        description: `Verified Investment Receipt via ${payment.paymentMethod} (UTR: ${payment.utrNumber})`,
        category: ledgerCategory,
        type: 'Credit',
        credit: payment.amount,
        debit: 0,
        runningBalance: newBalance,
        reference: payment.utrNumber,
        verificationStatus: 'Verified',
        remarks: adminRemarks || `Verified by ${req.user?.name || 'Super Admin'}`,
        createdBy: req.user?.name || 'Super Admin',
        auditTrail: [
          {
            action: 'Credit Verified',
            performedBy: req.user?.name || 'Super Admin',
            timestamp: new Date(),
            details: `Credit of ₹${payment.amount} verified under UTR ${payment.utrNumber}. New ledger balance ₹${newBalance}.`,
          },
        ],
      });

      await ledgerEntry.save();
      payment.ledgerEntryId = ledgerEntry._id;

      // 3. Automatically create/update 2X Ledger Tracking record upon payment verification
      const mult = Number(investor.assignedPlan?.multiplier || investor.tracking2x?.multiplier || 2);
      const targetAmount = Math.round(newVerified * mult);

      const paidSumResult = await InvestorPayout.aggregate([
        { $match: { investor: investor._id, status: { $in: ['Paid', 'Approved', 'Disbursed', 'Completed'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const totalPaid = paidSumResult[0]?.total || 0;
      const remaining = Math.max(0, targetAmount - totalPaid);

      if (investor.assignedPlan && investor.assignedPlan.planCode) {
        investor.assignedPlan.status = 'Active';
        investor.assignedPlan.planActivationStatus = 'Active';
        investor.assignedPlan.contractualTarget = targetAmount;
        investor.assignedPlan.contractualLiability = remaining;
        if (investor.agreement && investor.agreement.status === 'Draft') {
          investor.agreement.status = 'Generated';
          investor.agreement.generatedAt = new Date();
        }
      }

      investor.tracking2x = {
        originalInvestment: newVerified,
        multiplier: mult,
        contractualPercentage: investor.assignedPlan?.contractualPercentage ?? 100,
        percentageBasis: investor.assignedPlan?.percentageBasis || 'Total Contractual Percentage',
        targetAmount,
        durationMonths: investor.assignedPlan?.durationMonths || 24,
        startDate: investor.assignedPlan?.assignedDate || investor.createdAt || new Date(),
        maturityDate: investor.assignedPlan?.maturityDate || (investor.assignedPlan?.durationMonths ? new Date(Date.now() + investor.assignedPlan.durationMonths * 30 * 24 * 3600 * 1000) : undefined),
        totalEligiblePayouts: totalPaid,
        remainingPayout: remaining,
        status: 'Active',
        activatedAt: new Date(),
        activatedBy: req.user?.name || 'Super Admin',
      };
    } else {
      // If rejected and no other verified payments, mark status rejected
      const hasVerified = await InvestorPayment.exists({
        investor: investor._id,
        status: 'Verified',
        _id: { $ne: payment._id },
      });
      if (!hasVerified) {
        investor.paymentStatus = 'Rejected';
      }
    }

    await payment.save();
    await investor.save();

    // Trigger Investment Confirmation Notification (Email & SMS) if payment was verified
    if (status === 'Verified') {
      const planToSend = investor.assignedPlan && investor.assignedPlan.planName ? investor.assignedPlan : null;
      if (planToSend) {
        sendInvestmentConfirmationEmail({
          investor,
          payment,
          plan: planToSend,
        })
          .then(async (emailRes) => {
            await logCommunicationRecord(investor._id, {
              channel: 'Email',
              category: 'PaymentConfirmation',
              recipient: emailRes.recipient || maskEmail(investor.email),
              subject: emailRes.subject || 'Investment Payment Confirmation',
              messageSummary: emailRes.messageSummary || emailRes.error,
              status: emailRes.success ? 'Sent' : 'Failed',
              provider: 'SMTP / Nodemailer',
              messageId: emailRes.messageId || '',
              errorMessage: emailRes.error || '',
              sentBy: req.user?.name || 'Super Admin',
            });
          })
          .catch((err) => console.warn('Payment confirmation email error:', err.message));
      }

      sendPaymentConfirmationSms({
        investor,
        payment,
      })
        .then(async (smsRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'SMS',
            category: 'PaymentConfirmation',
            recipient: smsRes.recipient || maskMobile(investor.mobile),
            subject: 'SMS: Payment Verified',
            messageSummary: smsRes.messageSummary || smsRes.error,
            status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
            provider: smsRes.provider || 'SMS Gateway',
            messageId: smsRes.messageId || '',
            errorMessage: smsRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Payment confirmation SMS error:', err.message));
    }

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: `Payment ${status}`,
      category: 'Payment',
      performedBy: req.user?.name || 'Super Admin',
      details: status === 'Verified'
        ? `Payment of ₹${payment.amount} (UTR: ${payment.utrNumber}) verified and credited to ledger.`
        : `Payment of ₹${payment.amount} rejected: ${rejectionReason}`,
    });

    return res.status(200).json({
      success: true,
      message: `Payment of ₹${payment.amount} has been marked as ${status}.`,
      payment,
      investor,
    });
  } catch (error) {
    console.error('verifyPayment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment: ' + error.message,
    });
  }
};

/**
 * 9. Get Available Investment Plans
 */
const getInvestmentPlans = async (req, res) => {
  try {
    await ensureDefaultPlansSeeded();
    const plans = await InvestmentPlan.find().sort({ createdAt: 1 }).lean();
    return res.status(200).json({ success: true, plans });
  } catch (error) {
    console.error('getInvestmentPlans error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch investment plans.' });
  }
};

/**
 * 10. Assign Investment Plan & Generate Agreement
 */
const assignPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      planCode,
      multiplier,
      contractualPercentage,
      percentageBasis,
      customDurationMonths,
      planAssignmentDate,
      agreementStatus = 'Draft',
      planActivationStatus = 'Pending',
      auditReason,
      notes,
    } = req.body;

    if (!planCode) {
      return res.status(400).json({ success: false, message: 'Plan Code is required.' });
    }

    await ensureDefaultPlansSeeded();
    const plan = await InvestmentPlan.findOne({ planCode: planCode.toUpperCase() });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Investment Plan not found.' });
    }

    // Only approved plans should be available for assignment
    if (plan.status !== 'Approved') {
      return res.status(400).json({
        success: false,
        message: 'This investment plan is in Draft or Disabled status awaiting formal regulatory/company compliance approval. Only Approved plans can be assigned.',
      });
    }

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    const duration = customDurationMonths ? parseInt(customDurationMonths, 10) : (plan.durationMonths || 24);
    const startDate = planAssignmentDate ? new Date(planAssignmentDate) : new Date();
    const maturityDate = new Date(startDate);
    maturityDate.setMonth(maturityDate.getMonth() + duration);

    const mult = multiplier !== undefined && Number(multiplier) > 0 ? Number(multiplier) : (plan.multiplier || 2);
    const contPct = contractualPercentage !== undefined && contractualPercentage !== '' ? Number(contractualPercentage) : (plan.approvedPercentage ?? 100);
    const pctBasis = percentageBasis || plan.percentageBasis || 'Total Contractual Percentage';

    const invAmount = investor.verifiedInvestment > 0 ? investor.verifiedInvestment : (investor.totalInvestment || 0);
    const targetAmount = Math.round(invAmount * mult);

    // Sum all eligible payouts made so far
    const paidSumResult = await InvestorPayout.aggregate([
      { $match: { investor: investor._id, status: { $in: ['Paid', 'Approved', 'Disbursed', 'Completed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalPaid = paidSumResult[0]?.total || 0;
    const remainingPayout = Math.max(0, targetAmount - totalPaid);

    // Archive previous plan to planHistory if one was active
    if (investor.assignedPlan && investor.assignedPlan.planCode) {
      investor.planHistory.push({
        planCode: investor.assignedPlan.planCode,
        planName: investor.assignedPlan.planName,
        version: investor.assignedPlan.version,
        durationMonths: investor.assignedPlan.durationMonths,
        assignedAt: investor.assignedPlan.assignedAt,
        assignedBy: investor.assignedPlan.assignedBy,
        terms: investor.assignedPlan.terms,
        status: investor.assignedPlan.status,
      });
    }

    const isPlanActive = planActivationStatus === 'Active' || (investor.paymentStatus === 'Verified' && planActivationStatus !== 'Pending');
    const finalPlanStatus = isPlanActive ? 'Active' : 'Pending';

    investor.assignedPlan = {
      planId: plan._id,
      planCode: plan.planCode,
      planName: plan.name,
      version: plan.version,
      multiplier: mult,
      contractualPercentage: contPct,
      percentageBasis: pctBasis,
      durationMonths: duration,
      terms: plan.terms,
      assignedAt: startDate,
      assignedDate: startDate,
      assignedBy: req.user?.name || 'Super Admin',
      status: finalPlanStatus,
      maturityDate,
      contractualTarget: targetAmount,
      contractualLiability: remainingPayout,
      agreementStatus,
      planActivationStatus: finalPlanStatus,
      notes: notes || '',
    };

    // Initialize or sync dedicated 2X tracking record
    investor.tracking2x = {
      originalInvestment: invAmount,
      multiplier: mult,
      contractualPercentage: contPct,
      percentageBasis: pctBasis,
      targetAmount,
      durationMonths: duration,
      startDate,
      maturityDate,
      totalEligiblePayouts: totalPaid,
      remainingPayout,
      status: finalPlanStatus,
      activatedAt: finalPlanStatus === 'Active' ? new Date() : undefined,
      activatedBy: finalPlanStatus === 'Active' ? (req.user?.name || 'Super Admin') : '',
    };

    // Auto-generate standard agreement reference
    if (!investor.agreement || !investor.agreement.agreementNumber) {
      investor.agreement = {
        agreementNumber: `UF-AGR-${investor.investorId}`,
        status: finalPlanStatus === 'Active' ? 'Executed' : agreementStatus,
        generatedAt: new Date(),
        notes: `Agreement generated under ${plan.name} (${duration} Months, ${mult}X target).`,
      };
    }

    await investor.save();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Investment Plan Assigned',
      category: 'PlanAssignment',
      performedBy: req.user?.name || 'Super Admin',
      details: `Assigned approved plan ${plan.name} (${duration}M, ${mult}X) to ${investor.fullName}. Target: ₹${targetAmount}. Reason: ${auditReason || 'Plan assigned by admin'}. Status: ${finalPlanStatus}.`,
    });

    return res.status(200).json({
      success: true,
      message: `Plan ${plan.name} assigned successfully. Contractual target: ₹${targetAmount}.`,
      investor,
    });
  } catch (error) {
    console.error('assignPlan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign plan: ' + error.message,
    });
  }
};

/**
 * 10B. Activate Investor Plan (Admin manual/override activation after payment verification)
 */
const activateInvestorPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { auditReason } = req.body;

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    if (!investor.assignedPlan || !investor.assignedPlan.planCode) {
      return res.status(400).json({ success: false, message: 'No investment plan is currently assigned to this investor.' });
    }

    if (investor.paymentStatus !== 'Verified') {
      return res.status(400).json({
        success: false,
        message: 'Cannot activate plan until the investment payment is formally verified by the administrator.',
      });
    }

    const mult = Number(investor.assignedPlan.multiplier || investor.tracking2x?.multiplier || 2);
    const invAmount = investor.verifiedInvestment > 0 ? investor.verifiedInvestment : (investor.totalInvestment || 0);
    const targetAmount = Math.round(invAmount * mult);

    const paidSumResult = await InvestorPayout.aggregate([
      { $match: { investor: investor._id, status: { $in: ['Paid', 'Approved', 'Disbursed', 'Completed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalPaid = paidSumResult[0]?.total || 0;
    const remainingPayout = Math.max(0, targetAmount - totalPaid);

    investor.assignedPlan.status = 'Active';
    investor.assignedPlan.planActivationStatus = 'Active';
    investor.assignedPlan.contractualTarget = targetAmount;
    investor.assignedPlan.contractualLiability = remainingPayout;

    if (investor.agreement) {
      investor.agreement.status = 'Executed';
      investor.agreement.executedAt = new Date();
    }

    investor.tracking2x = {
      originalInvestment: invAmount,
      multiplier: mult,
      contractualPercentage: investor.assignedPlan.contractualPercentage ?? 100,
      percentageBasis: investor.assignedPlan.percentageBasis || 'Total Contractual Percentage',
      targetAmount,
      durationMonths: investor.assignedPlan.durationMonths || 24,
      startDate: investor.assignedPlan.assignedDate || new Date(),
      maturityDate: investor.assignedPlan.maturityDate,
      totalEligiblePayouts: totalPaid,
      remainingPayout,
      status: 'Active',
      activatedAt: new Date(),
      activatedBy: req.user?.name || 'Super Admin',
    };

    await investor.save();

    // Trigger Investment Plan Activation Notification (Email & SMS) in background
    sendPlanActivationEmail({
      investor,
      plan: investor.assignedPlan,
      tracking2x: investor.tracking2x,
    })
      .then(async (emailRes) => {
        await logCommunicationRecord(investor._id, {
          channel: 'Email',
          category: 'PlanActivation',
          recipient: emailRes.recipient || maskEmail(investor.email),
          subject: emailRes.subject || 'Investment Plan Activated',
          messageSummary: emailRes.messageSummary || emailRes.error,
          status: emailRes.success ? 'Sent' : 'Failed',
          provider: 'SMTP / Nodemailer',
          messageId: emailRes.messageId || '',
          errorMessage: emailRes.error || '',
          sentBy: req.user?.name || 'Super Admin',
        });
      })
      .catch((err) => console.warn('Plan activation email error:', err.message));

    sendPlanActivationSms({
      investor,
      plan: investor.assignedPlan,
      tracking2x: investor.tracking2x,
    })
      .then(async (smsRes) => {
        await logCommunicationRecord(investor._id, {
          channel: 'SMS',
          category: 'PlanActivation',
          recipient: smsRes.recipient || maskMobile(investor.mobile),
          subject: 'SMS: Plan Activated',
          messageSummary: smsRes.messageSummary || smsRes.error,
          status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
          provider: smsRes.provider || 'SMS Gateway',
          messageId: smsRes.messageId || '',
          errorMessage: smsRes.error || '',
          sentBy: req.user?.name || 'Super Admin',
        });
      })
      .catch((err) => console.warn('Plan activation SMS error:', err.message));

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Plan Activated',
      category: 'PlanActivation',
      performedBy: req.user?.name || 'Super Admin',
      details: `Plan ${investor.assignedPlan.planName} activated with ${mult}X target ₹${targetAmount}. Reason: ${auditReason || 'Administrative approval'}.`,
    });

    return res.status(200).json({
      success: true,
      message: `Plan activated successfully. 2X Tracking Target: ₹${targetAmount}.`,
      investor,
    });
  } catch (error) {
    console.error('activateInvestorPlan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to activate plan: ' + error.message,
    });
  }
};

/**
 * 10C. Create Investment Plan (Admin Plan Configuration)
 */
const createInvestmentPlan = async (req, res) => {
  try {
    const {
      planCode,
      name,
      version = '1.0',
      multiplier = 2,
      approvedPercentage = 100,
      percentageBasis = 'Total Contractual Percentage',
      durationMonths = 24,
      availableDurations = [12, 18, 24, 36, 48, 60],
      minAmount = 5000,
      maxAmount = 10000000,
      terms,
      status = 'Approved',
      regulatoryNotice,
    } = req.body;

    if (!planCode || !name || !terms) {
      return res.status(400).json({ success: false, message: 'Plan Code, Plan Name, and Agreement Terms are required.' });
    }

    const existing = await InvestmentPlan.findOne({ planCode: planCode.trim().toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: `A plan with code "${planCode}" already exists.` });
    }

    const newPlan = new InvestmentPlan({
      planCode: planCode.trim().toUpperCase(),
      name: name.trim(),
      version: version.trim(),
      multiplier: Number(multiplier) || 2,
      approvedPercentage: Number(approvedPercentage) || 0,
      percentageBasis,
      durationMonths: Number(durationMonths) || 24,
      availableDurations: Array.isArray(availableDurations) && availableDurations.length ? availableDurations : [Number(durationMonths) || 24],
      minAmount: Number(minAmount) || 1000,
      maxAmount: Number(maxAmount) || 10000000,
      terms: terms.trim(),
      status: ['Approved', 'Draft', 'Disabled'].includes(status) ? status : 'Approved',
      is2x3xStructure: false,
      regulatoryNotice: regulatoryNotice || 'Subject to statutory cooperative norms. Approved under company framework.',
      approvedBy: req.user?.name || 'Executive Board',
      approvedDate: new Date(),
    });

    await newPlan.save();
    return res.status(201).json({ success: true, message: 'Investment plan created successfully.', plan: newPlan });
  } catch (error) {
    console.error('createInvestmentPlan error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create plan: ' + error.message });
  }
};

/**
 * 10D. Update Investment Plan (Admin Plan Configuration)
 */
const updateInvestmentPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      multiplier,
      approvedPercentage,
      percentageBasis,
      durationMonths,
      availableDurations,
      minAmount,
      maxAmount,
      terms,
      status,
      regulatoryNotice,
    } = req.body;

    const plan = await InvestmentPlan.findById(id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Investment plan not found.' });
    }

    if (name) plan.name = name.trim();
    if (multiplier !== undefined) plan.multiplier = Number(multiplier);
    if (approvedPercentage !== undefined) plan.approvedPercentage = Number(approvedPercentage);
    if (percentageBasis) plan.percentageBasis = percentageBasis;
    if (durationMonths !== undefined) plan.durationMonths = Number(durationMonths);
    if (availableDurations && Array.isArray(availableDurations)) plan.availableDurations = availableDurations;
    if (minAmount !== undefined) plan.minAmount = Number(minAmount);
    if (maxAmount !== undefined) plan.maxAmount = Number(maxAmount);
    if (terms) plan.terms = terms.trim();
    if (status && ['Approved', 'Draft', 'Disabled'].includes(status)) plan.status = status;
    if (regulatoryNotice) plan.regulatoryNotice = regulatoryNotice.trim();

    await plan.save();
    return res.status(200).json({ success: true, message: 'Investment plan updated successfully.', plan });
  } catch (error) {
    console.error('updateInvestmentPlan error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update plan: ' + error.message });
  }
};

/**
 * 11. Record Authorized Payout or Refund
 * When marked 'Paid':
 * Automatically debits the investor ledger and reduces the running balance!
 */
const recordPayoutOrRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const { category = 'Payout', amount, paymentMethod = 'Bank Transfer', reference, adminRemarks } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required.' });
    }

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    const payoutCount = await InvestorPayout.countDocuments();
    const payoutId = `PAYOUT-INV-${(payoutCount + 1001).toString()}`;

    // Get current ledger balance to ensure payout does not exceed verified funds
    const lastLedger = await InvestorLedgerEntry.findOne({ investor: investor._id })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const currentBalance = lastLedger ? Number(lastLedger.runningBalance || 0) : 0;

    const payoutAmount = Number(amount);
    if (payoutAmount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: `Payout amount (₹${payoutAmount}) exceeds current verified ledger balance (₹${currentBalance}).`,
      });
    }

    // Prevent duplicate payout with same reference
    if (reference && reference.trim()) {
      const existingPayout = await InvestorPayout.findOne({ reference: reference.trim() });
      if (existingPayout) {
        return res.status(400).json({
          success: false,
          message: `A payout record with Reference "${reference.trim()}" already exists. Duplicate payouts are prevented.`,
        });
      }
    }

    const newPayout = new InvestorPayout({
      payoutId,
      investor: investor._id,
      investorId: investor.investorId,
      category: category === 'Refund' ? 'Refund' : 'Payout',
      amount: payoutAmount,
      paymentMethod,
      reference: (reference || 'NEFT/IMPS-DISBURSED').trim(),
      payoutDate: new Date(),
      status: 'Paid', // Authorized payout directly marked as Paid
      bankDetails: investor.bankDetails,
      approvedBy: req.user?.name || 'Super Admin',
      approvedAt: new Date(),
      disbursedBy: req.user?.name || 'Super Admin',
      disbursedAt: new Date(),
      adminRemarks: (adminRemarks || '').trim(),
    });

    // Debit the investor ledger
    const newBalance = currentBalance - payoutAmount;
    const ledgerCount = await InvestorLedgerEntry.countDocuments();
    const transactionId = `TXN-INV-${(ledgerCount + 5001).toString()}`;

    const ledgerEntry = new InvestorLedgerEntry({
      transactionId,
      investor: investor._id,
      investorId: investor.investorId,
      date: new Date(),
      description: `${category} Disbursed via ${paymentMethod} (Ref: ${reference || 'IMPS'})`,
      category: category === 'Refund' ? 'Refund' : 'Approved Payout',
      type: 'Debit',
      credit: 0,
      debit: payoutAmount,
      runningBalance: newBalance,
      reference: reference || payoutId,
      verificationStatus: 'Verified',
      remarks: adminRemarks || `${category} processed by ${req.user?.name || 'Super Admin'}`,
      createdBy: req.user?.name || 'Super Admin',
      auditTrail: [
        {
          action: 'Debit Processed',
          performedBy: req.user?.name || 'Super Admin',
          timestamp: new Date(),
          details: `Debit of ₹${payoutAmount} processed for ${category}. New ledger balance ₹${newBalance}.`,
        },
      ],
    });

    await ledgerEntry.save();
    newPayout.ledgerEntryId = ledgerEntry._id;
    await newPayout.save();

    // Update 2X Tracking and contractual liability upon payout
    if (category !== 'Refund') {
      const allPaidAgg = await InvestorPayout.aggregate([
        { $match: { investor: investor._id, status: { $in: ['Paid', 'Approved', 'Disbursed', 'Completed'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const totalPaid = allPaidAgg[0]?.total || 0;
      if (investor.tracking2x && investor.tracking2x.targetAmount) {
        investor.tracking2x.totalEligiblePayouts = totalPaid;
        investor.tracking2x.remainingPayout = Math.max(0, investor.tracking2x.targetAmount - totalPaid);
      }
      if (investor.assignedPlan && investor.assignedPlan.contractualTarget) {
        investor.assignedPlan.contractualLiability = Math.max(0, investor.assignedPlan.contractualTarget - totalPaid);
      }
      await investor.save();
    }

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: `${category} Disbursed`,
      category: 'Payout',
      performedBy: req.user?.name || 'Super Admin',
      details: `${category} of ₹${payoutAmount} disbursed to ${investor.fullName} (Ref: ${reference}). Ledger updated.`,
    });

    // Trigger Payout or Refund Notification (Email & SMS) in background
    if (category === 'Refund') {
      sendRefundConfirmationEmail({ investor, refund: newPayout })
        .then(async (emailRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'Email',
            category: 'Refund',
            recipient: emailRes.recipient || maskEmail(investor.email),
            subject: emailRes.subject || 'Refund Settlement Advice',
            messageSummary: emailRes.messageSummary || emailRes.error,
            status: emailRes.success ? 'Sent' : 'Failed',
            provider: 'SMTP / Nodemailer',
            messageId: emailRes.messageId || '',
            errorMessage: emailRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Refund email error:', err.message));

      sendRefundConfirmationSms({ investor, refund: newPayout })
        .then(async (smsRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'SMS',
            category: 'Refund',
            recipient: smsRes.recipient || maskMobile(investor.mobile),
            subject: 'SMS: Refund Processed',
            messageSummary: smsRes.messageSummary || smsRes.error,
            status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
            provider: smsRes.provider || 'SMS Gateway',
            messageId: smsRes.messageId || '',
            errorMessage: smsRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Refund SMS error:', err.message));
    } else {
      sendPayoutConfirmationEmail({ investor, payout: newPayout })
        .then(async (emailRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'Email',
            category: 'Payout',
            recipient: emailRes.recipient || maskEmail(investor.email),
            subject: emailRes.subject || 'Payout Disbursement Advice',
            messageSummary: emailRes.messageSummary || emailRes.error,
            status: emailRes.success ? 'Sent' : 'Failed',
            provider: 'SMTP / Nodemailer',
            messageId: emailRes.messageId || '',
            errorMessage: emailRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Payout email error:', err.message));

      sendPayoutConfirmationSms({ investor, payout: newPayout })
        .then(async (smsRes) => {
          await logCommunicationRecord(investor._id, {
            channel: 'SMS',
            category: 'Payout',
            recipient: smsRes.recipient || maskMobile(investor.mobile),
            subject: 'SMS: Payout Disbursed',
            messageSummary: smsRes.messageSummary || smsRes.error,
            status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
            provider: smsRes.provider || 'SMS Gateway',
            messageId: smsRes.messageId || '',
            errorMessage: smsRes.error || '',
            sentBy: req.user?.name || 'Super Admin',
          });
        })
        .catch((err) => console.warn('Payout SMS error:', err.message));
    }

    return res.status(201).json({
      success: true,
      message: `${category} of ₹${payoutAmount} recorded and debited from ledger.`,
      payout: newPayout,
      newBalance,
    });
  } catch (error) {
    console.error('recordPayoutOrRefund error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record payout: ' + error.message,
    });
  }
};

/**
 * 12. Manual Authorized Ledger Adjustment
 */
const addLedgerAdjustment = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, category = 'Authorized Adjustment', reference = '', remarks } = req.body;

    if (!type || !['Credit', 'Debit'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be Credit or Debit.' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Positive amount is required.' });
    }

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    const lastLedger = await InvestorLedgerEntry.findOne({ investor: investor._id })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const currentBalance = lastLedger ? Number(lastLedger.runningBalance || 0) : 0;

    const numAmount = Number(amount);
    const newBalance = type === 'Credit' ? currentBalance + numAmount : currentBalance - numAmount;

    if (newBalance < 0) {
      return res.status(400).json({
        success: false,
        message: 'Debit adjustment cannot reduce ledger balance below zero.',
      });
    }

    const ledgerCount = await InvestorLedgerEntry.countDocuments();
    const transactionId = `TXN-INV-${(ledgerCount + 5001).toString()}`;

    const ledgerEntry = new InvestorLedgerEntry({
      transactionId,
      investor: investor._id,
      investorId: investor.investorId,
      date: new Date(),
      description: `Authorized Adjustment: ${remarks || type}`,
      category: 'Authorized Adjustment',
      type,
      credit: type === 'Credit' ? numAmount : 0,
      debit: type === 'Debit' ? numAmount : 0,
      runningBalance: newBalance,
      reference,
      verificationStatus: 'Verified',
      remarks: remarks || `Manual adjustment by ${req.user?.name || 'Super Admin'}`,
      createdBy: req.user?.name || 'Super Admin',
      auditTrail: [
        {
          action: 'Authorized Adjustment',
          performedBy: req.user?.name || 'Super Admin',
          timestamp: new Date(),
          details: `Manual ${type} of ₹${numAmount}. New balance ₹${newBalance}. Reason: ${remarks}`,
        },
      ],
    });

    await ledgerEntry.save();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Ledger Adjusted',
      category: 'Ledger',
      performedBy: req.user?.name || 'Super Admin',
      details: `${type} adjustment of ₹${numAmount}. Reference: ${reference}. New balance: ₹${newBalance}.`,
    });

    return res.status(201).json({
      success: true,
      message: `Adjustment of ₹${numAmount} posted to ledger.`,
      ledgerEntry,
      newBalance,
    });
  } catch (error) {
    console.error('addLedgerAdjustment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to post ledger adjustment: ' + error.message,
    });
  }
};

/**
 * 13. Send Official Investment Confirmation Email
 * Strictly conditioned: Payment MUST be verified, Plan MUST be assigned.
 */
const sendConfirmationEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    if (investor.paymentStatus !== 'Verified') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send confirmation email: Investor payment is not verified yet.',
      });
    }

    if (!investor.assignedPlan || !investor.assignedPlan.planCode || investor.assignedPlan.status !== 'Active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send confirmation email: An approved active investment plan must be assigned first.',
      });
    }

    // Check duplicate sending in the last 10 minutes to prevent accidental spamming on refresh
    const recentEmail = investor.emailLogs.find(
      (log) =>
        log.emailType === 'InvestmentConfirmation' &&
        log.status === 'Sent' &&
        Date.now() - new Date(log.sentAt).getTime() < 10 * 60 * 1000
    );
    if (recentEmail) {
      return res.status(400).json({
        success: false,
        message: 'An investment confirmation email was already dispatched recently. Please wait before re-sending.',
      });
    }

    // Fetch verified payment details
    const verifiedPayment = await InvestorPayment.findOne({
      investor: investor._id,
      status: 'Verified',
    }).sort({ paymentDate: -1 });

    const emailResult = await sendInvestmentConfirmationEmail({
      investor,
      payment: verifiedPayment || {
        amount: investor.verifiedInvestment,
        utrNumber: 'VERIFIED-LEDGER',
      },
      plan: investor.assignedPlan,
    });

    if (!emailResult.success) {
      await logCommunicationRecord(investor._id, {
        channel: 'Email',
        category: 'PaymentConfirmation',
        recipient: maskEmail(investor.email),
        subject: `Investment Confirmation - ${investor.investorId}`,
        messageSummary: emailResult.error,
        status: 'Failed',
        provider: 'SMTP / Nodemailer',
        errorMessage: emailResult.error,
        sentBy: req.user?.name || 'Super Admin',
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to deliver confirmation email: ' + emailResult.error,
      });
    }

    await logCommunicationRecord(investor._id, {
      channel: 'Email',
      category: 'PaymentConfirmation',
      recipient: emailResult.recipient || maskEmail(investor.email),
      subject: emailResult.subject || `Investment Confirmation - ${investor.investorId}`,
      messageSummary: emailResult.messageSummary || 'Official investment confirmation & plan allotment email delivered.',
      status: 'Sent',
      provider: 'SMTP / Nodemailer',
      messageId: emailResult.messageId,
      sentBy: req.user?.name || 'Super Admin',
    });

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Confirmation Email Dispatched',
      category: 'Email',
      performedBy: req.user?.name || 'Super Admin',
      details: `Dispatched investment confirmation email to ${investor.email}.`,
    });

    return res.status(200).json({
      success: true,
      message: `Investment confirmation email delivered to ${investor.email}.`,
      messageId: emailResult.messageId,
    });
  } catch (error) {
    console.error('sendConfirmationEmail error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch confirmation email: ' + error.message,
    });
  }
};

/**
 * 13. Comprehensive Investor Notification Dispatcher (Email & SMS)
 * POST /api/investors/:id/send-notification
 */
const sendInvestorNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      type = 'InvestmentConfirmation',
      channels = ['Email'],
      customSubject = '',
      customMessage = '',
      force = false,
    } = req.body;

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    const requestedChannels = Array.isArray(channels) ? channels : [channels || 'Email'];
    const results = [];
    const errors = [];

    for (const rawCh of requestedChannels) {
      const channel = rawCh.toUpperCase() === 'SMS' ? 'SMS' : 'Email';

      // Duplicate prevention check (unless force is requested)
      if (!force && hasRecentCommunication(investor, channel, type, 5)) {
        errors.push(`${channel}: A "${type}" notification was already sent within the last 5 minutes.`);
        continue;
      }

      if (channel === 'Email') {
        let emailRes = { success: false, error: 'Unknown event type' };

        if (type === 'Registration' || type === 'RegistrationAcknowledgement') {
          emailRes = await sendInvestorRegistrationEmail(investor);
        } else if (type === 'KycStatus') {
          emailRes = await sendKycStatusEmail({
            investor,
            status: investor.kycStatus,
            reason: investor.kycRejectionReason,
            instructions: investor.correctionInstructions,
          });
        } else if (type === 'InvestmentConfirmation') {
          if (investor.paymentStatus !== 'Verified') {
            errors.push('Email: Cannot send Investment Confirmation until payment is verified.');
            continue;
          }
          if (!investor.assignedPlan || !investor.assignedPlan.planName) {
            errors.push('Email: Cannot send Investment Confirmation until an approved plan is assigned.');
            continue;
          }
          const payment = await InvestorPayment.findOne({ investor: investor._id, status: 'Verified' }).sort({ paymentDate: -1 });
          emailRes = await sendInvestmentConfirmationEmail({
            investor,
            payment: payment || { amount: investor.verifiedInvestment, utrNumber: 'VERIFIED-LEDGER' },
            plan: investor.assignedPlan,
          });
        } else if (type === 'PlanActivation') {
          emailRes = await sendPlanActivationEmail({
            investor,
            plan: investor.assignedPlan,
            tracking2x: investor.tracking2x,
          });
        } else if (type === 'Agreement') {
          emailRes = await sendAgreementEmail({
            investor,
            agreementUrl: investor.agreement?.agreementUrl,
            agreementNumber: investor.agreement?.agreementNumber,
          });
        } else if (type === 'MaturityReminder') {
          emailRes = await sendMaturityReminderEmail({
            investor,
            targetAmount: investor.tracking2x?.targetAmount || investor.assignedPlan?.contractualTarget,
            maturityDate: investor.tracking2x?.maturityDate || investor.assignedPlan?.maturityDate,
            plan: investor.assignedPlan,
          });
        } else if (type === 'Payout') {
          const lastPayout = await InvestorPayout.findOne({ investor: investor._id, category: 'Payout', status: 'Paid' }).sort({ payoutDate: -1 });
          if (!lastPayout) {
            errors.push('Email: No payout records found to send payout advice.');
            continue;
          }
          emailRes = await sendPayoutConfirmationEmail({ investor, payout: lastPayout });
        } else if (type === 'Refund') {
          const lastRefund = await InvestorPayout.findOne({ investor: investor._id, category: 'Refund', status: 'Paid' }).sort({ payoutDate: -1 });
          if (!lastRefund) {
            errors.push('Email: No refund records found to send refund advice.');
            continue;
          }
          emailRes = await sendRefundConfirmationEmail({ investor, refund: lastRefund });
        } else if (type === 'Custom') {
          if (!customMessage || !customMessage.trim()) {
            errors.push('Email: Custom message text is required.');
            continue;
          }
          emailRes = await sendCustomEmail({
            investor,
            subject: customSubject || `Notice from New Utkal Finance Ltd. [${investor.investorId}]`,
            messageBody: customMessage,
          });
        }

        await logCommunicationRecord(investor._id, {
          channel: 'Email',
          category: type === 'Custom' ? 'General' : type,
          recipient: emailRes.recipient || maskEmail(investor.email),
          subject: emailRes.subject || customSubject || type,
          messageSummary: emailRes.messageSummary || emailRes.error || type,
          status: emailRes.success ? 'Sent' : 'Failed',
          provider: 'SMTP / Nodemailer',
          messageId: emailRes.messageId || '',
          errorMessage: emailRes.error || '',
          sentBy: req.user?.name || 'Super Admin',
        });

        if (emailRes.success) {
          results.push({ channel: 'Email', status: 'Sent', messageId: emailRes.messageId });
        } else {
          errors.push(`Email: ${emailRes.error}`);
        }
      }

      if (channel === 'SMS') {
        let smsRes = { success: false, status: 'Failed', error: 'Unknown event type' };

        if (type === 'Registration' || type === 'RegistrationAcknowledgement') {
          smsRes = await sendInvestorRegistrationSms(investor);
        } else if (type === 'KycStatus') {
          smsRes = await sendKycStatusSms({
            investor,
            status: investor.kycStatus,
            reason: investor.kycRejectionReason || investor.correctionInstructions,
          });
        } else if (type === 'InvestmentConfirmation') {
          if (investor.paymentStatus !== 'Verified') {
            errors.push('SMS: Cannot send Investment Confirmation until payment is verified.');
            continue;
          }
          const payment = await InvestorPayment.findOne({ investor: investor._id, status: 'Verified' }).sort({ paymentDate: -1 });
          smsRes = await sendPaymentConfirmationSms({
            investor,
            payment: payment || { amount: investor.verifiedInvestment, utrNumber: 'VERIFIED' },
          });
        } else if (type === 'PlanActivation') {
          smsRes = await sendPlanActivationSms({
            investor,
            plan: investor.assignedPlan,
            tracking2x: investor.tracking2x,
          });
        } else if (type === 'Agreement') {
          smsRes = await sendAgreementSms({
            investor,
            agreementNumber: investor.agreement?.agreementNumber,
          });
        } else if (type === 'MaturityReminder') {
          smsRes = await sendMaturityReminderSms({
            investor,
            targetAmount: investor.tracking2x?.targetAmount || investor.assignedPlan?.contractualTarget,
            maturityDate: investor.tracking2x?.maturityDate || investor.assignedPlan?.maturityDate,
          });
        } else if (type === 'Payout') {
          const lastPayout = await InvestorPayout.findOne({ investor: investor._id, category: 'Payout', status: 'Paid' }).sort({ payoutDate: -1 });
          if (!lastPayout) {
            errors.push('SMS: No payout records found to send payout SMS.');
            continue;
          }
          smsRes = await sendPayoutConfirmationSms({ investor, payout: lastPayout });
        } else if (type === 'Refund') {
          const lastRefund = await InvestorPayout.findOne({ investor: investor._id, category: 'Refund', status: 'Paid' }).sort({ payoutDate: -1 });
          if (!lastRefund) {
            errors.push('SMS: No refund records found to send refund SMS.');
            continue;
          }
          smsRes = await sendRefundConfirmationSms({ investor, refund: lastRefund });
        } else if (type === 'Custom') {
          if (!customMessage || !customMessage.trim()) {
            errors.push('SMS: Custom message text is required.');
            continue;
          }
          smsRes = await sendCustomSms({ investor, messageText: customMessage });
        }

        await logCommunicationRecord(investor._id, {
          channel: 'SMS',
          category: type === 'Custom' ? 'General' : type,
          recipient: smsRes.recipient || maskMobile(investor.mobile),
          subject: `SMS: ${type}`,
          messageSummary: smsRes.messageSummary || smsRes.error || type,
          status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
          provider: smsRes.provider || (env.SMS.PROVIDER || 'SMS Gateway'),
          messageId: smsRes.messageId || '',
          errorMessage: smsRes.error || '',
          sentBy: req.user?.name || 'Super Admin',
        });

        if (smsRes.success) {
          results.push({ channel: 'SMS', status: 'Sent', messageId: smsRes.messageId });
        } else if (smsRes.status === 'Not Configured') {
          results.push({ channel: 'SMS', status: 'Not Configured', info: smsRes.error });
        } else {
          errors.push(`SMS: ${smsRes.error}`);
        }
      }
    }

    const updatedInvestor = await Investor.findById(id).lean();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Investor Communication Dispatched',
      category: 'Communication',
      performedBy: req.user?.name || 'Super Admin',
      details: `Dispatched ${type} via ${requestedChannels.join(', ')}. Dispatched: ${results.length}, Warnings/Errors: ${errors.length}.`,
    });

    return res.status(200).json({
      success: results.length > 0 || errors.length === 0,
      message: results.length > 0
        ? `Notification dispatched successfully.`
        : `Notification delivery encountered issues: ${errors.join('; ')}`,
      results,
      errors,
      communicationLogs: updatedInvestor.communicationLogs || [],
    });
  } catch (error) {
    console.error('sendInvestorNotification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch notification: ' + error.message,
    });
  }
};

/**
 * 13B. Get All Investment Records for an Investor
 * GET /api/investors/:id/investments
 */
const getInvestorInvestments = async (req, res) => {
  try {
    const { id } = req.params;
    let investor = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      investor = await Investor.findById(id);
    }
    if (!investor) {
      investor = await Investor.findOne({ investorId: id.toUpperCase() });
    }
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    await ensureInitialInvestmentRecord(investor);

    const investments = await InvestmentRecord.find({ investor: investor._id })
      .sort({ investmentId: 1 })
      .lean();

    const payouts = await InvestorPayout.find({ investor: investor._id, status: 'Paid' }).lean();
    const totalPayouts = payouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const summary = {
      totalInvestmentCount: investments.length,
      totalInvestmentAmount: investments.reduce((sum, inv) => sum + Number(inv.amount || 0), 0),
      totalVerifiedPayments: investments
        .filter((inv) => inv.paymentStatus === 'Verified')
        .reduce((sum, inv) => sum + Number(inv.amount || 0), 0),
      totalPayouts,
      totalOutstandingLiability: investments.reduce(
        (sum, inv) => sum + Number(inv.tracking2x?.remainingPayout || 0),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      investorId: investor.investorId,
      investorName: investor.fullName,
      summary,
      investments,
    });
  } catch (error) {
    console.error('getInvestorInvestments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch investment records: ' + error.message,
    });
  }
};

/**
 * 13C. Create Additional / Repeat Investment for an Existing Investor
 * POST /api/investors/:id/investments
 */
const createAdditionalInvestment = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      investmentDate,
      paymentMode = 'UPI',
      utrNumber,
      paymentStatus = 'Pending',
      planId,
      planCode,
      planName,
      multiplier = 2,
      contractualPercentage = 100,
      percentageBasis = 'Total Contractual Percentage',
      durationMonths = 24,
      assignedDate,
      maturityDate: customMaturityDate,
      adminRemarks = '',
      agreementStatus = 'Draft',
    } = req.body;

    let investor = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      investor = await Investor.findById(id);
    }
    if (!investor) {
      investor = await Investor.findOne({ investorId: id.toUpperCase() });
    }
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid investment amount is required.' });
    }

    if (!utrNumber || !utrNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Transaction ID / UTR is required.' });
    }

    const cleanUtr = utrNumber.trim();

    // Prevent duplicate UTR across payments and investment records
    const existingPayment = await InvestorPayment.findOne({ utrNumber: cleanUtr });
    const existingInvestment = await InvestmentRecord.findOne({ utrNumber: cleanUtr });
    if (existingPayment || existingInvestment) {
      return res.status(400).json({
        success: false,
        message: `A transaction with UTR "${cleanUtr}" already exists in the system. Duplicate reference entries are prohibited.`,
      });
    }

    // Ensure initial investment record exists first
    await ensureInitialInvestmentRecord(investor);

    // Generate unique sequential Investment Reference ID
    const investmentId = await generateNextInvestmentId(investor.investorId);

    // File attachments
    let receiptUrl = '';
    let agreementUrl = '';
    if (req.files) {
      if (req.files.receipt && req.files.receipt[0]) {
        receiptUrl = `/uploads/documents/${req.files.receipt[0].filename}`;
      }
      if (req.files.agreementFile && req.files.agreementFile[0]) {
        agreementUrl = `/uploads/documents/${req.files.agreementFile[0].filename}`;
      }
    }

    const numAmount = Number(amount);
    const numMultiplier = Number(multiplier) || 2;
    const numDuration = Number(durationMonths) || 24;
    const startDate = assignedDate ? new Date(assignedDate) : (investmentDate ? new Date(investmentDate) : new Date());
    const finalMaturityDate = customMaturityDate
      ? new Date(customMaturityDate)
      : new Date(startDate.getTime() + numDuration * 30 * 24 * 3600 * 1000);
    const targetAmount = Math.round(numAmount * numMultiplier);

    const isVerified = paymentStatus === 'Verified';

    // 1. Record Central Payment Entry
    const paymentCount = await InvestorPayment.countDocuments();
    const paymentId = `PAY-INV-${(paymentCount + 1001).toString()}`;

    const newPayment = new InvestorPayment({
      paymentId,
      investor: investor._id,
      investorId: investor.investorId,
      investorName: investor.fullName,
      amount: numAmount,
      paymentDate: investmentDate ? new Date(investmentDate) : new Date(),
      paymentMethod: paymentMode,
      utrNumber: cleanUtr,
      receiptUrl,
      status: isVerified ? 'Verified' : 'Pending',
      verifiedBy: isVerified ? (req.user?.name || 'Super Admin') : '',
      verifiedAt: isVerified ? new Date() : null,
      adminRemarks: adminRemarks || `Additional Investment ${investmentId}`,
    });

    let ledgerEntryId = null;

    // 2. If verified, credit the double-entry financial ledger
    if (isVerified) {
      const lastLedger = await InvestorLedgerEntry.findOne({ investor: investor._id })
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const prevBalance = lastLedger ? Number(lastLedger.runningBalance || 0) : 0;
      const newBalance = prevBalance + numAmount;

      const ledgerCount = await InvestorLedgerEntry.countDocuments();
      const transactionId = `TXN-INV-${(ledgerCount + 5001).toString()}`;

      const ledgerEntry = new InvestorLedgerEntry({
        transactionId,
        investor: investor._id,
        investorId: investor.investorId,
        date: newPayment.paymentDate,
        description: `Verified Additional Investment [${investmentId}] via ${paymentMode} (UTR: ${cleanUtr})`,
        category: 'Additional Verified Receipt',
        type: 'Credit',
        credit: numAmount,
        debit: 0,
        runningBalance: newBalance,
        reference: cleanUtr,
        verificationStatus: 'Verified',
        remarks: adminRemarks || `Repeat investment ${investmentId} verified by ${req.user?.name || 'Super Admin'}`,
        createdBy: req.user?.name || 'Super Admin',
        auditTrail: [
          {
            action: 'Credit Verified',
            performedBy: req.user?.name || 'Super Admin',
            timestamp: new Date(),
            details: `Credit of ₹${numAmount} verified under Investment ID ${investmentId} (UTR: ${cleanUtr}). New balance ₹${newBalance}.`,
          },
        ],
      });

      await ledgerEntry.save();
      ledgerEntryId = ledgerEntry._id;
      newPayment.ledgerEntryId = ledgerEntry._id;
    }

    await newPayment.save();

    // 3. Create Investment Record with its own dedicated 2X tracking
    const newInvestment = new InvestmentRecord({
      investmentId,
      investor: investor._id,
      investorId: investor.investorId,
      investorName: investor.fullName,
      amount: numAmount,
      investmentDate: newPayment.paymentDate,
      paymentMode,
      utrNumber: cleanUtr,
      receiptUrl,
      paymentStatus: isVerified ? 'Verified' : 'Pending',
      verifiedBy: isVerified ? (req.user?.name || 'Super Admin') : '',
      verifiedAt: isVerified ? new Date() : null,
      adminRemarks,
      planId: (planId && mongoose.Types.ObjectId.isValid(planId))
        ? planId
        : (investor.assignedPlan?.planId && mongoose.Types.ObjectId.isValid(investor.assignedPlan?.planId)
            ? investor.assignedPlan.planId
            : undefined),
      planCode: planCode || investor.assignedPlan?.planCode || 'UF-REPEAT-PLAN',
      planName: planName || investor.assignedPlan?.planName || 'Repeat Investment Plan',
      multiplier: numMultiplier,
      contractualPercentage: Number(contractualPercentage) ?? 100,
      percentageBasis,
      durationMonths: numDuration,
      assignedDate: startDate,
      maturityDate: finalMaturityDate,
      planStatus: isVerified ? 'Active' : 'Pending',
      agreementNumber: `UF-AGR-${investmentId}`,
      agreementUrl,
      agreementStatus: agreementUrl ? 'Executed' : agreementStatus,
      agreementUploadedAt: agreementUrl ? new Date() : null,
      tracking2x: {
        originalInvestment: numAmount,
        multiplier: numMultiplier,
        contractualPercentage: Number(contractualPercentage) ?? 100,
        percentageBasis,
        targetAmount,
        durationMonths: numDuration,
        startDate,
        maturityDate: finalMaturityDate,
        totalEligiblePayouts: 0,
        remainingPayout: targetAmount,
        status: isVerified ? 'Active' : 'Pending',
        activatedAt: isVerified ? new Date() : null,
        activatedBy: isVerified ? (req.user?.name || 'Super Admin') : '',
      },
      ledgerEntryId,
      paymentRecordId: newPayment._id,
      createdBy: req.user?.name || 'Super Admin',
    });

    await newInvestment.save();

    // 4. Update overall investor summary totals
    const allInvestments = await InvestmentRecord.find({ investor: investor._id });
    const totalAmountSum = allInvestments.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const verifiedAmountSum = allInvestments
      .filter((inv) => inv.paymentStatus === 'Verified')
      .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);

    investor.totalInvestment = totalAmountSum;
    investor.verifiedInvestment = verifiedAmountSum;
    if (verifiedAmountSum > 0) {
      investor.paymentStatus = 'Verified';
    }
    await investor.save();

    // Audit log
    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Additional Investment Created',
      category: 'Investment',
      performedBy: req.user?.name || 'Super Admin',
      details: `Created repeat investment ${investmentId} of ₹${numAmount} under plan ${newInvestment.planName} (Status: ${newInvestment.paymentStatus}).`,
    });

    return res.status(201).json({
      success: true,
      message: `Additional investment ${investmentId} recorded successfully.`,
      investment: newInvestment,
    });
  } catch (error) {
    console.error('createAdditionalInvestment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record additional investment: ' + error.message,
    });
  }
};

/**
 * 13D. Verify Payment for a Specific Investment Record
 * PATCH /api/investors/:id/investments/:investmentRecordId/verify
 */
const verifyInvestmentPayment = async (req, res) => {
  try {
    const { id, investmentRecordId } = req.params;
    const { adminRemarks = '' } = req.body;

    let investor = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      investor = await Investor.findById(id);
    }
    if (!investor) {
      investor = await Investor.findOne({ investorId: id.toUpperCase() });
    }
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    let investment = null;
    if (mongoose.Types.ObjectId.isValid(investmentRecordId)) {
      investment = await InvestmentRecord.findById(investmentRecordId);
    }
    if (!investment) {
      investment = await InvestmentRecord.findOne({ investmentId: investmentRecordId.toUpperCase() });
    }
    if (!investment) {
      return res.status(404).json({ success: false, message: 'Investment record not found.' });
    }

    if (investment.paymentStatus === 'Verified') {
      return res.status(400).json({ success: false, message: 'This investment is already verified.' });
    }

    investment.paymentStatus = 'Verified';
    investment.verifiedBy = req.user?.name || 'Super Admin';
    investment.verifiedAt = new Date();
    investment.planStatus = 'Active';
    if (adminRemarks) investment.adminRemarks = adminRemarks;

    // Activate 2X tracking for this specific investment
    if (investment.tracking2x) {
      investment.tracking2x.status = 'Active';
      investment.tracking2x.activatedAt = new Date();
      investment.tracking2x.activatedBy = req.user?.name || 'Super Admin';
    }

    // Post to double-entry ledger
    const lastLedger = await InvestorLedgerEntry.findOne({ investor: investor._id })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const prevBalance = lastLedger ? Number(lastLedger.runningBalance || 0) : 0;
    const newBalance = prevBalance + investment.amount;

    const ledgerCount = await InvestorLedgerEntry.countDocuments();
    const transactionId = `TXN-INV-${(ledgerCount + 5001).toString()}`;

    const ledgerEntry = new InvestorLedgerEntry({
      transactionId,
      investor: investor._id,
      investorId: investor.investorId,
      date: investment.investmentDate || new Date(),
      description: `Verified Investment Receipt [${investment.investmentId}] via ${investment.paymentMode} (UTR: ${investment.utrNumber})`,
      category: 'Additional Verified Receipt',
      type: 'Credit',
      credit: investment.amount,
      debit: 0,
      runningBalance: newBalance,
      reference: investment.utrNumber,
      verificationStatus: 'Verified',
      remarks: adminRemarks || `Verified by ${req.user?.name || 'Super Admin'}`,
      createdBy: req.user?.name || 'Super Admin',
      auditTrail: [
        {
          action: 'Credit Verified',
          performedBy: req.user?.name || 'Super Admin',
          timestamp: new Date(),
          details: `Verified ₹${investment.amount} under ${investment.investmentId}. New ledger balance ₹${newBalance}.`,
        },
      ],
    });

    await ledgerEntry.save();
    investment.ledgerEntryId = ledgerEntry._id;

    // Update linked InvestorPayment if exists
    if (investment.paymentRecordId) {
      await InvestorPayment.findByIdAndUpdate(investment.paymentRecordId, {
        status: 'Verified',
        verifiedBy: req.user?.name || 'Super Admin',
        verifiedAt: new Date(),
        ledgerEntryId: ledgerEntry._id,
      });
    }

    await investment.save();

    // Recalculate investor verified sum
    const allInvestments = await InvestmentRecord.find({ investor: investor._id });
    const verifiedSum = allInvestments
      .filter((inv) => inv.paymentStatus === 'Verified')
      .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);

    investor.verifiedInvestment = verifiedSum;
    investor.paymentStatus = 'Verified';
    await investor.save();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Investment Payment Verified',
      category: 'Investment',
      performedBy: req.user?.name || 'Super Admin',
      details: `Payment of ₹${investment.amount} verified for ${investment.investmentId}. 2X tracking activated.`,
    });

    return res.status(200).json({
      success: true,
      message: `Investment ${investment.investmentId} marked as Verified.`,
      investment,
    });
  } catch (error) {
    console.error('verifyInvestmentPayment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify investment: ' + error.message,
    });
  }
};

/**
 * 14. Upload / Update Agreement
 */
const uploadAgreement = async (req, res) => {
  try {
    const { id } = req.params;
    const { agreementNumber, notes } = req.body;

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    let agreementUrl = investor.agreement?.agreementUrl || '';
    if (req.file) {
      agreementUrl = `/uploads/documents/${req.file.filename}`;
    }

    investor.agreement = {
      agreementNumber: agreementNumber || investor.agreement?.agreementNumber || `UF-AGR-${investor.investorId}`,
      status: 'Executed',
      agreementUrl,
      generatedAt: investor.agreement?.generatedAt || new Date(),
      executedAt: new Date(),
      notes: notes || 'Official statutory investment agreement executed and archived.',
    };

    await investor.save();

    // Trigger Agreement Delivery Notification (Email & SMS) in background
    sendAgreementEmail({
      investor,
      agreementUrl: investor.agreement?.agreementUrl,
      agreementNumber: investor.agreement?.agreementNumber,
    })
      .then(async (emailRes) => {
        await logCommunicationRecord(investor._id, {
          channel: 'Email',
          category: 'Agreement',
          recipient: emailRes.recipient || maskEmail(investor.email),
          subject: emailRes.subject || 'Signed Investment Agreement Executed',
          messageSummary: emailRes.messageSummary || emailRes.error,
          status: emailRes.success ? 'Sent' : 'Failed',
          provider: 'SMTP / Nodemailer',
          messageId: emailRes.messageId || '',
          errorMessage: emailRes.error || '',
          sentBy: req.user?.name || 'Super Admin',
        });
      })
      .catch((err) => console.warn('Agreement email error:', err.message));

    sendAgreementSms({
      investor,
      agreementNumber: investor.agreement?.agreementNumber,
    })
      .then(async (smsRes) => {
        await logCommunicationRecord(investor._id, {
          channel: 'SMS',
          category: 'Agreement',
          recipient: smsRes.recipient || maskMobile(investor.mobile),
          subject: 'SMS: Agreement Executed',
          messageSummary: smsRes.messageSummary || smsRes.error,
          status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
          provider: smsRes.provider || 'SMS Gateway',
          messageId: smsRes.messageId || '',
          errorMessage: smsRes.error || '',
          sentBy: req.user?.name || 'Super Admin',
        });
      })
      .catch((err) => console.warn('Agreement SMS error:', err.message));

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Agreement Executed & Attached',
      category: 'Agreement',
      performedBy: req.user?.name || 'Super Admin',
      details: `Executed agreement ${investor.agreement.agreementNumber} attached for ${investor.fullName}.`,
    });

    return res.status(200).json({
      success: true,
      message: 'Agreement updated successfully.',
      agreement: investor.agreement,
    });
  } catch (error) {
    console.error('uploadAgreement error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload agreement: ' + error.message,
    });
  }
};

/**
 * 15. Request KYC Correction from Investor
 */
const requestKycCorrection = async (req, res) => {
  try {
    const { id } = req.params;
    const { instructions, reason } = req.body;

    const investor = await Investor.findById(id);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    const correctionText = instructions || reason || 'Please resubmit legible KYC documents.';
    investor.kycStatus = 'Correction Required';
    investor.correctionInstructions = correctionText;
    investor.correctionRequestedAt = new Date();
    investor.correctionRequestedBy = req.user?.fullName || 'Super Admin';
    await investor.save();

    // Trigger KYC Correction Notification (Email & SMS) in background
    sendKycStatusEmail({
      investor,
      status: 'Correction Required',
      reason: correctionText,
      instructions: correctionText,
    })
      .then(async (emailRes) => {
        await logCommunicationRecord(investor._id, {
          channel: 'Email',
          category: 'KycStatus',
          recipient: emailRes.recipient || maskEmail(investor.email),
          subject: emailRes.subject || 'KYC Correction Required',
          messageSummary: emailRes.messageSummary || emailRes.error,
          status: emailRes.success ? 'Sent' : 'Failed',
          provider: 'SMTP / Nodemailer',
          messageId: emailRes.messageId || '',
          errorMessage: emailRes.error || '',
          sentBy: req.user?.fullName || 'Super Admin',
        });
      })
      .catch((err) => console.warn('KYC correction email error:', err.message));

    sendKycStatusSms({
      investor,
      status: 'Correction Required',
      reason: correctionText,
    })
      .then(async (smsRes) => {
        await logCommunicationRecord(investor._id, {
          channel: 'SMS',
          category: 'KycStatus',
          recipient: smsRes.recipient || maskMobile(investor.mobile),
          subject: 'SMS: KYC Correction Required',
          messageSummary: smsRes.messageSummary || smsRes.error,
          status: smsRes.status || (smsRes.success ? 'Sent' : 'Failed'),
          provider: smsRes.provider || 'SMS Gateway',
          messageId: smsRes.messageId || '',
          errorMessage: smsRes.error || '',
          sentBy: req.user?.fullName || 'Super Admin',
        });
      })
      .catch((err) => console.warn('KYC correction SMS error:', err.message));

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'KYC Correction Requested',
      category: 'KYC',
      performedBy: req.user?.fullName || 'Super Admin',
      details: `Correction requested: ${correctionText}`,
    });

    return res.status(200).json({
      success: true,
      message: 'Correction request recorded successfully.',
      investor,
    });
  } catch (error) {
    console.error('requestKycCorrection error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to request correction: ' + error.message,
    });
  }
};

/**
 * 16. Reverse Confirmed Ledger Entry (Double-Entry Reversal)
 */
const reverseLedgerEntry = async (req, res) => {
  try {
    const { entryId } = req.params;
    const { reason = 'Administrative accounting correction' } = req.body;

    const entry = await InvestorLedgerEntry.findById(entryId);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Ledger entry not found.' });
    }
    if (entry.isReversed) {
      return res.status(400).json({ success: false, message: 'This entry has already been reversed.' });
    }

    const investor = await Investor.findById(entry.investor);
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor not found.' });
    }

    // Get current last ledger entry for this investor to compute new running balance
    const lastEntry = await InvestorLedgerEntry.findOne({ investor: investor._id })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const prevBalance = lastEntry ? lastEntry.runningBalance : 0;

    // Opposite entry
    let newDebit = 0;
    let newCredit = 0;
    let newRunningBalance = prevBalance;
    let newType = 'Debit';

    if (entry.type === 'Credit' || entry.credit > 0) {
      // Reversal of a credit is a debit
      newDebit = entry.credit;
      newRunningBalance = prevBalance - newDebit;
      newType = 'Debit';
    } else {
      // Reversal of a debit is a credit
      newCredit = entry.debit;
      newRunningBalance = prevBalance + newCredit;
      newType = 'Credit';
    }

    const reversalTxId = `REV-${Date.now().toString().slice(-6)}`;
    const reversalEntry = new InvestorLedgerEntry({
      transactionId: reversalTxId,
      investor: investor._id,
      investorId: investor.investorId,
      date: new Date(),
      description: `Reversal of ${entry.transactionId}: ${reason}`,
      category: 'Reversal',
      type: newType,
      credit: newCredit,
      debit: newDebit,
      runningBalance: newRunningBalance,
      reference: entry.transactionId,
      reversalReferenceId: entry.transactionId,
      reversalReason: reason,
      verificationStatus: 'Verified',
      remarks: `Reversal of entry ${entry.transactionId}`,
      createdBy: req.user?.fullName || 'Super Admin',
      auditTrail: [
        {
          action: 'Reversal Entry Posted',
          performedBy: req.user?.fullName || 'Super Admin',
          details: `Reversed original transaction ${entry.transactionId} due to: ${reason}`,
        },
      ],
    });
    await reversalEntry.save();

    // Mark original entry as reversed
    entry.isReversed = true;
    entry.reversalEntryId = reversalTxId;
    entry.reversalReason = reason;
    entry.auditTrail.push({
      action: 'Transaction Reversed',
      performedBy: req.user?.fullName || 'Super Admin',
      timestamp: new Date(),
      details: `Reversed by entry ${reversalTxId}: ${reason}`,
    });
    await entry.save();

    await InvestorAuditLog.create({
      investor: investor._id,
      investorId: investor.investorId,
      action: 'Ledger Entry Reversed',
      category: 'Ledger',
      performedBy: req.user?.fullName || 'Super Admin',
      details: `Reversed entry ${entry.transactionId} with reversal entry ${reversalTxId}.`,
    });

    return res.status(200).json({
      success: true,
      message: 'Ledger entry successfully reversed.',
      reversalEntry,
    });
  } catch (error) {
    console.error('reverseLedgerEntry error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reverse ledger entry: ' + error.message,
    });
  }
};

/**
 * 17. Get All Global / Filtered Ledger Entries
 */
const getAllLedgerEntries = async (req, res) => {
  try {
    const {
      investorId,
      category,
      type,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};
    if (investorId && investorId !== 'All') {
      query.investorId = investorId;
    }
    if (category && category !== 'All') {
      query.category = category;
    }
    if (type && type !== 'All') {
      query.type = type;
    }
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }
    if (search) {
      query.$or = [
        { transactionId: { $regex: search.trim(), $options: 'i' } },
        { investorId: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
        { reference: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const total = await InvestorLedgerEntry.countDocuments(query);
    const entries = await InvestorLedgerEntry.find(query)
      .populate('investor', 'fullName investorId district')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Aggregates for double-entry summary
    const summaryAgg = await InvestorLedgerEntry.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCredits: { $sum: '$credit' },
          totalDebits: { $sum: '$debit' },
        },
      },
    ]);

    const totalCredits = summaryAgg[0]?.totalCredits || 0;
    const totalDebits = summaryAgg[0]?.totalDebits || 0;
    const netBalance = totalCredits - totalDebits;

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalCredits,
      totalDebits,
      netBalance,
      entries,
    });
  } catch (error) {
    console.error('getAllLedgerEntries error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve ledger entries: ' + error.message,
    });
  }
};

/**
 * 18. Fund Allocation and Loan Reconciliation
 */
const getFundAllocationAndReconciliation = async (req, res) => {
  try {
    // 1. Investor Contributions (verified payments)
    const verifiedPaymentsAgg = await InvestorPayment.aggregate([
      { $match: { status: 'Verified' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const totalInvestorContributions = verifiedPaymentsAgg[0]?.total || 0;
    const verifiedPaymentsCount = verifiedPaymentsAgg[0]?.count || 0;

    // 2. Investor Payouts Paid
    const payoutsAgg = await InvestorPayout.aggregate([
      { $match: { status: 'Paid' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const totalInvestorPayouts = payoutsAgg[0]?.total || 0;

    // Net Available Investor Capital Pool
    const availableFunds = Math.max(0, totalInvestorContributions - totalInvestorPayouts);

    // 3. Funds Allocated to Loans (from LoanApplication collection)
    const disbursedLoans = await LoanApplication.find({
      $or: [
        { 'disbursement.isDisbursed': true },
        { status: { $in: ['Disbursed', 'Active', 'Closed'] } },
      ],
    })
      .select('applicationId loanId applicantName sanctionedAmount requestedAmount disbursement repayment status createdAt')
      .sort({ 'disbursement.disbursedAt': -1, createdAt: -1 })
      .lean();

    let totalLoanDisbursements = 0;
    let totalEmiCollections = 0;

    disbursedLoans.forEach((loan) => {
      const amt = Number(loan.disbursement?.disbursedAmount || loan.sanctionedAmount || loan.requestedAmount || 0);
      totalLoanDisbursements += amt;
      const paid = Number(loan.repayment?.totalPaidAmount || 0);
      totalEmiCollections += paid;
    });

    const fundsAllocatedToLoans = totalLoanDisbursements;
    const unreconciledAmount = availableFunds - fundsAllocatedToLoans + totalEmiCollections;
    const isReconciled = Math.abs(unreconciledAmount) < 1;

    return res.status(200).json({
      success: true,
      reconciliation: {
        investorContributions: totalInvestorContributions,
        verifiedPaymentsCount,
        totalInvestorPayouts,
        availableFunds,
        fundsAllocatedToLoans,
        totalLoanDisbursements,
        totalEmiCollections,
        unreconciledAmount,
        bankReconciliationStatus: isReconciled ? 'Balanced & Reconciled' : 'Variance / Operational Float',
        disbursedLoansCount: disbursedLoans.length,
        recentLoans: disbursedLoans.slice(0, 15).map((l) => ({
          applicationId: l.applicationId,
          loanId: l.loanId || l.applicationId,
          applicantName: l.applicantName,
          amount: l.disbursement?.disbursedAmount || l.sanctionedAmount || l.requestedAmount || 0,
          disbursedAt: l.disbursement?.disbursedAt || l.createdAt,
          repaidAmount: l.repayment?.totalPaidAmount || 0,
          status: l.status,
        })),
      },
    });
  } catch (error) {
    console.error('getFundAllocationAndReconciliation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve fund allocation data: ' + error.message,
    });
  }
};

/**
 * 19. Generate Financial Reports
 */
const getFinancialReports = async (req, res) => {
  try {
    const { type = 'investor-ledger', startDate, endDate, investorId } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      dateFilter.$lte = e;
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    let reportData = [];

    switch (type) {
      case 'investor-ledger': {
        const query = {};
        if (investorId && investorId !== 'All') query.investorId = investorId;
        if (hasDateFilter) query.date = dateFilter;
        reportData = await InvestorLedgerEntry.find(query)
          .sort({ date: -1 })
          .populate('investor', 'fullName email mobile district')
          .lean();
        break;
      }
      case 'total-investment':
      case 'investment-collection': {
        const query = { status: 'Verified' };
        if (investorId && investorId !== 'All') query.investorId = investorId;
        if (hasDateFilter) query.paymentDate = dateFilter;
        reportData = await InvestorPayment.find(query)
          .sort({ paymentDate: -1 })
          .populate('investor', 'fullName email mobile district')
          .lean();
        break;
      }
      case 'investor-payout':
      case 'payouts': {
        const query = {};
        if (investorId && investorId !== 'All') query.investorId = investorId;
        if (hasDateFilter) query.payoutDate = dateFilter;
        reportData = await InvestorPayout.find(query)
          .sort({ payoutDate: -1 })
          .populate('investor', 'fullName email mobile district')
          .lean();
        break;
      }
      case 'outstanding-balance':
      case 'outstanding-liability': {
        const investors = await Investor.find({ status: 'Active' }).lean();
        const investorIds = investors.map((i) => i._id);
        const payoutsAgg = await InvestorPayout.aggregate([
          { $match: { investor: { $in: investorIds }, status: 'Paid' } },
          { $group: { _id: '$investor', total: { $sum: '$amount' } } },
        ]);
        const pMap = {};
        payoutsAgg.forEach((p) => {
          pMap[p._id.toString()] = p.total;
        });

        reportData = investors.map((inv) => {
          const paid = pMap[inv._id.toString()] || 0;
          const liability = inv.assignedPlan?.contractualLiability || inv.verifiedInvestment || 0;
          return {
            investorId: inv.investorId,
            fullName: inv.fullName,
            district: inv.district,
            planName: inv.assignedPlan?.planName || 'None',
            contractualLiability: liability,
            totalPaid: paid,
            remainingBalance: Math.max(0, liability - paid),
            remainingLiability: Math.max(0, liability - paid),
            maturityDate: inv.assignedPlan?.maturityDate || null,
          };
        });
        break;
      }
      case 'maturity-tracking': {
        const query = { status: 'Active' };
        if (investorId && investorId !== 'All') query.investorId = investorId;
        const investors = await Investor.find(query).sort({ maturityDate: 1, createdAt: -1 }).lean();
        reportData = investors.map((inv) => {
          const matDate = inv.maturityDate || inv.assignedPlan?.maturityDate;
          const isMatured = matDate ? new Date(matDate) <= new Date() : false;
          return {
            investorId: inv.investorId,
            fullName: inv.fullName,
            district: inv.district,
            planName: inv.assignedPlan?.planName || inv.investmentType || 'Standard Term Plan',
            investmentAmount: inv.verifiedInvestment || inv.totalInvestment || 0,
            investmentDate: inv.investmentDate ? new Date(inv.investmentDate).toLocaleDateString('en-IN') : 'N/A',
            maturityDate: matDate ? new Date(matDate).toLocaleDateString('en-IN') : 'Subject to Agreement',
            status: isMatured ? 'Matured / Due' : 'Under Active Tenure',
            contractualLiability: inv.assignedPlan?.contractualLiability || inv.verifiedInvestment || 0,
          };
        });
        break;
      }
      case 'kyc-verification': {
        const query = {};
        if (investorId && investorId !== 'All') query.investorId = investorId;
        if (hasDateFilter) query.createdAt = dateFilter;
        const investors = await Investor.find(query).sort({ createdAt: -1 }).lean();
        reportData = investors.map((inv) => ({
          investorId: inv.investorId,
          fullName: inv.fullName,
          mobile: inv.mobile,
          email: inv.email,
          district: inv.district,
          investmentAmount: inv.verifiedInvestment || inv.totalInvestment || 0,
          kycStatus: inv.kycStatus || 'Pending',
          panNumber: inv.panNumber ? `•••••${inv.panNumber.slice(-4)}` : 'N/A',
          aadhaarNumber: inv.aadhaarNumber ? `•••• •••• ${inv.aadhaarNumber.slice(-4)}` : 'N/A',
          kycVerifiedAt: inv.kycVerifiedAt ? new Date(inv.kycVerifiedAt).toLocaleDateString('en-IN') : null,
          kycVerifiedBy: inv.kycVerifiedBy || 'Pending',
          remarks: inv.kycRejectionReason || inv.correctionInstructions || inv.adminRemarks || 'N/A',
          registeredDate: inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-IN') : 'N/A',
        }));
        break;
      }
      case 'fund-allocation': {
        const loans = await LoanApplication.find({
          $or: [
            { 'disbursement.isDisbursed': true },
            { status: { $in: ['Disbursed', 'Active', 'Closed'] } },
          ],
        }).lean();
        reportData = loans.map((l) => ({
          applicationId: l.applicationId,
          loanId: l.loanId || l.applicationId,
          applicantName: l.applicantName,
          amount: l.disbursement?.disbursedAmount || l.sanctionedAmount || 0,
          disbursedAt: l.disbursement?.disbursedAt || l.createdAt,
          repaidAmount: l.repayment?.totalPaidAmount || 0,
          status: l.status,
        }));
        break;
      }
      case 'transaction-history': {
        const query = {};
        if (hasDateFilter) query.date = dateFilter;
        reportData = await InvestorLedgerEntry.find(query).sort({ date: -1 }).limit(200).lean();
        break;
      }
      case 'date-wise': {
        const query = {};
        if (hasDateFilter) query.date = dateFilter;
        reportData = await InvestorLedgerEntry.find(query).sort({ date: -1 }).lean();
        break;
      }
      default:
        reportData = [];
    }

    return res.status(200).json({
      success: true,
      reportType: type,
      totalRecords: reportData.length,
      data: reportData,
    });
  } catch (error) {
    console.error('getFinancialReports error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate financial report: ' + error.message,
    });
  }
};

/**
 * Associate Member Approves Investor -> Advances to Admin Approval
 */
const associateApproveInvestor = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks = '' } = req.body;

    const investor = await Investor.findOne({
      $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { investorId: id }],
    });
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor record not found.' });
    }

    investor.approvalStage = 'approved_by_associate';
    investor.associateApproval = {
      status: 'Approved',
      approvedAt: new Date(),
      approvedBy: req.user?.name || 'Associate Member',
      remarks: (remarks || '').trim(),
    };

    await investor.save();

    return res.status(200).json({
      success: true,
      message: 'Investor approved successfully and submitted to Super Admin for final approval.',
      investor,
    });
  } catch (error) {
    console.error('associateApproveInvestor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve investor: ' + error.message,
    });
  }
};

/**
 * Super Admin Final Approval
 */
const finalApproveInvestor = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks = '' } = req.body;

    const investor = await Investor.findOne({
      $or: [{ _id: mongoose.Types.ObjectId.isValid(id) ? id : null }, { investorId: id }],
    });
    if (!investor) {
      return res.status(404).json({ success: false, message: 'Investor record not found.' });
    }

    investor.approvalStage = 'approved_by_admin';
    investor.status = 'Active';
    investor.adminApproval = {
      status: 'Approved',
      approvedAt: new Date(),
      approvedBy: req.user?.name || 'Super Admin',
      remarks: (remarks || '').trim(),
    };

    await investor.save();

    return res.status(200).json({
      success: true,
      message: 'Investor granted final approval successfully and activated.',
      investor,
    });
  } catch (error) {
    console.error('finalApproveInvestor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to grant final approval: ' + error.message,
    });
  }
};

/**
 * Get active Associate Members for referral & assignment dropdown (Admin Only)
 */
const getAssociatesList = async (req, res) => {
  try {
    const users = await User.find({ role: 'associate' })
      .select('_id name email mobile memberId assignedDistrict status approvalStatus')
      .sort({ name: 1 })
      .lean();

    const memberIds = users.map((u) => u.memberId).filter(Boolean);
    let memberMap = {};
    if (memberIds.length > 0) {
      const members = await Member.find({ memberId: { $in: memberIds } })
        .select('memberId mobile contactDetails addressDetails personalDetails')
        .lean();
      members.forEach((m) => {
        memberMap[m.memberId] = m;
      });
    }

    const associates = users.map((u) => {
      const mem = u.memberId ? memberMap[u.memberId] : null;
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        mobile: u.mobile || mem?.mobile || mem?.contactDetails?.mobile || '',
        memberId: u.memberId || '',
        assignedDistrict: u.assignedDistrict || mem?.addressDetails?.district || '',
        status: u.status || 'active',
      };
    });

    return res.status(200).json({
      success: true,
      count: associates.length,
      associates,
    });
  } catch (error) {
    console.error('getAssociatesList error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve associate members: ' + error.message,
    });
  }
};

module.exports = {
  getInvestorStats,
  getInvestors,
  getInvestorById,
  getAssociatesList,
  createInvestor,
  updateInvestor,
  verifyKyc,
  requestKycCorrection,
  recordPayment,
  verifyPayment,
  getInvestmentPlans,
  assignPlan,
  activateInvestorPlan,
  createInvestmentPlan,
  updateInvestmentPlan,
  recordPayoutOrRefund,
  addLedgerAdjustment,
  reverseLedgerEntry,
  getAllLedgerEntries,
  getFundAllocationAndReconciliation,
  getFinancialReports,
  sendConfirmationEmail,
  sendInvestorNotification,
  uploadAgreement,
  getInvestorInvestments,
  createAdditionalInvestment,
  verifyInvestmentPayment,
  associateApproveInvestor,
  finalApproveInvestor,
};

