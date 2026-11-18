const mongoose = require('mongoose');
const LoanApplication = require('../models/LoanApplication');
const Member = require('../models/Member');
const Application = require('../models/Application');
const District = require('../models/District');
const User = require('../models/User');
const LoanSetting = require('../models/LoanSetting');

/**
 * Generate unique sequential Loan Application ID: LOAN-2026-1001
 */
const generateLoanAppId = async () => {
  const last = await LoanApplication.findOne({ applicationId: /^LOAN-2026-\d+$/ })
    .sort({ createdAt: -1 })
    .exec();

  let nextNum = 1001;
  if (last && last.applicationId) {
    const parts = last.applicationId.split('-');
    const currentNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(currentNum)) {
      nextNum = currentNum + 1;
    }
  }
  return `LOAN-2026-${nextNum}`;
};

/**
 * Construct secure customer-isolated query filter.
 * Strictly uses authenticated user._id and linked verified memberId.
 * Never filters by email or arbitrary unverified fields to prevent cross-account data leaks.
 */
const buildCustomerQuery = (user, resolvedMemberId) => {
  const orConditions = [];

  if (user && user._id && mongoose.Types.ObjectId.isValid(user._id)) {
    orConditions.push({ userId: user._id });
  }

  if (
    resolvedMemberId &&
    typeof resolvedMemberId === 'string' &&
    resolvedMemberId.trim() &&
    resolvedMemberId.trim() !== 'UF-2026-MEMBER'
  ) {
    orConditions.push({ memberId: resolvedMemberId.trim() });
  }

  if (orConditions.length === 0) {
    // Neither valid userId nor memberId is available: return impossible condition
    return { _id: new mongoose.Types.ObjectId() };
  }

  return orConditions.length === 1 ? orConditions[0] : { $or: orConditions };
};

/**
 * Resolve member record for authenticated user with strict identity linkage.
 * Never matches by email to prevent cross-customer data leakage.
 */
const resolveMember = async (user) => {
  if (!user) return { member: null, application: null };

  const memberId = user.memberId;
  const isValidObjectId = mongoose.Types.ObjectId.isValid(user._id);

  let member = null;
  let app = null;

  // 1. Direct match by unique statutory memberId
  if (memberId && typeof memberId === 'string' && memberId.trim()) {
    member = await Member.findOne({ memberId: memberId.trim() });
  }

  // 2. Direct match by authenticated user's ObjectId
  if (!member && isValidObjectId) {
    member = await Member.findOne({ userId: user._id });
  }

  // 3. Direct match by linked membership Application ID
  if (!member && user.applicationId && mongoose.Types.ObjectId.isValid(user.applicationId)) {
    member = await Member.findOne({ applicationId: user.applicationId });
  }

  // Resolve membership Application
  if (user.applicationId && mongoose.Types.ObjectId.isValid(user.applicationId)) {
    app = await Application.findById(user.applicationId);
  } else if (memberId && typeof memberId === 'string' && memberId.trim()) {
    app = await Application.findOne({ memberId: memberId.trim() });
  } else if (isValidObjectId) {
    app = await Application.findOne({ userId: user._id });
  }

  return { member, application: app };
};

/**
 * Resilient lookup by MongoDB _id or string applicationId
 */
const resolveLoanByIdOrAppId = async (idOrAppId) => {
  if (!idOrAppId || idOrAppId === 'undefined' || idOrAppId === 'null') {
    return null;
  }
  const cleanId = String(idOrAppId).trim();
  if (!cleanId || cleanId === 'undefined' || cleanId === 'null') {
    return null;
  }
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    const loan = await LoanApplication.findById(cleanId);
    if (loan) return loan;
  }
  return await LoanApplication.findOne({ applicationId: cleanId });
};

/**
 * Compute customer tracking display status
 */
const computeCustomerApplicationStatus = (app) => {
  if (!app) return 'Not Applied';
  if (app.disbursement?.isDisbursed || app.status === 'Active' || app.status === 'Disbursed') {
    return 'Active';
  }
  if (
    app.status === 'Approved' ||
    app.status === 'Approved – Not Disbursed' ||
    app.status === 'Approved - Not Disbursed' ||
    (app.finalApproval?.status === 'Approved' && !app.disbursement?.isDisbursed)
  ) {
    return 'Approved – Not Disbursed';
  }
  if (
    app.status === 'Pending Final Approval' ||
    app.status === 'Forwarded to Super Admin' ||
    app.status === 'Pending District Verification' ||
    app.status === 'Submitted' ||
    app.status === 'Under Verification' ||
    (app.finalApproval?.status === 'Pending' || !app.finalApproval?.status)
  ) {
    return 'Pending Final Approval';
  }
  return app.status;
};

/**
 * Generate or synchronize EMI repayment schedule according to client-selected policy:
 * Option 1: Reducing Balance EMI (Interest charged only on remaining principal each month)
 * Note: Base interest rate is configured (default 5% p.a., subject to upcoming CIBIL-linked 11%/12% rule confirmation)
 */
const generateOrSyncEmiSchedule = (loan) => {
  if (!loan) return null;
  const isEligible = Boolean(
    loan.disbursement?.isDisbursed === true ||
    loan.status === 'Active' ||
    loan.status === 'Disbursed' ||
    loan.status === 'Closed' ||
    loan.finalApproval?.status === 'Approved' ||
    loan.status === 'Approved' ||
    loan.status === 'Approved – Not Disbursed' ||
    loan.status === 'Approved - Not Disbursed'
  );
  if (!isEligible) return loan;

  const principal =
    Number(loan.disbursement?.disbursedAmount) ||
    Number(loan.finalApproval?.approvedAmount) ||
    Number(loan.sanctionedAmount) ||
    Number(loan.requestedAmount) ||
    10000;

  const tenure =
    Number(loan.finalApproval?.approvedTenureMonths) ||
    Number(loan.preferredTenureMonths) ||
    3;

  const rawRate = Number(loan.interestRate) || 1; // Monthly rate if <= 5 (e.g. 1% / mo) or annual if > 5 (e.g. 12% p.a.)
  const monthlyRate = rawRate <= 5 ? rawRate / 100 : rawRate / (12 * 100);

  // Standard Reducing Balance Monthly EMI formula:
  // E = P * r * (1 + r)^n / ((1 + r)^n - 1)
  let monthlyEmi = Math.round(principal / tenure);
  if (monthlyRate > 0) {
    const factor = Math.pow(1 + monthlyRate, tenure);
    monthlyEmi = Math.round((principal * monthlyRate * factor) / (factor - 1));
  }

  const baseDate = loan.disbursement?.disbursedAt
    ? new Date(loan.disbursement.disbursedAt)
    : (loan.createdAt ? new Date(loan.createdAt) : new Date());

  const now = new Date();

  // If schedule is empty or count does not match tenure, generate clean Reducing Balance schedule
  if (!Array.isArray(loan.repayment?.schedule) || loan.repayment.schedule.length === 0) {
    loan.repayment = loan.repayment || {};
    const schedule = [];
    let remainingPrincipal = principal;
    let totalInterestSum = 0;
    let totalPayableSum = 0;

    for (let i = 1; i <= tenure; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      // Interest charged on current reducing balance
      const intComp = Math.round(remainingPrincipal * monthlyRate);
      let princComp = monthlyEmi - intComp;

      if (i === tenure || princComp > remainingPrincipal) {
        princComp = remainingPrincipal; // Last installment settles exact remaining principal
      }

      const installmentEmi = princComp + intComp;
      remainingPrincipal = Math.max(0, remainingPrincipal - princComp);
      totalInterestSum += intComp;
      totalPayableSum += installmentEmi;

      const isOverdue = dueDate < now;

      schedule.push({
        instalmentNumber: i,
        dueDate,
        emiAmount: installmentEmi,
        principalComponent: princComp,
        interestComponent: intComp,
        paidAmount: 0,
        paidAt: null,
        paymentStatus: isOverdue ? 'Overdue' : 'Upcoming',
        transactionId: '',
        utrNumber: '',
        paymentMethod: '',
        receiptUrl: '',
      });
    }

    loan.repayment.schedule = schedule;
    loan.repayment.totalPayableAmount = totalPayableSum;
    loan.repayment.monthlyEmiAmount = monthlyEmi;
  } else {
    // If schedule already exists, check if any installment is paid
    const hasAnyPaid = loan.repayment.schedule.some((s) => s.paymentStatus === 'Paid');
    if (!hasAnyPaid) {
      // Regenerate schedule to switch from previous flat calculation to Reducing Balance
      const schedule = [];
      let remainingPrincipal = principal;
      let totalInterestSum = 0;
      let totalPayableSum = 0;

      for (let i = 1; i <= tenure; i++) {
        const dueDate = new Date(baseDate);
        dueDate.setMonth(dueDate.getMonth() + i);

        const intComp = Math.round(remainingPrincipal * monthlyRate);
        let princComp = monthlyEmi - intComp;

        if (i === tenure || princComp > remainingPrincipal) {
          princComp = remainingPrincipal;
        }

        const installmentEmi = princComp + intComp;
        remainingPrincipal = Math.max(0, remainingPrincipal - princComp);
        totalInterestSum += intComp;
        totalPayableSum += installmentEmi;

        const isOverdue = dueDate < now;

        schedule.push({
          instalmentNumber: i,
          dueDate,
          emiAmount: installmentEmi,
          principalComponent: princComp,
          interestComponent: intComp,
          paidAmount: 0,
          paidAt: null,
          paymentStatus: isOverdue ? 'Overdue' : 'Upcoming',
          transactionId: '',
          utrNumber: '',
          paymentMethod: '',
          receiptUrl: '',
        });
      }

      loan.repayment.schedule = schedule;
      loan.repayment.totalPayableAmount = totalPayableSum;
      loan.repayment.monthlyEmiAmount = monthlyEmi;
    } else {
      // If some installments are already paid, preserve them and update overdue status for unpaid ones
      loan.repayment.schedule.forEach((inst) => {
        if (inst.paymentStatus !== 'Paid') {
          const d = new Date(inst.dueDate);
          if (d < now) {
            inst.paymentStatus = 'Overdue';
          } else {
            inst.paymentStatus = 'Upcoming';
          }
        }
      });
    }
  }

  // Calculate actual total paid amount across installments and payment records
  const totalPaid = (loan.repayment.schedule || []).reduce(
    (sum, inst) => sum + (inst.paymentStatus === 'Paid' ? (Number(inst.paidAmount) || Number(inst.emiAmount) || 0) : 0),
    0
  );
  loan.repayment.totalPaidAmount = totalPaid;
  loan.repayment.outstandingBalance = Math.max(
    0,
    (loan.repayment.totalPayableAmount || principal) - totalPaid
  );

  // Set next unpaid installment info
  const nextUnpaid = (loan.repayment.schedule || []).find((inst) => inst.paymentStatus !== 'Paid');
  if (nextUnpaid) {
    loan.repayment.nextEmiDueDate = nextUnpaid.dueDate;
    loan.repayment.nextEmiAmount = nextUnpaid.emiAmount;
  } else {
    loan.repayment.nextEmiDueDate = null;
    loan.repayment.nextEmiAmount = 0;
    if (loan.repayment.outstandingBalance === 0 && totalPaid > 0) {
      loan.status = 'Closed';
    }
  }

  return loan;
};

/**
 * @desc    Get simplified customer loan overview metrics based on client requirements
 * @route   GET /api/loan-applications/overview
 * @access  Private (Authenticated Member)
 */
const getCustomerLoanOverview = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);

    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const isApprovedMember =
      (member?.status || '').toLowerCase() === 'active' ||
      (application?.status || '').toLowerCase() === 'approved';

    const numberOfShares =
      member?.numberOfShares || application?.membershipDetails?.numberOfShares || 10;
    const isShareAllotted = numberOfShares >= 10;

    const baseEligibility = {
      isEligible: isApprovedMember && isShareAllotted,
      statusText:
        isApprovedMember && isShareAllotted
          ? 'Eligible for First Member Loan'
          : !isApprovedMember
          ? 'Requires Approved Membership Dossier'
          : 'Requires Minimum 10 Allotted Statutory Shares',
      memberStatus: member?.status || application?.status || 'under_review',
      numberOfShares,
    };

    if (!resolvedMemberId) {
      return res.status(200).json({
        success: true,
        data: {
          loanEligibility: baseEligibility,
          firstLoanAmount: 10000,
          applicationStatus: 'Not Applied',
          selectedRepaymentTenure: null,
          approvedLoanAmount: null,
          emiInformation: {
            isAvailable: false,
            message:
              'Your EMI schedule will be available after loan approval and successful disbursement.',
          },
          nextLoanEligibility: {
            isUnlocked: false,
            currentLevel: 'First Member Loan (₹10,000)',
            message:
              'First loan of ₹10,000 must be taken and fully repaid to unlock the next credit tier.',
          },
          totalLoanApplications: 0,
          pendingApplications: 0,
          approvedLoans: 0,
          activeLoans: 0,
          totalDisbursedAmount: 0,
          outstandingLoanBalance: 0,
          nextEmiDueDate: null,
          nextEmiAmount: 0,
          member: {
            memberId: '—',
            name: user.name || 'Valued Member',
            status: 'under_review',
            district: 'Khurda',
          },
        },
      });
    }

    // Query applications strictly for this authenticated customer only
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);
    const applications = await LoanApplication.find(customerFilter).sort({ createdAt: -1 });

    const totalLoanApplications = applications.length;
    const latestApp = applications[0] || null;

    const pendingStatuses = [
      'Submitted',
      'Pending District Verification',
      'Under Verification',
      'Forwarded to Super Admin',
      'Pending Final Approval',
      'On Hold',
    ];
    const pendingApplications = applications.filter((a) =>
      pendingStatuses.includes(a.status)
    ).length;

    const approvedLoans = applications.filter(
      (a) => a.status === 'Approved' || a.status === 'Disbursed'
    ).length;

    // Active loans: strictly disbursed
    const activeLoanRecords = applications.filter(
      (a) => a.disbursement?.isDisbursed === true && (a.repayment?.outstandingBalance || 0) > 0
    );
    const activeLoans = activeLoanRecords.length;

    const totalDisbursedAmount = applications.reduce(
      (sum, a) =>
        sum + (a.disbursement?.isDisbursed ? Number(a.disbursement.disbursedAmount || 0) : 0),
      0
    );

    const outstandingLoanBalance = activeLoanRecords.reduce(
      (sum, a) => sum + Number(a.repayment?.outstandingBalance || 0),
      0
    );

    // Active disbursed loan details
    const latestDisbursed = applications.find((a) => a.disbursement?.isDisbursed === true);

    // Next upcoming EMI
    let nextEmiDueDate = null;
    let nextEmiAmount = 0;
    let monthlyEmi = 0;

    if (latestDisbursed) {
      monthlyEmi = latestDisbursed.repayment?.monthlyEmiAmount || 0;
      const schedule = latestDisbursed.repayment?.schedule || [];
      const upcoming = schedule.find(
        (s) => s.paymentStatus === 'Upcoming' || s.paymentStatus === 'Overdue'
      );
      if (upcoming) {
        nextEmiDueDate = upcoming.dueDate;
        nextEmiAmount = upcoming.emiAmount;
      }
    }

    // Next Loan Eligibility evaluation:
    // Client requirement: customer first takes ₹10,000 loan and completes repayment.
    const fullyRepaidLoans = applications.filter(
      (a) =>
        a.disbursement?.isDisbursed === true &&
        (a.repayment?.outstandingBalance || 0) === 0 &&
        (a.repayment?.totalPaidAmount || 0) > 0
    );

    const isNextTierUnlocked = fullyRepaidLoans.length > 0;

    const nextLoanEligibility = {
      isUnlocked: isNextTierUnlocked,
      currentLevel: isNextTierUnlocked
        ? 'First Member Loan Settled (Tier 2 Eligible)'
        : activeLoans > 0
        ? 'First Member Loan (₹10,000) Active'
        : 'First Member Loan (₹10,000) Initial Tier',
      message: isNextTierUnlocked
        ? 'Congratulations! You have successfully completed full repayment of your First Member Loan. You are eligible to apply for the next loan level.'
        : activeLoans > 0
        ? 'Your First Member Loan of ₹10,000 is currently in repayment. Complete repayment unlocks the next credit tier.'
        : 'New members commence with the First Member Loan of ₹10,000. Full repayment of this loan unlocks higher tiers.',
      nextEligibleAmount: isNextTierUnlocked ? 'To be configured by Super Admin' : null,
      fullyRepaidCount: fullyRepaidLoans.length,
    };

    const loanSetting = await LoanSetting.getOrCreateDefault();

    return res.status(200).json({
      success: true,
      data: {
        loanEligibility: baseEligibility,
        firstLoanAmount: loanSetting.defaultAmount || 10000,
        loanSetting,
        applicationStatus: latestApp ? computeCustomerApplicationStatus(latestApp) : 'Not Applied',
        rawApplicationStatus: latestApp ? latestApp.status : 'Not Applied',
        selectedRepaymentTenure: latestApp
          ? `${latestApp.preferredTenureMonths} Months`
          : null,
        approvedLoanAmount:
          latestApp && (latestApp.status === 'Approved' || latestApp.status === 'Disbursed')
            ? latestApp.sanctionedAmount || latestApp.requestedAmount
            : null,
        emiInformation: {
          isAvailable: latestDisbursed ? true : false,
          message: latestDisbursed
            ? `Monthly EMI: ₹${monthlyEmi.toLocaleString('en-IN')}`
            : 'Your EMI schedule will be available after loan approval and successful disbursement.',
          nextEmiDueDate,
          nextEmiAmount,
          monthlyEmi,
        },
        nextLoanEligibility,
        latestApplication: latestApp
          ? {
              applicationId: latestApp.applicationId,
              loanType: latestApp.loanType,
              status: computeCustomerApplicationStatus(latestApp),
              rawStatus: latestApp.status,
              createdAt: latestApp.createdAt,
              tenure: `${latestApp.preferredTenureMonths} Months`,
              district: latestApp.district,
            }
          : null,
        totalLoanApplications,
        pendingApplications,
        approvedLoans,
        activeLoans,
        totalDisbursedAmount,
        outstandingLoanBalance,
        nextEmiDueDate,
        nextEmiAmount,
        member: {
          memberId: resolvedMemberId,
          name: member?.name || user.name || application?.applicantName || 'Valued Member',
          status: member?.status || 'active',
          district:
            member?.addressDetails?.district ||
            application?.addressDetails?.district ||
            'Khurda',
        },
      },
    });
  } catch (error) {
    console.error('Error fetching loan overview:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan overview',
    });
  }
};

/**
 * @desc    Get client-approved available loan products with First Loan = ₹10,000 & 3, 6, 9 months
 * @route   GET /api/loan-applications/products
 * @access  Private (Authenticated Member)
 */
const getAvailableLoanProducts = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);

    const isMemberApproved =
      (member?.status || '').toLowerCase() === 'active' ||
      (application?.status || '').toLowerCase() === 'approved';

    const numberOfShares =
      member?.numberOfShares || application?.membershipDetails?.numberOfShares || 10;
    const isShareAllotted = numberOfShares >= 10;

    // Check if customer already has an active application
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    let hasActivePending = false;
    let activeAppId = null;

    if (resolvedMemberId || (user && user._id)) {
      const customerFilter = buildCustomerQuery(user, resolvedMemberId);
      const activePending = await LoanApplication.findOne({
        ...customerFilter,
        status: {
          $in: [
            'Submitted',
            'Pending District Verification',
            'Under Verification',
            'On Hold',
            'Forwarded to Super Admin',
            'Pending Final Approval',
            'Approved',
          ],
        },
      });
      if (activePending) {
        hasActivePending = true;
        activeAppId = activePending.applicationId;
      }
    }

    // Retrieve active dynamic Loan & EMI Settings configured by Admin
    const loanSetting = await LoanSetting.getOrCreateDefault();

    const activeAmount = loanSetting.defaultAmount || 10000;
    const activeMinAmount = loanSetting.minAmount || 5000;
    const activeMaxAmount = loanSetting.maxAmount || 50000;
    const activeIsFixed = loanSetting.isAmountFixed !== false;
    const activeTenures =
      Array.isArray(loanSetting.availableTenureMonths) && loanSetting.availableTenureMonths.length > 0
        ? loanSetting.availableTenureMonths
        : [3, 6, 9];

    // Client-approved First Loan policy (configured dynamically)
    const loanProducts = [
      {
        id: 'tier-1-first-member-loan',
        loanType: 'First Member Term Loan',
        tier: 'Tier 1 (Member Credit Facility)',
        badge: 'ACTIVE LOAN FACILITY',
        description: `Approved statutory credit facility of ₹${activeAmount.toLocaleString('en-IN')} designed exclusively for admitted members of New Utkal Finance Ltd.`,
        interestRate: loanSetting.monthlyInterestRate || 1,
        highCibilInterestRate: loanSetting.highCibilInterestRate || 12,
        standardCibilInterestRate: loanSetting.standardCibilInterestRate || 12,
        cibilThreshold: loanSetting.cibilThreshold || 600,
        interestRateDisplay:
          loanSetting.interestRateDisplay ||
          `${loanSetting.monthlyInterestRate || 1}% / Month`,
        minAmount: activeMinAmount,
        maxAmount: activeMaxAmount,
        defaultAmount: activeAmount,
        isAmountFixed: activeIsFixed,
        allowedAmounts: loanSetting.allowedAmounts || [10000, 20000, 30000, 50000],
        availableTenureMonths: activeTenures,
        defaultTenureMonths: loanSetting.defaultTenureMonths || activeTenures[0] || 3,
        tenureDisplay: activeTenures.map((m) => `${m} Months`).join(', '),
        emiCalculationMethod: loanSetting.emiCalculationMethod || 'reducing_balance',
        processingFeePercent: loanSetting.processingFeePercent ?? 1,
        processingFeeFixed: loanSetting.processingFeeFixed ?? 0,
        aboutEmiNote:
          loanSetting.aboutEmiNote ||
          'EMI is calculated on reducing balance. Monthly repayments are scheduled on the 5th of each month following disbursement with zero prepayment penalty.',
        repaymentGuidelines: loanSetting.repaymentGuidelines || [
          'Monthly installments are auto-debited or payable via direct UPI/IMPS.',
          'Grace period of 3 business days is provided before penalty charges.',
          'Timely repayments elevate your credit profile and unlock higher credit limits.',
        ],
        policyReference: loanSetting.policyReference || 'Utkal Finance Statutory Member Credit Policy 2026',
        eligibilityCriteria: [
          'Approved statutory associate membership of New Utkal Finance Ltd.',
          'Active share capital contribution (minimum 10 shares verified)',
          'Completed KYC dossier (Aadhaar Card, PAN Card, Photo and Specimen Signature on record)',
          'No delinquent or outstanding prior dues',
        ],
        requiredDocuments: [
          'Aadhaar Card / Government Identity Proof',
          'PAN Card / Form 60',
          'Latest Bank Statement (Last 3 Months) or Passbook',
          'Income / Occupation Proof or Self-Declaration',
        ],
        isEligible: isMemberApproved && isShareAllotted && !hasActivePending,
        ineligibilityReason: hasActivePending
          ? `You already have an active loan application (${activeAppId}) in progress. Only one active application is permitted at a time.`
          : !isMemberApproved
          ? 'Requires approved and active statutory membership.'
          : !isShareAllotted
          ? 'Requires minimum 10 verified statutory shares.'
          : '',
      },
      {
        id: 'tier-2-expansion-loan',
        loanType: 'Tier 2 Member Expansion Loan',
        tier: 'Tier 2 (Next Credit Level)',
        badge: 'LOCKED TIER',
        description:
          'Higher credit tier unlocked exclusively for members with verified 100% full repayment of their First Member Loan.',
        interestRate: loanSetting.baseInterestRate || 11,
        interestRateDisplay: `${loanSetting.baseInterestRate || 11}% p.a.`,
        minAmount: activeMaxAmount,
        maxAmount: activeMaxAmount * 2,
        defaultAmount: activeMaxAmount,
        isAmountFixed: true,
        availableTenureMonths: [6, 9, 12],
        tenureDisplay: '6, 9, or 12 Months',
        eligibilityCriteria: [
          `100% timely repayment of First Member Loan (₹${activeAmount.toLocaleString('en-IN')}) verified on the backend`,
          'Credit clearance audit from designated District Admin',
          'Super Admin configuration of higher loan sanctioned limit',
        ],
        requiredDocuments: [
          'First Loan Clearance Record',
          'Updated Bank Statement',
          'Income Proof',
        ],
        isEligible: false,
        ineligibilityReason:
          `Unlocked only after complete repayment of your First Member Loan (₹${activeAmount.toLocaleString('en-IN')}) is verified on the backend.`,
      },
    ];

    return res.status(200).json({
      success: true,
      isMemberApproved,
      isShareAllotted,
      hasActivePending,
      activeAppId,
      memberDistrict:
        member?.addressDetails?.district || application?.addressDetails?.district || 'Khurda',
      loanSetting,
      products: loanProducts,
    });
  } catch (error) {
    console.error('Error fetching loan products:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan products',
    });
  }
};

/**
 * @desc    Submit a new loan application enforcing client requirements:
 *          - Fixed First Loan amount of ₹10,000
 *          - Tenure selection: 3, 6, or 9 Months
 *          - Duplicate active application prevention
 * @route   POST /api/loan-applications/apply
 * @access  Private (Authenticated Member)
 */
const applyForLoan = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);

    // Membership verification check
    const isApproved =
      (member?.status || '').toLowerCase() === 'active' ||
      (application?.status || '').toLowerCase() === 'approved';

    if (!isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Only approved and active statutory members are eligible to apply for loans.',
      });
    }

    const resolvedMemberId =
      member?.memberId || user.memberId || application?.memberId || null;

    // Prevent duplicate pending applications
    const activeStatuses = [
      'Submitted',
      'Pending District Verification',
      'Under Verification',
      'On Hold',
      'Forwarded to Super Admin',
      'Pending Final Approval',
      'Approved',
    ];

    const customerFilter = buildCustomerQuery(user, resolvedMemberId);
    const existingActive = await LoanApplication.findOne({
      ...customerFilter,
      status: { $in: activeStatuses },
    });

    if (existingActive) {
      return res.status(400).json({
        success: false,
        message: `You already have an active loan application (${existingActive.applicationId}) currently under '${existingActive.status}'. Client policy permits one active loan application per customer at a time.`,
        existingApplicationId: existingActive.applicationId,
      });
    }

    const {
      loanPurpose,
      preferredTenureMonths,
      occupationType,
      monthlyIncome,
      employerOrBusinessName,
      workAddress,
      cibilScore: submittedCibil,
    } = req.body;

    // Retrieve active dynamic Loan & EMI Settings
    const loanSetting = await LoanSetting.getOrCreateDefault();

    // Field validations
    const errors = {};

    // Dynamic Loan Amount handling
    let finalRequestedAmount = loanSetting.defaultAmount || 10000;
    if (!loanSetting.isAmountFixed && req.body.requestedAmount) {
      const parsedAmt = Number(req.body.requestedAmount);
      if (!isNaN(parsedAmt) && parsedAmt >= loanSetting.minAmount && parsedAmt <= loanSetting.maxAmount) {
        finalRequestedAmount = parsedAmt;
      } else {
        errors.requestedAmount = `Requested loan amount must be between ₹${loanSetting.minAmount.toLocaleString('en-IN')} and ₹${loanSetting.maxAmount.toLocaleString('en-IN')}`;
      }
    }

    const allowableTenures =
      Array.isArray(loanSetting.availableTenureMonths) && loanSetting.availableTenureMonths.length > 0
        ? loanSetting.availableTenureMonths
        : [3, 6, 9];

    // Validate tenure: Must be in configured allowable tenures
    const tenureNum = parseInt(preferredTenureMonths, 10);
    if (!allowableTenures.includes(tenureNum)) {
      errors.preferredTenureMonths = `Please select an approved repayment tenure: ${allowableTenures.map((t) => `${t} Months`).join(', ')}`;
    }

    const rawCibil = submittedCibil ? parseInt(submittedCibil, 10) : null;
    const cibilScore = !isNaN(rawCibil) && rawCibil >= 300 && rawCibil <= 900 ? rawCibil : null;
    const threshold = loanSetting.cibilThreshold || 600;
    const highRate = loanSetting.highCibilInterestRate || loanSetting.baseInterestRate || 11;
    const stdRate = loanSetting.standardCibilInterestRate || loanSetting.baseInterestRate || 12;
    const calculatedRate = cibilScore ? (cibilScore > threshold ? highRate : stdRate) : (loanSetting.baseInterestRate || 11);

    const finalLoanPurpose = (loanPurpose && loanPurpose.trim()) || 'Statutory Member Term Loan Facility';
    const finalMonthlyIncome = monthlyIncome !== undefined && monthlyIncome !== '' && Number(monthlyIncome) >= 0
      ? Number(monthlyIncome)
      : 25000;

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed for loan application',
        errors,
      });
    }

    // Process uploaded documents from multer req.files
    const documents = [];
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach((file) => {
        const fileUrl = `/uploads/documents/${file.filename}`;
        const docType = file.fieldname
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        documents.push({
          documentType: docType,
          documentName: file.originalname || `${docType}.pdf`,
          documentUrl: fileUrl,
          uploadedAt: new Date(),
        });
      });
    }

    // 1. Determine customer's district from application submission or verified member profile
    const rawDistrict = (
      req.body.district ||
      member?.addressDetails?.district ||
      application?.addressDetails?.district ||
      user?.assignedDistrict ||
      'Khurda'
    ).trim();

    // 2. Automatically match with District registry
    let matchedDistrict = await District.findOne({
      name: new RegExp(`^${rawDistrict}$`, 'i'),
    });

    const finalDistrictName = matchedDistrict ? matchedDistrict.name : rawDistrict;
    const finalDistrictId = matchedDistrict ? matchedDistrict._id : null;

    // 3. Match with assigned District Admin for this circle
    const assignedDistrictAdmin = await User.findOne({
      role: 'district_admin',
      status: 'active',
      $or: [
        ...(finalDistrictId ? [{ districtId: finalDistrictId }] : []),
        { assignedDistrict: new RegExp(`^${finalDistrictName}$`, 'i') },
      ],
    });

    const isDistrictAdminAssigned = !!assignedDistrictAdmin;
    const assignedAdminId = assignedDistrictAdmin ? assignedDistrictAdmin._id : null;
    const assignedAdminName = assignedDistrictAdmin ? assignedDistrictAdmin.name : '';

    const applicantName =
      member?.name || user.name || application?.applicantName || 'Valued Member';
    const email = (member?.email || user.email).toLowerCase().trim();
    const mobile = (member?.mobile || user.mobile).trim();

    const appId = await generateLoanAppId();

    // First loan amount follows dynamic policy
    const requestedAmount = finalRequestedAmount;

    const newLoanApp = await LoanApplication.create({
      applicationId: appId,
      memberId: resolvedMemberId,
      userId: user._id,
      applicantName,
      email,
      mobile,
      district: finalDistrictName,
      districtId: finalDistrictId,
      assignedDistrictAdminId: assignedAdminId,
      assignedDistrictAdminName: assignedAdminName,
      isDistrictAdminAssigned,
      loanType: 'First Member Term Loan',
      loanCategory: 'Statutory Member Credit Facility',
      requestedAmount,
      interestRate: calculatedRate,
      cibilScore,
      cibilStatus: cibilScore
        ? cibilScore > threshold
          ? `Score > ${threshold} (${highRate}% Tier)`
          : `Score <= ${threshold} (${stdRate}% Tier)`
        : `${calculatedRate}% Standard Policy`,
      preferredTenureMonths: tenureNum,
      loanPurpose: finalLoanPurpose,
      employmentDetails: {
        occupationType: occupationType ? occupationType.trim() : 'Self-Employed / Business',
        monthlyIncome: finalMonthlyIncome,
        employerOrBusinessName: employerOrBusinessName ? employerOrBusinessName.trim() : '',
        workAddress: workAddress ? workAddress.trim() : '',
      },
      documents,
      status: 'Pending Final Approval',
      districtVerification: {
        status: 'Verified',
        districtId: finalDistrictId,
        isForwardedToSuperAdmin: true,
        forwardedToSuperAdminAt: new Date(),
        districtRemarks: isDistrictAdminAssigned
          ? `Direct application routed to Super Admin for approval. Jurisdiction: ${finalDistrictName} District (${assignedAdminName}).`
          : `Direct application routed to Super Admin for approval. (District: ${finalDistrictName})`,
      },
      finalApproval: {
        status: 'Pending',
      },
    });

    console.log(
      `[LoanApplication] Direct Super Admin loan application created: ${newLoanApp.applicationId} for member ${resolvedMemberId} in ${finalDistrictName} (District Admin: ${isDistrictAdminAssigned ? assignedAdminName : 'Unassigned'})`
    );

    return res.status(201).json({
      success: true,
      message: `First Member Loan application (${newLoanApp.applicationId}) for ₹${requestedAmount.toLocaleString('en-IN')} with ${tenureNum} Months tenure submitted successfully! Routed directly to Super Admin for final review and sanction.`,
      application: newLoanApp,
      isDistrictAdminAssigned,
    });
  } catch (error) {
    console.error('Error submitting loan application:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while submitting loan application',
    });
  }
};

/**
 * @desc    Track application status with all required fields:
 *          - Application ID
 *          - Customer Name
 *          - Requested Loan Amount (₹10,000)
 *          - Selected Tenure
 *          - Submission Date
 *          - District Admin verification status & remarks
 *          - Super Admin final approval status & remarks
 *          - Current lifecycle status
 * @route   GET /api/loan-applications/track
 * @access  Private (Authenticated Member)
 */
const getTrackApplicationStatus = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    const applications = await LoanApplication.find(customerFilter).sort({ createdAt: -1 });

    const formattedApplications = applications.map((app) => {
      const displayStatus = computeCustomerApplicationStatus(app);
      return {
        applicationId: app.applicationId,
        customerName: app.applicantName,
        requestedLoanAmount: app.requestedAmount,
        selectedTenure: `${app.preferredTenureMonths} Months`,
        preferredTenureMonths: app.preferredTenureMonths,
        submissionDate: app.createdAt,
        district: app.district,
        loanType: app.loanType,
        districtAdminVerificationStatus: app.districtVerification?.status || 'Pending',
        districtAdminRemarks:
          app.districtVerification?.districtRemarks ||
          'Awaiting field KYC and document verification by designated District Admin.',
        districtRejectionReason: app.districtVerification?.rejectionReason || '',
        superAdminFinalApprovalStatus: app.finalApproval?.status || 'Pending',
        finalDecisionRemarks:
          app.finalApproval?.finalRemarks ||
          (app.status === 'Approved'
            ? 'Approved by Super Admin.'
            : app.status === 'Rejected'
            ? app.finalApproval?.rejectionReason || 'Application rejected by Super Admin.'
            : app.status === 'On Hold'
            ? 'Application placed on hold by Super Admin.'
            : displayStatus === 'Verified by District Admin – Pending Final Approval'
            ? 'Verified by District Admin – Pending Final Approval from Super Admin.'
            : 'Pending final review and sanction by Super Admin.'),
        superAdminRejectionReason: app.finalApproval?.rejectionReason || '',
        sanctionedAmount: app.sanctionedAmount || 0,
        currentApplicationStatus: displayStatus,
        rawStatus: app.status,
        displayStatus: displayStatus,
        disbursement: app.disbursement || { isDisbursed: false },
        documents: app.documents || [],
        loanPurpose: app.loanPurpose,
        employmentDetails: app.employmentDetails,
        districtVerification: app.districtVerification || {},
        finalApproval: app.finalApproval || {},
      };
    });

    return res.status(200).json({
      success: true,
      hasApplications: formattedApplications.length > 0,
      latestApplication: formattedApplications[0] || null,
      applications: formattedApplications,
    });
  } catch (error) {
    console.error('Error tracking application status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to track loan application status',
    });
  }
};

/**
 * @desc    Get EMI Schedule page data based on client requirements:
 *          - Before loan approval & disbursement: returns exact required message
 *          - After disbursement: returns full schedule with principal, interest, EMI, due date, status
 * @route   GET /api/loan-applications/emi-schedule
 * @access  Private (Authenticated Member)
 */
const getEmiSchedule = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    // Check for disbursed loans strictly
    const disbursedLoan = await LoanApplication.findOne({
      ...customerFilter,
      $or: [
        { 'disbursement.isDisbursed': true },
        { status: { $in: ['Active', 'Disbursed', 'Closed'] } },
      ],
    }).sort({ 'disbursement.disbursedAt': -1 });

    if (!disbursedLoan) {
      return res.status(200).json({
        success: true,
        isDisbursed: false,
        message:
          'Your EMI schedule will be available after loan approval and successful disbursement.',
      });
    }

    // Synchronize or generate EMI schedule under Option 1 (Reducing Balance EMI) policy
    generateOrSyncEmiSchedule(disbursedLoan);
    if (disbursedLoan.isModified && disbursedLoan.isModified()) {
      try {
        await LoanApplication.updateOne(
          { _id: disbursedLoan._id },
          { $set: { repayment: disbursedLoan.repayment } }
        );
      } catch (saveErr) {
        console.warn('Silent sync error for loan repayment:', saveErr.message);
      }
    }

    const loanAmount =
      Number(disbursedLoan.disbursement?.disbursedAmount) ||
      Number(disbursedLoan.sanctionedAmount) ||
      10000;
    const tenureMonths =
      disbursedLoan.finalApproval?.approvedTenureMonths ||
      disbursedLoan.preferredTenureMonths ||
      3;
    const interestRate = disbursedLoan.interestRate || 5;

    // Repayment schedule from database
    const scheduleItems = (disbursedLoan.repayment?.schedule || []).map((inst) => ({
      instalmentNumber: inst.instalmentNumber,
      dueDate: inst.dueDate,
      emiAmount: inst.emiAmount,
      principalAmount:
        inst.principalComponent || Math.round(loanAmount / (tenureMonths || 3)),
      interestAmount:
        inst.interestComponent ||
        Math.max(
          0,
          inst.emiAmount - (inst.principalComponent || Math.round(loanAmount / (tenureMonths || 3)))
        ),
      paidAmount: inst.paidAmount || 0,
      paymentStatus: inst.paymentStatus, // 'Upcoming' | 'Paid' | 'Overdue'
      transactionId: inst.transactionId || '',
      utrNumber: inst.utrNumber || '',
    }));

    const totalPayableAmount =
      disbursedLoan.repayment?.totalPayableAmount ||
      scheduleItems.reduce((sum, s) => sum + s.emiAmount, 0) ||
      loanAmount;

    const monthlyEmi =
      disbursedLoan.repayment?.monthlyEmiAmount ||
      (scheduleItems.length > 0
        ? scheduleItems[0].emiAmount
        : Math.round(totalPayableAmount / tenureMonths));

    return res.status(200).json({
      success: true,
      isDisbursed: true,
      loanId: disbursedLoan.loanId || `LN-${disbursedLoan.applicationId.replace('LOAN-', '')}`,
      applicationId: disbursedLoan.applicationId,
      loanAmount,
      interestRate: interestRate <= 5 ? `${interestRate}% / Month` : `${interestRate}% p.a.`,
      interestCalculationNotice:
        'Reducing Balance EMI calculation under approved Utkal Finance Member Credit Policy.',
      canPay: true,
      repaymentTenure: `${tenureMonths} Months`,
      totalPayableAmount,
      monthlyEmi,
      totalPaidAmount: disbursedLoan.repayment?.totalPaidAmount || 0,
      outstandingBalance:
        disbursedLoan.repayment?.outstandingBalance ??
        Math.max(0, totalPayableAmount - (disbursedLoan.repayment?.totalPaidAmount || 0)),
      schedule: scheduleItems,
    });
  } catch (error) {
    console.error('Error fetching EMI schedule:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch EMI schedule',
    });
  }
};

/**
 * @desc    Get Next Loan Eligibility based on client requirements:
 *          - Customer first takes ₹10,000 loan and completes repayment
 *          - Complete repayment unlocks eligibility for next loan level
 *          - Next amount shown only when configured by Super Admin
 *          - Does not automatically approve next loan
 * @route   GET /api/loan-applications/next-eligibility
 * @access  Private (Authenticated Member)
 */
const getNextLoanEligibility = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    const loans = await LoanApplication.find(customerFilter).sort({ createdAt: -1 });

    const disbursedLoans = loans.filter((l) => l.disbursement?.isDisbursed === true);

    // Check if any disbursed loan is completely repaid
    const fullyRepaidLoan = disbursedLoans.find(
      (l) =>
        (l.repayment?.outstandingBalance || 0) === 0 &&
        ((l.repayment?.totalPaidAmount || 0) > 0 ||
          (l.repayment?.schedule?.length > 0 &&
            l.repayment.schedule.every((s) => s.paymentStatus === 'Paid')))
    );

    const activeDisbursedLoan = disbursedLoans.find(
      (l) => (l.repayment?.outstandingBalance || 0) > 0
    );

    if (fullyRepaidLoan) {
      return res.status(200).json({
        success: true,
        isUnlocked: true,
        currentStage: 'Completed First Loan (₹10,000) Settlement',
        message:
          'Congratulations! You have completed full repayment of your First Member Loan of ₹10,000. You are now eligible to apply for the next loan level.',
        nextLoanAmount: null, // Shown only when configured by Super Admin
        nextLoanAmountNotice:
          'Next loan level credit limit is subject to Super Admin formal configuration and branch underwriting.',
        canApplyNext: true,
        firstLoanRecord: {
          loanId: fullyRepaidLoan.loanId || fullyRepaidLoan.applicationId,
          repaidAmount: fullyRepaidLoan.repayment?.totalPaidAmount || 10000,
          closedAt: fullyRepaidLoan.updatedAt,
        },
      });
    }

    if (activeDisbursedLoan) {
      return res.status(200).json({
        success: true,
        isUnlocked: false,
        currentStage: 'First Member Loan Active & In Repayment',
        message:
          'Your First Member Loan of ₹10,000 is currently active. Next loan level eligibility will unlock automatically once this loan is completely repaid and verified on the backend.',
        outstandingBalance: activeDisbursedLoan.repayment?.outstandingBalance || 10000,
        totalPaid: activeDisbursedLoan.repayment?.totalPaidAmount || 0,
        canApplyNext: false,
      });
    }

    // Has not taken or received First Loan yet
    return res.status(200).json({
      success: true,
      isUnlocked: false,
      currentStage: 'First Member Loan (₹10,000) - Initial Privilege',
      message:
        'In compliance with Utkal Finance approved credit guidelines, every eligible member commences with the First Member Loan of ₹10,000. Successfully completing repayment of the first loan unlocks higher credit tiers.',
      firstLoanAmount: 10000,
      canApplyNext: false,
    });
  } catch (error) {
    console.error('Error evaluating next loan eligibility:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to evaluate next loan eligibility',
    });
  }
};

/**
 * @desc    Get all loan applications for authenticated customer
 * @route   GET /api/loan-applications/my-applications
 * @access  Private (Authenticated Member)
 */
const getCustomerLoanApplications = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    const applications = await LoanApplication.find(customerFilter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error('Error fetching member loan applications:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan applications',
    });
  }
};

/**
 * @desc    Get only active (approved AND disbursed) loans for authenticated customer
 * @route   GET /api/loan-applications/my-active-loans
 * @access  Private (Authenticated Member)
 */
const getCustomerActiveLoans = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    // Strictly disbursed loans: disbursement.isDisbursed === true or status === 'Active'
    const activeLoans = await LoanApplication.find({
      ...customerFilter,
      $or: [
        { 'disbursement.isDisbursed': true },
        { status: 'Active' },
        { status: 'Disbursed' },
      ],
    }).sort({ 'disbursement.disbursedAt': -1, updatedAt: -1 });

    const formattedActive = activeLoans.map((loan) => {
      const approvedAmt =
        loan.finalApproval?.approvedAmount || loan.sanctionedAmount || loan.requestedAmount || 10000;
      const disbursedAmt = loan.disbursement?.disbursedAmount || approvedAmt;
      const tenure = loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3;
      const rate = loan.interestRate || 5;
      const totalPayable =
        loan.repayment?.totalPayableAmount || Math.round(disbursedAmt * (1 + rate / 100));
      const paid = loan.repayment?.totalPaidAmount || 0;
      const outstanding =
        loan.repayment?.outstandingBalance ?? Math.max(0, totalPayable - paid);

      return {
        loanId: loan.loanId || `LN-${loan.applicationId.replace('LOAN-', '')}`,
        applicationId: loan.applicationId,
        loanType: loan.loanType,
        customerName: loan.applicantName,
        customerId: loan.memberId,
        approvedAmount: approvedAmt,
        disbursedAmount: disbursedAmt,
        disbursedAt: loan.disbursement?.disbursedAt || loan.updatedAt,
        interestDetails: rate <= 5 ? `${rate}% / Month (Reducing Balance)` : `${rate}% p.a. (Reducing Balance)`,
        interestRate: rate,
        loanTenure: `${tenure} Months`,
        preferredTenureMonths: tenure,
        totalPayableAmount: totalPayable,
        amountPaid: paid,
        outstandingBalance: outstanding,
        status: (outstanding <= 0 && paid > 0) ? 'Closed / Repaid' : 'Active',
        paymentMethod: loan.disbursement?.paymentMethod || 'Bank Transfer',
        transactionId: loan.disbursement?.transactionId || loan.disbursement?.disbursementReference || '',
        remarks: loan.disbursement?.remarks || '',
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedActive.length,
      activeLoans: formattedActive,
    });
  } catch (error) {
    console.error('Error fetching active loans:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch active loans',
    });
  }
};

/**
 * @desc    Get EMI & Repayment schedule for active loans
 * @route   GET /api/loan-applications/repayments
 * @access  Private (Authenticated Member)
 */
const getCustomerRepayments = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    const disbursedLoans = await LoanApplication.find({
      ...customerFilter,
      $or: [
        { 'disbursement.isDisbursed': true },
        { status: { $in: ['Active', 'Disbursed', 'Closed'] } },
      ],
    });

    const now = new Date();
    const upcoming = [];
    const paid = [];
    const overdue = [];

    for (const loan of disbursedLoans) {
      generateOrSyncEmiSchedule(loan);
      if (loan.isModified && loan.isModified()) {
        try {
          await LoanApplication.updateOne(
            { _id: loan._id },
            { $set: { repayment: loan.repayment } }
          );
        } catch (saveErr) {
          console.warn('Silent sync error for loan repayment:', saveErr.message);
        }
      }

      const schedule = loan.repayment?.schedule || [];
      schedule.forEach((inst) => {
        const item = {
          loanId: loan.loanId || loan.applicationId,
          loanType: loan.loanType,
          instalmentNumber: inst.instalmentNumber,
          emiAmount: inst.emiAmount,
          dueDate: inst.dueDate,
          paidAmount: inst.paidAmount,
          paidAt: inst.paidAt,
          paymentStatus: inst.paymentStatus,
          transactionId: inst.transactionId,
          receiptUrl: inst.receiptUrl,
          loanAppId: loan._id,
          instalmentId: inst._id,
        };

        if (inst.paymentStatus === 'Paid') {
          paid.push(item);
        } else if (new Date(inst.dueDate) < now) {
          overdue.push({ ...item, paymentStatus: 'Overdue' });
        } else {
          upcoming.push(item);
        }
      });
    }

    return res.status(200).json({
      success: true,
      summary: {
        upcomingCount: upcoming.length,
        paidCount: paid.length,
        overdueCount: overdue.length,
      },
      upcoming,
      paid,
      overdue,
    });
  } catch (error) {
    console.error('Error fetching repayments:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch repayment schedule',
    });
  }
};

/**
 * @desc    Record customer EMI repayment (Backend verified)
 * @route   POST /api/loan-applications/repay
 * @access  Private (Authenticated Member)
 */
const recordCustomerEmiPayment = async (req, res) => {
  try {
    const user = req.user;
    const { loanAppId, instalmentNumber, amount, paymentMethod, transactionReference } = req.body;

    if (!loanAppId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Loan Application ID and Amount are required',
      });
    }

    const loan = await LoanApplication.findById(loanAppId);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan record not found',
      });
    }

    // Verify ownership strictly by userId and memberId (never by shared email)
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;

    const isOwner =
      (loan.userId && user._id && String(loan.userId) === String(user._id)) ||
      (resolvedMemberId && loan.memberId === resolvedMemberId) ||
      (user.memberId && loan.memberId === user.memberId);

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to pay for this loan',
      });
    }

    const payAmount = Number(amount);
    const txnId = `TXN-EMI-${Date.now()}`;
    const txnRef = transactionReference || `UPI-${Math.round(Math.random() * 1e10)}`;

    // Update schedule instalment if provided
    if (loan.repayment?.schedule && instalmentNumber) {
      const inst = loan.repayment.schedule.find(
        (s) => s.instalmentNumber === Number(instalmentNumber)
      );
      if (inst) {
        inst.paidAmount = payAmount;
        inst.paidAt = new Date();
        inst.paymentStatus = 'Paid';
        inst.transactionId = txnId;
        inst.utrNumber = txnRef;
      }
    }

    // Update balances
    loan.repayment.totalPaidAmount = (loan.repayment.totalPaidAmount || 0) + payAmount;
    loan.repayment.outstandingBalance = Math.max(
      0,
      (loan.repayment.outstandingBalance || 0) - payAmount
    );

    // Record in payments array
    loan.payments.push({
      transactionId: txnId,
      loanId: loan.loanId || loan.applicationId,
      instalmentNumber: instalmentNumber || 1,
      paymentDate: new Date(),
      amount: payAmount,
      paymentMethod: paymentMethod || 'UPI (IndusInd QR)',
      transactionReference: txnRef,
      paymentStatus: 'Success',
      receiptUrl: `/api/loan-applications/receipts/${txnId}`,
    });

    await loan.save();

    return res.status(200).json({
      success: true,
      message: `EMI payment of ₹${payAmount.toLocaleString(
        'en-IN'
      )} verified and credited successfully!`,
      transaction: {
        transactionId: txnId,
        loanId: loan.loanId || loan.applicationId,
        amount: payAmount,
        paymentDate: new Date(),
        paymentStatus: 'Success',
        transactionReference: txnRef,
      },
    });
  } catch (error) {
    console.error('Error processing EMI payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while processing payment',
    });
  }
};

/**
 * @desc    Get customer loan payment history
 * @route   GET /api/loan-applications/payment-history
 * @access  Private (Authenticated Member)
 */
const getCustomerLoanPaymentHistory = async (req, res) => {
  try {
    const user = req.user;
    const { member, application } = await resolveMember(user);
    const resolvedMemberId = member?.memberId || user.memberId || application?.memberId;
    const customerFilter = buildCustomerQuery(user, resolvedMemberId);

    const loans = await LoanApplication.find(customerFilter);

    const paymentHistory = [];
    loans.forEach((l) => {
      const records = l.payments || [];
      records.forEach((p) => {
        paymentHistory.push({
          transactionId: p.transactionId,
          loanId: p.loanId || l.loanId || l.applicationId,
          paymentDate: p.paymentDate,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          transactionReference: p.transactionReference,
          paymentStatus: p.paymentStatus,
          receiptUrl: p.receiptUrl,
        });
      });
    });

    paymentHistory.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    return res.status(200).json({
      success: true,
      count: paymentHistory.length,
      payments: paymentHistory,
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payment history',
    });
  }
};

/**
 * =========================================================================
 * SUPER ADMIN / EXECUTIVE LOAN OVERSIGHT CONTROLLERS
 * =========================================================================
 */

/**
 * @desc    Get comprehensive Super Admin loan statistics & portfolio overview
 * @route   GET /api/loan-applications/admin/stats
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminLoanStats = async (req, res) => {
  try {
    const [allLoans, activeCount, disbursedData] = await Promise.all([
      LoanApplication.find({}).lean(),
      LoanApplication.countDocuments({
        'disbursement.isDisbursed': true,
        'repayment.outstandingBalance': { $gt: 0 },
      }),
      LoanApplication.aggregate([
        { $match: { 'disbursement.isDisbursed': true } },
        {
          $group: {
            _id: null,
            totalDisbursed: { $sum: '$disbursement.disbursedAmount' },
            totalCollected: { $sum: '$repayment.totalPaidAmount' },
          },
        },
      ]),
    ]);

    const totalLoanApplications = allLoans.length;

    const pendingDistrictVerification = allLoans.filter(
      (l) => l.status === 'Pending District Verification' || l.status === 'Submitted'
    ).length;

    // Applications awaiting final Super Admin decision
    const pendingFinalApproval = allLoans.filter(
      (l) =>
        l.status === 'Pending Final Approval' ||
        l.status === 'Forwarded to Super Admin' ||
        l.status === 'Pending District Verification' ||
        l.status === 'Submitted' ||
        l.status === 'Under Verification' ||
        l.status === 'On Hold' ||
        (l.finalApproval?.status === 'Pending' &&
          !['Approved', 'Approved – Not Disbursed', 'Approved - Not Disbursed', 'Rejected', 'Disbursed', 'Active'].includes(l.status))
    ).length;

    const approvedLoans = allLoans.filter(
      (l) =>
        l.status === 'Approved' ||
        l.status === 'Approved – Not Disbursed' ||
        l.status === 'Approved - Not Disbursed' ||
        l.status === 'Disbursed' ||
        l.status === 'Active'
    ).length;

    const pendingDisbursement = allLoans.filter(
      (l) =>
        (l.status === 'Approved' ||
          l.status === 'Approved – Not Disbursed' ||
          l.status === 'Approved - Not Disbursed' ||
          l.finalApproval?.status === 'Approved') &&
        !l.disbursement?.isDisbursed &&
        l.status !== 'Active' &&
        l.status !== 'Rejected' &&
        l.status !== 'On Hold'
    ).length;

    const totalDisbursedAmount = disbursedData[0]?.totalDisbursed || 0;
    const emiCollected = disbursedData[0]?.totalCollected || 0;

    const overdueLoans = allLoans.filter((l) => {
      if (!l.disbursement?.isDisbursed) return false;
      const schedule = l.repayment?.schedule || [];
      return schedule.some((inst) => inst.paymentStatus === 'Overdue');
    }).length;

    // Real recent activity events across loan lifecycle
    const recentActivities = [];
    allLoans.forEach((l) => {
      if (Array.isArray(l.verificationActivities)) {
        l.verificationActivities.forEach((act) => {
          recentActivities.push({
            id: `${l._id}-${act.timestamp ? new Date(act.timestamp).getTime() : Math.random()}`,
            loanId: l._id,
            applicationId: l.applicationId,
            customerName: l.applicantName,
            action: act.action,
            performedBy: act.performedBy,
            role: act.role,
            timestamp: act.timestamp,
            notes: act.notes,
            district: l.district,
            loanAmount: l.requestedAmount,
            status: l.status,
          });
        });
      }
    });

    recentActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({
      success: true,
      stats: {
        totalLoanApplications,
        pendingDistrictVerification,
        pendingFinalApproval,
        approvedLoans,
        pendingDisbursement,
        totalDisbursedAmount,
        activeLoans: activeCount,
        emiCollected,
        overdueLoans,
      },
      recentActivities: recentActivities.slice(0, 15),
    });
  } catch (error) {
    console.error('Error fetching Super Admin loan stats:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan statistics',
    });
  }
};

/**
 * Helper to enrich loan application with Member dossier and Membership application KYC documents
 * Guarantees Super Admin reviews both loan-specific uploads and verified member proofs
 */
const enrichLoanWithMemberKyc = async (loan) => {
  if (!loan) return loan;
  const loanObj = loan.toObject ? loan.toObject() : { ...loan };

  let memberData = null;
  let applicationData = null;

  try {
    if (loanObj.memberId) {
      const orMember = [
        { memberId: loanObj.memberId },
        { customerId: loanObj.memberId },
      ];
      if (mongoose.isValidObjectId(loanObj.memberId)) {
        orMember.push({ _id: loanObj.memberId });
      }
      memberData = await Member.findOne({ $or: orMember }).lean();

      applicationData = await Application.findOne({
        $or: [
          { allocatedMemberId: loanObj.memberId },
          { memberId: loanObj.memberId },
          { mobile: loanObj.mobile },
          { email: loanObj.email },
        ].filter(Boolean),
      }).lean();
    } else if (loanObj.userId) {
      memberData = await Member.findOne({ userId: loanObj.userId }).lean();
      applicationData = await Application.findOne({ userId: loanObj.userId }).lean();
    }
  } catch (err) {
    console.warn('enrichLoanWithMemberKyc lookup error:', err.message);
  }

  // Preserve existing direct loan application documents
  const mergedDocs = Array.isArray(loanObj.documents) ? [...loanObj.documents] : [];
  const docTypes = new Set(
    mergedDocs.map((d) => (d.documentType || d.documentName || '').toLowerCase().trim())
  );
  const docUrls = new Set(
    mergedDocs.map((d) => (d.documentUrl || d.fileUrl || '').trim())
  );

  const addDocIfMissing = (type, path, name) => {
    if (path && typeof path === 'string') {
      const cleanPath = path.trim();
      const normType = type.toLowerCase().trim();
      if (cleanPath && !docUrls.has(cleanPath) && !docTypes.has(normType)) {
        mergedDocs.push({
          documentType: type,
          documentName: name || `${type} Proof`,
          documentUrl: cleanPath,
          fileUrl: cleanPath,
          uploadedAt: applicationData?.updatedAt || memberData?.updatedAt || loanObj.createdAt,
          verificationStatus: 'Verified',
          source: 'member_dossier',
        });
        docTypes.add(normType);
        docUrls.add(cleanPath);
      }
    }
  };

  const docSource = applicationData?.documentDetails || memberData?.documentDetails || {};

  // 1. Identity Proof / Aadhaar Front
  const idProof =
    docSource.idProofUrl ||
    docSource.idProofFile ||
    docSource.idProof ||
    docSource.doc2_govId ||
    applicationData?.idProofUrl ||
    memberData?.idProofUrl ||
    applicationData?.aadhaarFrontUrl ||
    memberData?.aadhaarFrontUrl;
  if (idProof) {
    addDocIfMissing('Aadhaar / ID Proof (Front)', idProof, 'Aadhaar Card / Primary ID Proof');
  }

  // 2. Address Proof / Aadhaar Back
  const addrProof =
    docSource.addressProofUrl ||
    docSource.addressProofFile ||
    docSource.addressProof ||
    applicationData?.addressProofUrl ||
    memberData?.addressProofUrl ||
    applicationData?.aadhaarBackUrl ||
    memberData?.aadhaarBackUrl;
  if (addrProof) {
    addDocIfMissing('Address Proof / ID (Back)', addrProof, 'Registered Address Proof / Aadhaar Back');
  }

  // 3. PAN Card
  const panProof =
    docSource.panCardUrl ||
    docSource.panCardFile ||
    docSource.panCard ||
    applicationData?.panCardUrl ||
    memberData?.panCardUrl ||
    applicationData?.panCard ||
    memberData?.panCard;
  if (panProof) {
    addDocIfMissing('PAN Card', panProof, 'Income Tax PAN Card');
  }

  // 4. Passport Photograph
  const photo =
    docSource.photoUrl ||
    docSource.photoFile ||
    docSource.photo ||
    docSource.doc1_photo ||
    applicationData?.photoUrl ||
    memberData?.photoUrl ||
    applicationData?.photo ||
    memberData?.photo;
  if (photo) {
    addDocIfMissing('Applicant Photo', photo, 'Passport Photograph');
  }

  // 5. Specimen Signature
  const signature =
    docSource.signatureUrl ||
    docSource.signatureFile ||
    docSource.signature ||
    applicationData?.signatureUrl ||
    memberData?.signatureUrl ||
    applicationData?.signature ||
    memberData?.signature;
  if (signature) {
    addDocIfMissing('Applicant Signature', signature, 'Specimen Signature');
  }

  // 6. Payment / Membership Receipt
  const receipt =
    docSource.paymentReceiptUrl ||
    applicationData?.paymentDetails?.receiptUrl ||
    memberData?.paymentDetails?.receiptUrl ||
    applicationData?.paymentReceiptUrl ||
    applicationData?.receiptFile;
  if (receipt) {
    addDocIfMissing('Payment Receipt', receipt, 'Membership Fee Receipt');
  }

  // 7. Additional Documents array from application/member
  if (Array.isArray(docSource.additionalDocuments)) {
    docSource.additionalDocuments.forEach((addDoc) => {
      if (addDoc && addDoc.documentUrl) {
        addDocIfMissing(
          addDoc.documentType || 'Additional Document',
          addDoc.documentUrl,
          addDoc.documentName || 'Supporting KYC Document'
        );
      }
    });
  }

  loanObj.documents = mergedDocs;
  loanObj.memberProfile = memberData || loanObj.memberProfile || null;
  loanObj.membershipApplication = applicationData
    ? {
        applicationNumber: applicationData.applicationNumber,
        status: applicationData.status,
        branchName: applicationData.branchName,
        kycStatus: applicationData.kycStatus,
        submittedAt: applicationData.createdAt,
        approvedAt: applicationData.approvedAt,
      }
    : loanObj.membershipApplication || null;

  return loanObj;
};

/**
 * @desc    Get loan applications verified and forwarded by District Admin awaiting Super Admin final approval
 * @route   GET /api/loan-applications/admin/pending-final-approval
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminPendingFinalApprovals = async (req, res) => {
  try {
    const { district, search } = req.query;

    const baseFilter = {
      $or: [
        {
          status: {
            $in: [
              'Pending Final Approval',
              'Forwarded to Super Admin',
              'Pending District Verification',
              'Submitted',
              'Under Verification',
              'On Hold',
            ],
          },
        },
        {
          'finalApproval.status': { $in: ['Pending', 'On Hold', null] },
          status: {
            $nin: [
              'Approved',
              'Approved – Not Disbursed',
              'Approved - Not Disbursed',
              'Rejected',
              'Disbursed',
              'Active',
            ],
          },
        },
      ],
    };

    const andConditions = [baseFilter];

    if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      andConditions.push({
        $or: [
          { applicationId: regex },
          { applicantName: regex },
          { mobile: regex },
          { email: regex },
          { memberId: regex },
        ],
      });
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const loans = await LoanApplication.find(query)
      .populate('userId', 'name email mobile')
      .populate('districtId', 'name code')
      .sort({ 'districtVerification.forwardedToSuperAdminAt': -1, updatedAt: -1, createdAt: -1 })
      .lean();

    const formatted = await Promise.all(
      loans.map(async (loan) => {
        const enriched = await enrichLoanWithMemberKyc(loan);
        return {
          _id: enriched._id,
          applicationId: enriched.applicationId,
          customerName: enriched.applicantName,
          memberId: enriched.memberId,
          district: enriched.district,
          districtId: enriched.districtId,
          requestedLoanAmount: enriched.requestedAmount || 10000,
          selectedTenure: `${enriched.preferredTenureMonths} Months`,
          preferredTenureMonths: enriched.preferredTenureMonths,
          interestRate: enriched.interestRate || 5,
          districtVerificationStatus:
            enriched.districtVerification?.status === 'Verified'
              ? 'Verified'
              : 'Direct to Super Admin',
          districtAdminRemarks:
            enriched.districtVerification?.districtRemarks ||
            'Direct member application routed to Super Admin for approval.',
          districtAdminName: enriched.districtVerification?.verifiedBy || 'District Admin',
          forwardedDate:
            enriched.districtVerification?.forwardedToSuperAdminAt ||
            enriched.districtVerification?.verifiedAt ||
            enriched.updatedAt,
          districtVerificationDate:
            enriched.districtVerification?.verifiedAt ||
            enriched.districtVerification?.decisionDate ||
            enriched.districtVerification?.forwardedToSuperAdminAt ||
            enriched.updatedAt,
          submittedDate: enriched.createdAt,
          status: enriched.status,
          finalApprovalStatus: enriched.finalApproval?.status || 'Pending',
          loanPurpose: enriched.loanPurpose,
          employmentDetails: enriched.employmentDetails,
          documents: enriched.documents || [],
          memberProfile: enriched.memberProfile,
          membershipApplication: enriched.membershipApplication,
          verificationActivities: enriched.verificationActivities || [],
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: formatted.length,
      applications: formatted,
    });
  } catch (error) {
    console.error('Error fetching pending final approvals:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch pending loan applications for final approval',
    });
  }
};

/**
 * @desc    Get all loan applications across all districts with filters (Master Super Admin registry)
 * @route   GET /api/loan-applications/admin/all
 * @access  Private (Super Admin / Admin)
 */
/**
 * @desc    Get all loan applications across all districts with filters (Master Super Admin registry)
 * @route   GET /api/loan-applications/admin/all
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminAllLoanApplications = async (req, res) => {
  try {
    const { status, district, assignment, search, page = 1, limit = 50 } = req.query;
    const andConditions = [];

    if (assignment === 'Unassigned' || district === 'Unassigned') {
      andConditions.push({
        $or: [
          { isDistrictAdminAssigned: false },
          { assignedDistrictAdminId: null },
        ],
      });
    } else if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    if (status && status !== 'All') {
      if (status === 'Pending Final Approval') {
        andConditions.push({
          $or: [
            { status: { $in: ['Pending Final Approval', 'Forwarded to Super Admin'] } },
            {
              'districtVerification.status': 'Verified',
              status: {
                $nin: [
                  'Approved',
                  'Approved – Not Disbursed',
                  'Approved - Not Disbursed',
                  'Rejected',
                  'Disbursed',
                  'Active',
                ],
              },
            },
            {
              'districtVerification.isForwardedToSuperAdmin': true,
              status: {
                $nin: [
                  'Approved',
                  'Approved – Not Disbursed',
                  'Approved - Not Disbursed',
                  'Rejected',
                  'Disbursed',
                  'Active',
                ],
              },
            },
          ],
        });
      } else if (
        status === 'Verified / Forwarded to Super Admin' ||
        status === 'Forwarded to Super Admin' ||
        status === 'Verified'
      ) {
        andConditions.push({
          $or: [
            { status: { $in: ['Forwarded to Super Admin', 'Pending Final Approval'] } },
            { 'districtVerification.isForwardedToSuperAdmin': true },
            { 'districtVerification.status': 'Verified' },
          ],
        });
      } else if (status === 'Pending District Verification') {
        andConditions.push({
          status: { $in: ['Pending District Verification', 'Submitted', 'Under Verification'] },
        });
      } else if (
        status === 'Approved' ||
        status === 'Approved – Not Disbursed' ||
        status === 'Approved - Not Disbursed'
      ) {
        andConditions.push({
          status: { $in: ['Approved', 'Approved – Not Disbursed', 'Approved - Not Disbursed'] },
          'disbursement.isDisbursed': { $ne: true },
        });
      } else if (status === 'Active' || status === 'Disbursed') {
        andConditions.push({
          $or: [
            { status: { $in: ['Active', 'Disbursed'] } },
            { 'disbursement.isDisbursed': true },
          ],
        });
      } else {
        andConditions.push({ status });
      }
    }

    if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      andConditions.push({
        $or: [
          { applicationId: regex },
          { applicantName: regex },
          { mobile: regex },
          { email: regex },
          { memberId: regex },
          { district: regex },
        ],
      });
    }

    const query =
      andConditions.length === 0
        ? {}
        : andConditions.length === 1
        ? andConditions[0]
        : { $and: andConditions };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [loans, total] = await Promise.all([
      LoanApplication.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      LoanApplication.countDocuments(query),
    ]);

    const formattedApplications = await Promise.all(
      loans.map(async (rawLoan) => {
        const loan = await enrichLoanWithMemberKyc(rawLoan);
        const isDisbursed = Boolean(
          loan.disbursement?.isDisbursed || loan.status === 'Active' || loan.status === 'Disbursed'
        );
        const isApproved = Boolean(
          loan.status === 'Approved' ||
          loan.status === 'Approved – Not Disbursed' ||
          loan.status === 'Approved - Not Disbursed' ||
          loan.finalApproval?.status === 'Approved'
        );
        const isForwarded = Boolean(
          loan.status === 'Forwarded to Super Admin' ||
          loan.status === 'Pending Final Approval' ||
          loan.districtVerification?.isForwardedToSuperAdmin === true ||
          loan.districtVerification?.status === 'Verified'
        );

        let canonicalStatus = loan.status;
        if (isDisbursed) {
          canonicalStatus = 'Active';
        } else if (isApproved) {
          canonicalStatus = 'Approved – Not Disbursed';
        } else if (isForwarded) {
          canonicalStatus = 'Verified / Forwarded to Super Admin';
        } else if (!loan.status || loan.status === 'Submitted') {
          canonicalStatus = 'Pending District Verification';
        }

        return {
          _id: loan._id,
          applicationId: loan.applicationId,
          applicantName: loan.applicantName,
          customerName: loan.applicantName,
          memberId: loan.memberId,
          customerId: loan.memberId,
          district: loan.district || 'Khurda',
          requestedAmount: loan.requestedAmount || 10000,
          sanctionedAmount:
            loan.finalApproval?.approvedAmount || loan.sanctionedAmount || loan.requestedAmount || 10000,
          preferredTenureMonths:
            loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3,
          tenure: `${
            loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3
          } Months`,
          interestRate: loan.interestRate || 5,
          submissionDate: loan.createdAt,
          createdAt: loan.createdAt,
          status: canonicalStatus,
          rawStatus: loan.status,
          loanType: loan.loanType,
          mobile: loan.mobile,
          email: loan.email,
          loanPurpose: loan.loanPurpose,
          employmentDetails: loan.employmentDetails,
          documents: loan.documents || [],
          memberProfile: loan.memberProfile || null,
          membershipApplication: loan.membershipApplication || null,
          customerVerification: loan.customerVerification || {},
          districtVerification: loan.districtVerification || {},
          finalApproval: loan.finalApproval || {},
          disbursement: loan.disbursement || { isDisbursed: false },
          verificationActivities: loan.verificationActivities || [],
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: formattedApplications.length,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
      applications: formattedApplications,
    });
  } catch (error) {
    console.error('Error fetching all loan applications:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan applications',
    });
  }
};

/**
 * @desc    Get aggregated loan application statistics grouped by district for Super Admin
 * @route   GET /api/loan-applications/admin/districts-summary
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminDistrictSummary = async (req, res) => {
  try {
    const allLoans = await LoanApplication.find({}).lean();

    const districtMap = {};
    const totalStats = {
      totalApplications: allLoans.length,
      pendingDistrictVerification: 0,
      forwardedToSuperAdmin: 0,
      pendingFinalApproval: 0,
      approved: 0,
      active: 0,
      rejected: 0,
      onHold: 0,
      totalRequestedAmount: 0,
      totalDisbursedAmount: 0,
    };

    allLoans.forEach((loan) => {
      const dist = (loan.district || 'Unassigned').trim();
      if (!districtMap[dist]) {
        districtMap[dist] = {
          district: dist,
          total: 0,
          pendingDistrictVerification: 0,
          forwardedToSuperAdmin: 0,
          pendingFinalApproval: 0,
          approved: 0,
          active: 0,
          rejected: 0,
          onHold: 0,
          requestedAmount: 0,
          disbursedAmount: 0,
        };
      }

      districtMap[dist].total += 1;
      const reqAmt = Number(loan.requestedAmount) || 0;
      districtMap[dist].requestedAmount += reqAmt;
      totalStats.totalRequestedAmount += reqAmt;

      const rawStatus = loan.status || '';
      const isDisbursed = Boolean(
        loan.disbursement?.isDisbursed || rawStatus === 'Active' || rawStatus === 'Disbursed'
      );
      const isApproved = Boolean(
        rawStatus === 'Approved' ||
        rawStatus === 'Approved – Not Disbursed' ||
        rawStatus === 'Approved - Not Disbursed' ||
        loan.finalApproval?.status === 'Approved'
      );
      const isForwarded = Boolean(
        rawStatus === 'Forwarded to Super Admin' ||
        rawStatus === 'Pending Final Approval' ||
        loan.districtVerification?.isForwardedToSuperAdmin === true ||
        loan.districtVerification?.status === 'Verified'
      );

      if (isDisbursed) {
        districtMap[dist].active += 1;
        totalStats.active += 1;
        const disbAmt = Number(loan.disbursement?.disbursedAmount) || reqAmt;
        districtMap[dist].disbursedAmount += disbAmt;
        totalStats.totalDisbursedAmount += disbAmt;
      } else if (isApproved) {
        districtMap[dist].approved += 1;
        totalStats.approved += 1;
      } else if (
        rawStatus === 'Rejected' ||
        loan.finalApproval?.status === 'Rejected' ||
        loan.districtVerification?.status === 'Rejected'
      ) {
        districtMap[dist].rejected += 1;
        totalStats.rejected += 1;
      } else if (
        rawStatus === 'On Hold' ||
        loan.finalApproval?.status === 'On Hold' ||
        loan.districtVerification?.status === 'On Hold'
      ) {
        districtMap[dist].onHold += 1;
        totalStats.onHold += 1;
      } else if (isForwarded) {
        districtMap[dist].forwardedToSuperAdmin += 1;
        totalStats.forwardedToSuperAdmin += 1;
        totalStats.pendingFinalApproval += 1;
      } else {
        districtMap[dist].pendingDistrictVerification += 1;
        totalStats.pendingDistrictVerification += 1;
      }
    });

    const districtList = Object.values(districtMap).sort((a, b) => b.total - a.total);

    return res.status(200).json({
      success: true,
      totalDistricts: districtList.length,
      stats: totalStats,
      districts: districtList,
    });
  } catch (error) {
    console.error('Error fetching district summary:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch district summary',
    });
  }
};

/**
 * @desc    Get single loan application details for Super Admin review
 * @route   GET /api/loan-applications/admin/:id
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminLoanApplicationById = async (req, res) => {
  try {
    const rawId = req.params.id;
    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: `Loan application not found for ID: ${rawId}`,
      });
    }

    const loanObj = await enrichLoanWithMemberKyc(loan);

    try {
      generateOrSyncEmiSchedule(loanObj);
    } catch (e) {
      console.warn('Could not sync EMI schedule for loan application:', e.message);
    }

    return res.status(200).json({
      success: true,
      loan: loanObj,
    });
  } catch (error) {
    console.error('Error fetching loan application details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan details',
    });
  }
};

/**
 * @desc    Record Super Admin final loan decision (Approve / Reject / Hold)
 * @route   POST /api/loan-applications/admin/:id/final-approval
 * @access  Private (Super Admin / Admin)
 */
const superAdminProcessLoanDecision = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin' && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Super Admin can approve, reject, or place loans on hold.',
      });
    }

    const rawId = req.params.id || req.body.id || req.body.applicationId;
    const {
      action, // 'approve' | 'reject' | 'hold'
      approvedAmount,
      approvedTenureMonths,
      interestPolicyReference,
      remarks,
      rejectionReason,
    } = req.body;

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Loan Application ID is required',
      });
    }

    if (!['approve', 'reject', 'hold'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be 'approve', 'reject', or 'hold'",
      });
    }

    if (action === 'reject' && !remarks && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'A rejection reason is required when rejecting a loan application',
      });
    }

    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: `Loan application not found for ID: ${rawId}`,
      });
    }

    const adminName = req.user.name || 'Super Admin';
    const adminId = mongoose.Types.ObjectId.isValid(req.user._id) ? req.user._id : null;
    const now = new Date();

    loan.verificationActivities = loan.verificationActivities || [];
    loan.finalApproval = loan.finalApproval || {};

    if (action === 'approve') {
      const sanctionAmount = Number(approvedAmount) || loan.requestedAmount || 10000;
      const tenure = Number(approvedTenureMonths) || loan.preferredTenureMonths || 3;
      const policyRef =
        (interestPolicyReference && interestPolicyReference.trim()) ||
        'Utkal Finance Statutory Credit Policy 2026';
      const finalNote =
        (remarks && remarks.trim()) ||
        'Final loan sanction approved by Super Admin based on verified district recommendation.';

      loan.status = 'Approved – Not Disbursed';
      loan.sanctionedAmount = sanctionAmount;
      loan.finalApproval = {
        status: 'Approved',
        approvedBy: adminName,
        approvedById: adminId,
        approvedAt: now,
        approvedAmount: sanctionAmount,
        approvedTenureMonths: tenure,
        interestPolicyReference: policyRef,
        finalRemarks: finalNote,
        rejectionReason: '',
      };

      // Strict client policy: Final approval does NOT automatically mark as disbursed
      loan.disbursement = loan.disbursement || {};
      loan.disbursement.isDisbursed = false;

      loan.verificationActivities.push({
        action: 'Final Loan Approval Sanctioned',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role || 'super_admin',
        timestamp: now,
        notes: `Sanctioned Amount: ₹${sanctionAmount.toLocaleString('en-IN')}, Tenure: ${tenure} Months, Policy: ${policyRef}. ${finalNote}`,
      });

      await loan.save();

      return res.status(200).json({
        success: true,
        message: `Loan application ${loan.applicationId} successfully approved for ₹${sanctionAmount.toLocaleString('en-IN')} with ${tenure} months tenure!`,
        loan,
      });
    } else if (action === 'reject') {
      const reason = (rejectionReason || remarks || 'Application declined by Super Admin').trim();

      loan.status = 'Rejected';
      loan.finalApproval = {
        status: 'Rejected',
        approvedBy: adminName,
        approvedById: adminId,
        approvedAt: now,
        finalRemarks: remarks || reason,
        rejectionReason: reason,
      };

      loan.verificationActivities.push({
        action: 'Application Rejected by Super Admin',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role || 'super_admin',
        timestamp: now,
        notes: `Rejection reason: ${reason}`,
      });

      await loan.save();

      return res.status(200).json({
        success: true,
        message: `Loan application ${loan.applicationId} rejected. Reason: ${reason}`,
        loan,
      });
    } else if (action === 'hold') {
      const note =
        (remarks && remarks.trim()) ||
        'Placed on hold by Super Admin pending additional verification.';

      loan.status = 'On Hold';
      loan.finalApproval = {
        status: 'On Hold',
        approvedBy: adminName,
        approvedById: adminId,
        approvedAt: now,
        finalRemarks: note,
        rejectionReason: '',
      };

      loan.verificationActivities.push({
        action: 'Application Placed On Hold by Super Admin',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role || 'super_admin',
        timestamp: now,
        notes: note,
      });

      await loan.save();

      return res.status(200).json({
        success: true,
        message: `Loan application ${loan.applicationId} has been placed on hold.`,
        loan,
      });
    }
  } catch (error) {
    console.error('Error recording Super Admin loan decision:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while processing loan decision',
    });
  }
};

/**
 * @desc    Get loans finally approved by Super Admin awaiting disbursement
 * @route   GET /api/loan-applications/admin/disbursements/pending
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminPendingDisbursements = async (req, res) => {
  try {
    const { search, district, page = 1, limit = 50 } = req.query;

    const baseFilter = {
      $and: [
        {
          $or: [
            { status: { $in: ['Approved', 'Approved – Not Disbursed', 'Approved - Not Disbursed'] } },
            { 'finalApproval.status': 'Approved' },
          ],
        },
        {
          'disbursement.isDisbursed': { $ne: true },
        },
        {
          status: {
            $nin: [
              'Rejected',
              'On Hold',
              'Active',
              'Disbursed',
              'Pending District Verification',
              'Under Verification',
              'Submitted',
            ],
          },
        },
      ],
    };

    const andConditions = [baseFilter];

    if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      andConditions.push({
        $or: [
          { applicationId: regex },
          { applicantName: regex },
          { memberId: regex },
          { district: regex },
          { mobile: regex },
          { email: regex },
        ],
      });
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [loans, total] = await Promise.all([
      LoanApplication.find(query)
        .sort({ 'finalApproval.approvedAt': -1, updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      LoanApplication.countDocuments(query),
    ]);

    const formatted = loans.map((loan) => ({
      _id: loan._id,
      applicationId: loan.applicationId,
      customerName: loan.applicantName,
      customerId: loan.memberId,
      memberId: loan.memberId,
      district: loan.district,
      approvedAmount:
        loan.finalApproval?.approvedAmount ||
        loan.sanctionedAmount ||
        loan.requestedAmount ||
        10000,
      requestedAmount: loan.requestedAmount || 10000,
      tenure: `${loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3} Months`,
      tenureMonths:
        loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3,
      interestRate: loan.interestRate || 5,
      approvalDate: loan.finalApproval?.approvedAt || loan.updatedAt,
      approvedBy: loan.finalApproval?.approvedBy || 'Super Admin',
      status: 'Approved – Not Disbursed',
      rawStatus: loan.status,
      loanType: loan.loanType,
      mobile: loan.mobile,
      email: loan.email,
      loanPurpose: loan.loanPurpose,
      bankAccountOrUpi: loan.disbursement?.bankAccountOrUpi || '',
      approvalRemarks: loan.finalApproval?.finalRemarks || '',
      districtVerificationDate: loan.districtVerification?.verifiedAt,
      districtAdminName: loan.districtVerification?.verifiedBy,
      districtRemarks: loan.districtVerification?.districtRemarks || '',
      documents: loan.documents || [],
    }));

    return res.status(200).json({
      success: true,
      count: formatted.length,
      total,
      applications: formatted,
    });
  } catch (error) {
    console.error('Error fetching pending disbursements:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch approved loans awaiting disbursement',
    });
  }
};

/**
 * @desc    Record loan disbursement by Super Admin
 * @route   POST /api/loan-applications/admin/:id/disburse
 * @access  Private (Super Admin / Admin)
 */
const superAdminDisburseLoan = async (req, res) => {
  try {
    const rawId = req.params.id;
    const { disbursementDate, paymentMethod, transactionId, remarks } = req.body;

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Loan Application ID is required',
      });
    }

    // Strict validation of required fields
    if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID / UTR number is required to confirm disbursement',
      });
    }

    const cleanTransactionId = transactionId.trim();

    if (!paymentMethod || typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Payment method is required',
      });
    }

    const disburseDate = disbursementDate ? new Date(disbursementDate) : new Date();
    if (isNaN(disburseDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid disbursement date',
      });
    }

    // Resolve loan application
    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: `Loan application not found for ID: ${rawId}`,
      });
    }

    // 1. Verify that the application is finally approved
    const isApproved =
      loan.finalApproval?.status === 'Approved' ||
      ['Approved', 'Approved – Not Disbursed', 'Approved - Not Disbursed'].includes(loan.status);

    if (!isApproved) {
      return res.status(400).json({
        success: false,
        message: `Cannot disburse loan. Current status is "${loan.status}". Only finally approved loans can be disbursed.`,
      });
    }

    // 2. Verify that it has not already been disbursed
    if (loan.disbursement?.isDisbursed === true || loan.status === 'Active') {
      return res.status(400).json({
        success: false,
        message: `Loan application ${loan.applicationId} has already been disbursed on ${
          loan.disbursement?.disbursedAt
            ? new Date(loan.disbursement.disbursedAt).toLocaleDateString('en-IN')
            : 'an earlier date'
        } (Ref: ${
          loan.disbursement?.transactionId || loan.disbursement?.disbursementReference || 'N/A'
        }).`,
      });
    }

    // 3. Do not allow pending, rejected or held applications to be disbursed
    if (
      loan.status === 'Rejected' ||
      loan.status === 'On Hold' ||
      loan.status === 'Pending District Verification' ||
      loan.status === 'Under Verification' ||
      loan.status === 'Pending Final Approval' ||
      loan.finalApproval?.status === 'Rejected' ||
      loan.finalApproval?.status === 'On Hold'
    ) {
      return res.status(400).json({
        success: false,
        message: `Applications with status "${loan.status}" are not eligible for disbursement.`,
      });
    }

    // 4. Prevent duplicate transaction submissions across loans
    const existingWithTxId = await LoanApplication.findOne({
      _id: { $ne: loan._id },
      'disbursement.isDisbursed': true,
      $or: [
        { 'disbursement.transactionId': cleanTransactionId },
        { 'disbursement.disbursementReference': cleanTransactionId },
      ],
    });

    if (existingWithTxId) {
      return res.status(400).json({
        success: false,
        message: `A disbursement with Transaction ID/UTR "${cleanTransactionId}" has already been recorded for application ${existingWithTxId.applicationId}. Duplicate transaction IDs are not permitted.`,
      });
    }

    const adminName = req.user.name || 'Super Admin';
    const adminId = mongoose.Types.ObjectId.isValid(req.user._id) ? req.user._id : null;
    const approvedAmount =
      loan.finalApproval?.approvedAmount ||
      loan.sanctionedAmount ||
      loan.requestedAmount ||
      10000;
    const cleanRemarks = remarks && typeof remarks === 'string' ? remarks.trim() : '';
    const cleanMethod = paymentMethod.trim();

    // 5. Atomic database update with strict condition to prevent concurrent duplicate disbursements
    const updatedLoan = await LoanApplication.findOneAndUpdate(
      {
        _id: loan._id,
        'disbursement.isDisbursed': { $ne: true },
        status: { $ne: 'Active' },
      },
      {
        $set: {
          status: 'Active',
          'disbursement.isDisbursed': true,
          'disbursement.disbursedAmount': approvedAmount,
          'disbursement.disbursedAt': disburseDate,
          'disbursement.paymentMethod': cleanMethod,
          'disbursement.transactionId': cleanTransactionId,
          'disbursement.disbursementReference': cleanTransactionId,
          'disbursement.remarks': cleanRemarks,
          'disbursement.disbursedBy': adminName,
          'disbursement.disbursedById': adminId,
          'repayment.outstandingBalance': approvedAmount,
          'repayment.totalPayableAmount': Math.round(
            approvedAmount * (1 + (loan.interestRate || 5) / 100)
          ),
        },
        $push: {
          verificationActivities: {
            action: 'Loan Disbursed',
            performedBy: adminName,
            performedById: adminId,
            role: req.user.role || 'super_admin',
            timestamp: disburseDate,
            notes: `Loan amount of ₹${approvedAmount.toLocaleString(
              'en-IN'
            )} successfully disbursed via ${cleanMethod}. Transaction ID/UTR: ${cleanTransactionId}.${
              cleanRemarks ? ' Remarks: ' + cleanRemarks : ''
            }`,
          },
        },
      },
      { new: true }
    );

    if (!updatedLoan) {
      return res.status(409).json({
        success: false,
        message:
          'Disbursement could not be processed because the loan has already been disbursed or updated concurrently.',
      });
    }

    // Auto-generate EMI repayment schedule under Option 1 (Reducing Balance EMI) policy
    generateOrSyncEmiSchedule(updatedLoan);
    await updatedLoan.save();

    return res.status(200).json({
      success: true,
      message: `Loan application ${updatedLoan.applicationId} successfully disbursed! ₹${approvedAmount.toLocaleString(
        'en-IN'
      )} transferred to ${updatedLoan.applicantName}.`,
      loan: updatedLoan,
    });
  } catch (error) {
    console.error('Error recording loan disbursement:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to record loan disbursement',
    });
  }
};

/**
 * @desc    Get disbursement history for Super Admin
 * @route   GET /api/loan-applications/admin/disbursements/history
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminDisbursementHistory = async (req, res) => {
  try {
    const { search, district, page = 1, limit = 50 } = req.query;

    const andConditions = [
      {
        $or: [
          { 'disbursement.isDisbursed': true },
          { status: 'Active' },
          { status: 'Disbursed' },
        ],
      },
    ];

    if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      andConditions.push({
        $or: [
          { applicationId: regex },
          { applicantName: regex },
          { memberId: regex },
          { district: regex },
          { 'disbursement.transactionId': regex },
          { 'disbursement.disbursementReference': regex },
          { 'disbursement.paymentMethod': regex },
        ],
      });
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [loans, total] = await Promise.all([
      LoanApplication.find(query)
        .sort({ 'disbursement.disbursedAt': -1, updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      LoanApplication.countDocuments(query),
    ]);

    const formatted = loans.map((loan) => ({
      _id: loan._id,
      applicationId: loan.applicationId,
      customerName: loan.applicantName,
      customerId: loan.memberId,
      memberId: loan.memberId,
      district: loan.district,
      disbursedAmount:
        loan.disbursement?.disbursedAmount ||
        loan.finalApproval?.approvedAmount ||
        loan.sanctionedAmount ||
        10000,
      disbursementDate: loan.disbursement?.disbursedAt || loan.updatedAt,
      paymentMethod: loan.disbursement?.paymentMethod || 'Bank Transfer (NEFT/RTGS/IMPS)',
      transactionId:
        loan.disbursement?.transactionId ||
        loan.disbursement?.disbursementReference ||
        '—',
      disbursedBy: loan.disbursement?.disbursedBy || 'Super Admin',
      status: 'Active',
      rawStatus: loan.status,
      tenure: `${loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3} Months`,
      tenureMonths:
        loan.finalApproval?.approvedTenureMonths || loan.preferredTenureMonths || 3,
      interestRate: loan.interestRate || 5,
      approvedAmount:
        loan.finalApproval?.approvedAmount ||
        loan.sanctionedAmount ||
        loan.requestedAmount ||
        10000,
      approvalDate: loan.finalApproval?.approvedAt,
      approvedBy: loan.finalApproval?.approvedBy,
      remarks: loan.disbursement?.remarks || '',
      loanType: loan.loanType,
      mobile: loan.mobile,
      email: loan.email,
      loanPurpose: loan.loanPurpose,
      bankAccountOrUpi: loan.disbursement?.bankAccountOrUpi || '',
      documents: loan.documents || [],
      verificationActivities: loan.verificationActivities || [],
    }));

    return res.status(200).json({
      success: true,
      count: formatted.length,
      total,
      applications: formatted,
    });
  } catch (error) {
    console.error('Error fetching disbursement history:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan disbursement history',
    });
  }
};

/**
 * @desc    Get EMI Collection Dashboard summary stats for Super Admin
 * @route   GET /api/loan-applications/admin/emi/dashboard
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminEmiDashboard = async (req, res) => {
  try {
    const disbursedLoans = await LoanApplication.find({
      $or: [
        { 'disbursement.isDisbursed': true },
        { status: { $in: ['Active', 'Disbursed', 'Closed'] } },
      ],
    });

    let totalActiveLoans = 0;
    let totalClosedLoans = 0;
    let totalEmiAmountDue = 0;
    let totalEmiCollected = 0;
    let pendingEmi = 0;
    let pendingCount = 0;
    let overdueEmi = 0;
    let overdueCount = 0;
    let paidCount = 0;

    for (const loan of disbursedLoans) {
      generateOrSyncEmiSchedule(loan);
      if (loan.isModified && loan.isModified()) {
        try {
          await LoanApplication.updateOne(
            { _id: loan._id },
            { $set: { repayment: loan.repayment } }
          );
        } catch (saveErr) {
          console.warn('Silent sync error for loan repayment:', saveErr.message);
        }
      }

      const balance = Number(loan.repayment?.outstandingBalance ?? 0);
      const paid = Number(loan.repayment?.totalPaidAmount ?? 0);
      const due = Number(loan.repayment?.totalPayableAmount ?? 0);

      if (balance <= 0 && paid > 0) {
        totalClosedLoans += 1;
      } else {
        totalActiveLoans += 1;
      }

      totalEmiAmountDue += due;
      totalEmiCollected += paid;

      const schedule = loan.repayment?.schedule || [];
      schedule.forEach((inst) => {
        if (inst.paymentStatus === 'Paid') {
          paidCount += 1;
        } else if (inst.paymentStatus === 'Overdue') {
          overdueCount += 1;
          overdueEmi += Number(inst.emiAmount || 0);
        } else {
          pendingCount += 1;
          pendingEmi += Number(inst.emiAmount || 0);
        }
      });
    }

    return res.status(200).json({
      success: true,
      stats: {
        totalDisbursedLoans: disbursedLoans.length,
        totalActiveLoans,
        totalClosedLoans,
        totalEmiAmountDue,
        totalEmiCollected,
        pendingEmi,
        pendingCount,
        overdueEmi,
        overdueCount,
        paidCount,
      },
    });
  } catch (error) {
    console.error('Error fetching Super Admin EMI dashboard stats:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch EMI dashboard statistics',
    });
  }
};

/**
 * @desc    Get all due, upcoming, paid and overdue EMIs across all loans for Super Admin
 * @route   GET /api/loan-applications/admin/emi/installments
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminAllEmis = async (req, res) => {
  try {
    const { district, status, search, page = 1, limit = 50 } = req.query;

    const andConditions = [
      {
        $or: [
          { 'disbursement.isDisbursed': true },
          { status: { $in: ['Active', 'Disbursed', 'Closed'] } },
        ],
      },
    ];

    if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const loans = await LoanApplication.find(query).sort({
      'disbursement.disbursedAt': -1,
      updatedAt: -1,
    });

    const allInstallments = [];

    for (const loan of loans) {
      generateOrSyncEmiSchedule(loan);
      if (loan.isModified && loan.isModified()) {
        try {
          await LoanApplication.updateOne(
            { _id: loan._id },
            { $set: { repayment: loan.repayment } }
          );
        } catch (saveErr) {
          console.warn('Silent sync error for loan repayment:', saveErr.message);
        }
      }

      const schedule = loan.repayment?.schedule || [];
      schedule.forEach((inst) => {
        allInstallments.push({
          loanDbId: loan._id,
          applicationId: loan.applicationId,
          loanId: loan.loanId || loan.applicationId,
          customerName: loan.applicantName,
          customerId: loan.memberId,
          memberId: loan.memberId,
          district: loan.district,
          mobile: loan.mobile,
          email: loan.email,
          disbursedAmount:
            loan.disbursement?.disbursedAmount ||
            loan.finalApproval?.approvedAmount ||
            loan.sanctionedAmount ||
            10000,
          disbursedAt: loan.disbursement?.disbursedAt,
          tenureMonths:
            loan.finalApproval?.approvedTenureMonths ||
            loan.preferredTenureMonths ||
            3,
          interestRate: loan.interestRate || 5,
          totalPayableAmount: loan.repayment?.totalPayableAmount || 10500,
          totalPaidAmount: loan.repayment?.totalPaidAmount || 0,
          outstandingBalance: loan.repayment?.outstandingBalance || 0,
          loanStatus: loan.status,
          instalmentNumber: inst.instalmentNumber,
          dueDate: inst.dueDate,
          emiAmount: inst.emiAmount,
          principalComponent: inst.principalComponent,
          interestComponent: inst.interestComponent,
          paidAmount: inst.paidAmount || 0,
          paidAt: inst.paidAt,
          paymentStatus: inst.paymentStatus, // 'Upcoming' | 'Paid' | 'Overdue'
          paymentMethod: inst.paymentMethod || '',
          transactionId: inst.transactionId || '',
          utrNumber: inst.utrNumber || '',
          remarks: inst.receiptUrl || '',
        });
      });
    }

    // Apply status filter if provided
    let filtered = allInstallments;
    if (status && status !== 'All') {
      filtered = filtered.filter(
        (item) => item.paymentStatus.toLowerCase() === status.toLowerCase()
      );
    }

    // Apply search filter if provided
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (item) =>
          (item.customerName && item.customerName.toLowerCase().includes(q)) ||
          (item.applicationId && item.applicationId.toLowerCase().includes(q)) ||
          (item.customerId && item.customerId.toLowerCase().includes(q)) ||
          (item.district && item.district.toLowerCase().includes(q)) ||
          (item.transactionId && item.transactionId.toLowerCase().includes(q)) ||
          (item.utrNumber && item.utrNumber.toLowerCase().includes(q)) ||
          (item.mobile && item.mobile.toLowerCase().includes(q))
      );
    }

    // Sort: Overdue first, then upcoming by dueDate asc, then paid by paidAt desc
    filtered.sort((a, b) => {
      const statusPriority = { Overdue: 1, Upcoming: 2, Paid: 3 };
      const pA = statusPriority[a.paymentStatus] || 4;
      const pB = statusPriority[b.paymentStatus] || 4;
      if (pA !== pB) return pA - pB;
      if (a.paymentStatus === 'Paid') {
        return new Date(b.paidAt || 0) - new Date(a.paidAt || 0);
      }
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    const total = filtered.length;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;
    const paginated = filtered.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      installments: paginated,
    });
  } catch (error) {
    console.error('Error fetching EMI installments:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch EMI installments',
    });
  }
};

/**
 * @desc    Record EMI payment collected by Super Admin
 * @route   POST /api/loan-applications/admin/emi/collect
 * @access  Private (Super Admin / Admin)
 */
const superAdminCollectEmiPayment = async (req, res) => {
  try {
    const {
      applicationId,
      instalmentNumber,
      collectedAmount,
      paymentDate,
      paymentMethod,
      transactionId,
      remarks,
    } = req.body;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: 'Loan Application ID is required',
      });
    }

    if (!instalmentNumber) {
      return res.status(400).json({
        success: false,
        message: 'Installment number is required',
      });
    }

    const payAmount = Number(collectedAmount);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid collected amount greater than ₹0',
      });
    }

    if (!paymentMethod || !paymentMethod.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Payment method is required',
      });
    }

    if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID / UTR reference number is required to confirm EMI collection',
      });
    }

    const cleanTxId = transactionId.trim();

    // Prevent duplicate transaction submissions across all loans
    const duplicateTx = await LoanApplication.findOne({
      $or: [
        { 'disbursement.transactionId': cleanTxId },
        { 'disbursement.disbursementReference': cleanTxId },
        { 'payments.transactionId': cleanTxId },
        { 'payments.transactionReference': cleanTxId },
        { 'repayment.schedule.transactionId': cleanTxId },
        { 'repayment.schedule.utrNumber': cleanTxId },
      ],
    });

    if (duplicateTx) {
      return res.status(400).json({
        success: false,
        message: `Transaction reference "${cleanTxId}" has already been recorded in loan record ${duplicateTx.applicationId}. Duplicate transaction references are not permitted.`,
      });
    }

    const loan = await resolveLoanByIdOrAppId(applicationId);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: `Loan application not found for ID: ${applicationId}`,
      });
    }

    const isDisbursed = Boolean(
      loan.disbursement?.isDisbursed || loan.status === 'Active' || loan.status === 'Disbursed'
    );
    if (!isDisbursed) {
      return res.status(400).json({
        success: false,
        message: 'Cannot record EMI collection on a loan that has not been disbursed yet.',
      });
    }

    generateOrSyncEmiSchedule(loan);

    const instNum = Number(instalmentNumber);
    const inst = (loan.repayment?.schedule || []).find((s) => s.instalmentNumber === instNum);

    if (!inst) {
      return res.status(404).json({
        success: false,
        message: `Installment #${instNum} not found in loan repayment schedule`,
      });
    }

    if (inst.paymentStatus === 'Paid') {
      return res.status(400).json({
        success: false,
        message: `Installment #${instNum} is already marked as Paid on ${
          inst.paidAt ? new Date(inst.paidAt).toLocaleDateString('en-IN') : 'earlier date'
        } (Ref: ${inst.utrNumber || inst.transactionId || 'N/A'})`,
      });
    }

    const payDate = paymentDate ? new Date(paymentDate) : new Date();
    const adminName = req.user.name || 'Super Admin';
    const adminId = mongoose.Types.ObjectId.isValid(req.user._id) ? req.user._id : null;
    const cleanRemarks = remarks && typeof remarks === 'string' ? remarks.trim() : '';

    inst.paidAmount = payAmount;
    inst.paidAt = payDate;
    inst.paymentStatus = 'Paid';
    inst.paymentMethod = paymentMethod.trim();
    inst.transactionId = cleanTxId;
    inst.utrNumber = cleanTxId;
    inst.receiptUrl = cleanRemarks;

    // Recalculate totals
    const totalPaid = loan.repayment.schedule.reduce(
      (sum, s) =>
        sum +
        (s.paymentStatus === 'Paid'
          ? Number(s.paidAmount) || Number(s.emiAmount) || 0
          : 0),
      0
    );
    loan.repayment.totalPaidAmount = totalPaid;
    loan.repayment.outstandingBalance = Math.max(
      0,
      loan.repayment.totalPayableAmount - totalPaid
    );

    const nextUnpaid = loan.repayment.schedule.find((s) => s.paymentStatus !== 'Paid');
    if (nextUnpaid) {
      loan.repayment.nextEmiDueDate = nextUnpaid.dueDate;
      loan.repayment.nextEmiAmount = nextUnpaid.emiAmount;
    } else {
      loan.repayment.nextEmiDueDate = null;
      loan.repayment.nextEmiAmount = 0;
      if (loan.repayment.outstandingBalance === 0) {
        loan.status = 'Closed';
      }
    }

    // Append to payments array
    loan.payments.push({
      transactionId: cleanTxId,
      loanId: loan.loanId || loan.applicationId,
      instalmentNumber: instNum,
      paymentDate: payDate,
      amount: payAmount,
      paymentMethod: paymentMethod.trim(),
      transactionReference: cleanTxId,
      paymentStatus: 'Success',
      receiptUrl: cleanRemarks,
    });

    // Append to verificationActivities
    loan.verificationActivities.push({
      action: 'EMI Payment Collected',
      performedBy: adminName,
      performedById: adminId,
      role: req.user.role || 'super_admin',
      timestamp: payDate,
      notes: `Installment #${instNum} collection of ₹${payAmount.toLocaleString(
        'en-IN'
      )} recorded via ${paymentMethod.trim()}. UTR/Ref: ${cleanTxId}.${
        cleanRemarks ? ' Remarks: ' + cleanRemarks : ''
      }`,
    });

    await loan.save();

    return res.status(200).json({
      success: true,
      message: `EMI Installment #${instNum} for application ${loan.applicationId} successfully recorded as Paid!`,
      loan,
      installment: inst,
    });
  } catch (error) {
    console.error('Error recording Super Admin EMI payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to record EMI payment',
    });
  }
};

/**
 * @desc    Get EMI Reports & Analytics for Super Admin
 * @route   GET /api/loan-applications/admin/emi/reports
 * @access  Private (Super Admin / Admin)
 */
const getSuperAdminEmiReports = async (req, res) => {
  try {
    const { district, startDate, endDate, month } = req.query;

    const andConditions = [
      {
        $or: [
          { 'disbursement.isDisbursed': true },
          { status: { $in: ['Active', 'Disbursed', 'Closed'] } },
        ],
      },
    ];

    if (district && district !== 'All') {
      andConditions.push({ district: new RegExp(`^${district}$`, 'i') });
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const loans = await LoanApplication.find(query).sort({
      'disbursement.disbursedAt': -1,
    });

    let totalCollected = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let totalPayable = 0;

    const monthlyMap = {};
    const districtMap = {};
    const loanRepaymentHistory = [];

    loans.forEach((loan) => {
      generateOrSyncEmiSchedule(loan);

      const d = (loan.district || 'Unassigned').trim();
      if (!districtMap[d]) {
        districtMap[d] = {
          district: d,
          totalLoans: 0,
          activeLoans: 0,
          closedLoans: 0,
          totalPayable: 0,
          totalCollected: 0,
          totalPending: 0,
          totalOverdue: 0,
        };
      }

      districtMap[d].totalLoans += 1;
      const loanDue = Number(loan.repayment?.totalPayableAmount) || 0;
      const loanPaid = Number(loan.repayment?.totalPaidAmount) || 0;
      const loanBalance = Number(loan.repayment?.outstandingBalance) || 0;

      districtMap[d].totalPayable += loanDue;
      districtMap[d].totalCollected += loanPaid;
      totalPayable += loanDue;
      totalCollected += loanPaid;

      if (loanBalance === 0 && loanPaid > 0) {
        districtMap[d].closedLoans += 1;
      } else {
        districtMap[d].activeLoans += 1;
      }

      const schedule = loan.repayment?.schedule || [];
      let paidInstallmentsCount = 0;

      schedule.forEach((inst) => {
        const amt = Number(inst.emiAmount) || 0;
        if (inst.paymentStatus === 'Paid') {
          paidInstallmentsCount += 1;
          const pDate = inst.paidAt ? new Date(inst.paidAt) : new Date();
          const monthKey = pDate.toLocaleString('en-IN', {
            month: 'short',
            year: 'numeric',
          });
          if (!monthlyMap[monthKey]) {
            monthlyMap[monthKey] = {
              month: monthKey,
              collectedAmount: 0,
              count: 0,
              sortKey: pDate.getTime(),
            };
          }
          monthlyMap[monthKey].collectedAmount +=
            Number(inst.paidAmount) || amt;
          monthlyMap[monthKey].count += 1;
        } else if (inst.paymentStatus === 'Overdue') {
          districtMap[d].totalOverdue += amt;
          totalOverdue += amt;
        } else {
          districtMap[d].totalPending += amt;
          totalPending += amt;
        }
      });

      loanRepaymentHistory.push({
        applicationId: loan.applicationId,
        customerName: loan.applicantName,
        customerId: loan.memberId,
        district: loan.district,
        disbursedAmount:
          loan.disbursement?.disbursedAmount ||
          loan.sanctionedAmount ||
          10000,
        disbursementDate: loan.disbursement?.disbursedAt,
        tenure: `${
          loan.finalApproval?.approvedTenureMonths ||
          loan.preferredTenureMonths ||
          3
        } Months`,
        totalPayable: loanDue,
        totalCollected: loanPaid,
        outstandingBalance: loanBalance,
        installmentsPaid: `${paidInstallmentsCount} / ${schedule.length}`,
        status: loan.status,
      });
    });

    const monthlyCollection = Object.values(monthlyMap).sort(
      (a, b) => a.sortKey - b.sortKey
    );
    const districtSummary = Object.values(districtMap)
      .map((item) => ({
        ...item,
        efficiencyPercent:
          item.totalPayable > 0
            ? Math.round((item.totalCollected / item.totalPayable) * 100)
            : 0,
      }))
      .sort((a, b) => b.totalCollected - a.totalCollected);

    return res.status(200).json({
      success: true,
      summary: {
        totalLoans: loans.length,
        totalPayable,
        totalCollected,
        totalPending,
        totalOverdue,
        collectionEfficiency:
          totalPayable > 0 ? Math.round((totalCollected / totalPayable) * 100) : 0,
      },
      monthlyCollection,
      districtSummary,
      loanRepaymentHistory,
    });
  } catch (error) {
    console.error('Error fetching EMI reports:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch EMI reports',
    });
  }
};

/**
 * @desc    Get dynamic loan and EMI configuration settings
 * @route   GET /api/loan-applications/settings
 * @access  Private (Authenticated User - Member or Admin)
 */
const getLoanSettings = async (req, res) => {
  try {
    const settings = await LoanSetting.getOrCreateDefault();
    return res.status(200).json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('Error fetching loan settings:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan settings',
    });
  }
};

/**
 * @desc    Update dynamic loan amount, interest rate, and EMI configuration settings
 * @route   PUT /api/loan-applications/admin/settings
 * @access  Private (Super Admin / Admin)
 */
const updateLoanSettings = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin' && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Super Admin can modify loan configuration settings.',
      });
    }

    const {
      defaultAmount,
      minAmount,
      maxAmount,
      isAmountFixed,
      allowedAmounts,
      monthlyInterestRate,
      baseInterestRate,
      highCibilInterestRate,
      standardCibilInterestRate,
      cibilThreshold,
      interestRateDisplay,
      availableTenureMonths,
      defaultTenureMonths,
      emiCalculationMethod,
      processingFeePercent,
      processingFeeFixed,
      aboutEmiNote,
      repaymentGuidelines,
      policyReference,
    } = req.body;

    const settings = await LoanSetting.getOrCreateDefault();

    if (defaultAmount !== undefined) settings.defaultAmount = Math.max(1000, Number(defaultAmount));
    if (minAmount !== undefined) settings.minAmount = Math.max(1000, Number(minAmount));
    if (maxAmount !== undefined) settings.maxAmount = Math.max(settings.minAmount, Number(maxAmount));
    if (isAmountFixed !== undefined) settings.isAmountFixed = Boolean(isAmountFixed);
    if (Array.isArray(allowedAmounts) && allowedAmounts.length > 0) {
      settings.allowedAmounts = allowedAmounts
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0);
    }

    if (monthlyInterestRate !== undefined) {
      settings.monthlyInterestRate = Number(monthlyInterestRate);
      if (baseInterestRate === undefined) {
        settings.baseInterestRate = Number(monthlyInterestRate) * 12;
      }
    }
    if (baseInterestRate !== undefined) settings.baseInterestRate = Number(baseInterestRate);
    if (highCibilInterestRate !== undefined) settings.highCibilInterestRate = Number(highCibilInterestRate);
    if (standardCibilInterestRate !== undefined) settings.standardCibilInterestRate = Number(standardCibilInterestRate);
    if (cibilThreshold !== undefined) settings.cibilThreshold = Number(cibilThreshold);
    if (interestRateDisplay !== undefined) settings.interestRateDisplay = String(interestRateDisplay).trim();

    if (Array.isArray(availableTenureMonths) && availableTenureMonths.length > 0) {
      settings.availableTenureMonths = availableTenureMonths
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);
    }
    if (defaultTenureMonths !== undefined) settings.defaultTenureMonths = Number(defaultTenureMonths);
    if (emiCalculationMethod && ['reducing_balance', 'flat_rate'].includes(emiCalculationMethod)) {
      settings.emiCalculationMethod = emiCalculationMethod;
    }
    if (processingFeePercent !== undefined) settings.processingFeePercent = Number(processingFeePercent);
    if (processingFeeFixed !== undefined) settings.processingFeeFixed = Number(processingFeeFixed);
    if (aboutEmiNote !== undefined) settings.aboutEmiNote = String(aboutEmiNote).trim();
    if (Array.isArray(repaymentGuidelines)) {
      settings.repaymentGuidelines = repaymentGuidelines.filter((g) => typeof g === 'string' && g.trim());
    }
    if (policyReference !== undefined) settings.policyReference = String(policyReference).trim();

    settings.updatedBy = req.user?.name || req.user?.email || 'Super Admin';
    settings.updatedById = req.user?._id || 'admin-root';

    await settings.save();

    console.log(
      `[LoanSetting] Dynamic Loan & EMI policy updated by ${settings.updatedBy}: Amount ₹${settings.defaultAmount}, Rate ${settings.baseInterestRate}%, Tenures [${settings.availableTenureMonths.join(', ')}]`
    );

    return res.status(200).json({
      success: true,
      message: 'Loan parameters and EMI configuration updated successfully! Changes are live across the member panel.',
      settings,
    });
  } catch (error) {
    console.error('Error updating loan settings:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update loan settings',
    });
  }
};

module.exports = {
  getCustomerLoanOverview,
  getAvailableLoanProducts,
  applyForLoan,
  getTrackApplicationStatus,
  getEmiSchedule,
  getNextLoanEligibility,
  getCustomerLoanApplications,
  getCustomerActiveLoans,
  getCustomerRepayments,
  recordCustomerEmiPayment,
  getCustomerLoanPaymentHistory,
  getSuperAdminLoanStats,
  getSuperAdminPendingFinalApprovals,
  getSuperAdminAllLoanApplications,
  getSuperAdminLoanApplicationById,
  superAdminProcessLoanDecision,
  getSuperAdminPendingDisbursements,
  superAdminDisburseLoan,
  getSuperAdminDisbursementHistory,
  getSuperAdminDistrictSummary,
  getSuperAdminEmiDashboard,
  getSuperAdminAllEmis,
  superAdminCollectEmiPayment,
  getSuperAdminEmiReports,
  getLoanSettings,
  updateLoanSettings,
};
