const mongoose = require('mongoose');

const investorSchema = new mongoose.Schema(
  {
    investorId: {
      type: String,
      required: [true, 'Investor ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    // Personal Information
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    dateOfBirth: {
      type: Date,
    },
    address: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      default: 'Odisha',
      trim: true,
    },
    district: {
      type: String,
      required: [true, 'District is required'],
      trim: true,
      index: true,
    },
    pinCode: {
      type: String,
      trim: true,
    },

    // KYC Information
    aadhaarNumber: {
      type: String,
      trim: true,
    },
    aadhaarFrontUrl: {
      type: String,
      trim: true,
    },
    aadhaarBackUrl: {
      type: String,
      trim: true,
    },
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    panCardUrl: {
      type: String,
      trim: true,
    },
    bankDetails: {
      accountNumber: { type: String, trim: true },
      accountHolderName: { type: String, trim: true },
      bankName: { type: String, trim: true },
      ifscCode: { type: String, trim: true, uppercase: true },
      branchName: { type: String, trim: true },
    },
    kycStatus: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected', 'Correction Required'],
      default: 'Pending',
      index: true,
    },
    kycVerifiedAt: {
      type: Date,
    },
    kycVerifiedBy: {
      type: String,
      default: '',
    },
    kycRejectionReason: {
      type: String,
      default: '',
    },
    correctionInstructions: {
      type: String,
      default: '',
      trim: true,
    },
    correctionRequestedAt: {
      type: Date,
    },
    correctionRequestedBy: {
      type: String,
      default: '',
    },

    // Investment Profile & Approved Return Terms
    investmentType: {
      type: String,
      default: 'Term Capital',
      trim: true,
    },
    agreedReturnTerms: {
      type: String,
      default: 'As per Approved Agreement',
      trim: true,
    },
    investmentDate: {
      type: Date,
      default: Date.now,
    },
    maturityDate: {
      type: Date,
    },

    // Payment Summary & Status
    totalInvestment: {
      type: Number,
      default: 0,
      min: 0,
    },
    verifiedInvestment: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected', 'None'],
      default: 'Pending',
      index: true,
    },

    // Active Approved Investment Plan Assignment
    assignedPlan: {
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InvestmentPlan',
      },
      planCode: { type: String, default: '' },
      planName: { type: String, default: '' },
      version: { type: String, default: '1.0' },
      multiplier: { type: Number, default: 2 },
      contractualPercentage: { type: Number, default: 100 },
      percentageBasis: {
        type: String,
        enum: ['Monthly', 'Annual', 'Total Contractual Percentage', 'None'],
        default: 'Total Contractual Percentage',
      },
      durationMonths: { type: Number, default: 12 },
      terms: { type: String, default: '' },
      assignedAt: { type: Date, default: Date.now },
      assignedDate: { type: Date, default: Date.now },
      assignedBy: { type: String, default: '' },
      status: {
        type: String,
        enum: ['None', 'Draft', 'Pending', 'Active', 'Completed', 'Terminated'],
        default: 'None',
        index: true,
      },
      maturityDate: { type: Date },
      contractualTarget: { type: Number, default: 0 },
      contractualLiability: { type: Number, default: 0 },
      agreementStatus: {
        type: String,
        enum: ['Draft', 'Signed', 'Approved', 'Executed'],
        default: 'Draft',
      },
      agreementUrl: { type: String, default: '' },
      planActivationStatus: {
        type: String,
        enum: ['Pending', 'Active'],
        default: 'Pending',
      },
      notes: { type: String, default: '' },
    },

    // Dedicated 2X Contract Ledger Tracking Record
    tracking2x: {
      originalInvestment: { type: Number, default: 0 },
      multiplier: { type: Number, default: 2 },
      contractualPercentage: { type: Number, default: 0 },
      percentageBasis: {
        type: String,
        enum: ['Monthly', 'Annual', 'Total Contractual Percentage', 'None'],
        default: 'Total Contractual Percentage',
      },
      targetAmount: { type: Number, default: 0 },
      durationMonths: { type: Number, default: 12 },
      startDate: { type: Date },
      maturityDate: { type: Date },
      totalEligiblePayouts: { type: Number, default: 0 },
      remainingPayout: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ['None', 'Pending', 'Draft', 'Active', 'Matured', 'Completed', 'Suspended'],
        default: 'None',
      },
      activatedAt: { type: Date },
      activatedBy: { type: String, default: '' },
      lastAuditedAt: { type: Date },
    },

    // Plan Assignment History (audit trail of plans)
    planHistory: [
      {
        planCode: String,
        planName: String,
        version: String,
        durationMonths: Number,
        assignedAt: Date,
        assignedBy: String,
        terms: String,
        status: String,
      },
    ],

    // Investment Agreement
    agreement: {
      agreementNumber: { type: String, default: '' },
      status: {
        type: String,
        enum: ['None', 'Draft', 'Generated', 'Executed', 'Pending'],
        default: 'None',
      },
      agreementUrl: { type: String, default: '' },
      generatedAt: { type: Date },
      executedAt: { type: Date },
      notes: { type: String, default: '' },
    },

    // Email Dispatch Audit Logs (Legacy backwards compatibility)
    emailLogs: [
      {
        emailType: {
          type: String,
          enum: ['RegistrationAcknowledgement', 'InvestmentConfirmation', 'PlanAssignment', 'KycStatus', 'Agreement', 'MaturityReminder', 'Payout', 'Refund', 'Other'],
        },
        sentAt: { type: Date, default: Date.now },
        recipient: String,
        status: { type: String, enum: ['Sent', 'Failed'], default: 'Sent' },
        messageId: String,
        details: String,
      },
    ],

    // Centralized Communication & Notification Audit Trail (Email & SMS)
    communicationLogs: [
      {
        channel: {
          type: String,
          enum: ['Email', 'SMS'],
          required: true,
          default: 'Email',
        },
        category: {
          type: String,
          enum: [
            'Registration',
            'KycStatus',
            'PaymentConfirmation',
            'PlanActivation',
            'Agreement',
            'MaturityReminder',
            'Payout',
            'Refund',
            'General',
          ],
          default: 'General',
        },
        recipient: {
          type: String,
          required: true,
        },
        subject: {
          type: String,
          default: '',
        },
        messageSummary: {
          type: String,
          default: '',
        },
        status: {
          type: String,
          enum: ['Sent', 'Failed', 'Not Configured'],
          default: 'Sent',
        },
        provider: {
          type: String,
          default: '',
        },
        messageId: {
          type: String,
          default: '',
        },
        errorMessage: {
          type: String,
          default: '',
        },
        sentAt: {
          type: Date,
          default: Date.now,
        },
        sentBy: {
          type: String,
          default: 'Super Admin',
        },
      },
    ],

    // Account Status & Two-Tier Approval Lifecycle
    status: {
      type: String,
      enum: ['Active', 'Pending', 'Suspended'],
      default: 'Active',
      index: true,
    },
    approvalStage: {
      type: String,
      enum: [
        'pending_associate',
        'approved_by_associate',
        'approved_by_admin',
        'rejected_by_associate',
        'rejected_by_admin',
      ],
      default: 'approved_by_admin',
      index: true,
    },
    associateApproval: {
      status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending',
      },
      approvedAt: { type: Date },
      approvedBy: { type: String, default: '' },
      remarks: { type: String, default: '' },
    },
    adminApproval: {
      status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending',
      },
      approvedAt: { type: Date },
      approvedBy: { type: String, default: '' },
      remarks: { type: String, default: '' },
    },
    sourcedBy: {
      associateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
      },
      associateName: { type: String, default: '' },
      associateMobile: { type: String, default: '' },
      associateEmail: { type: String, default: '' },
      associateMemberId: { type: String, default: '' },
    },
    createdBy: {
      type: String,
      default: 'Super Admin',
    },
    adminRemarks: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for masked Aadhaar: e.g. "•••• •••• 1234"
investorSchema.virtual('maskedAadhaar').get(function () {
  if (!this.aadhaarNumber) return '';
  const clean = this.aadhaarNumber.replace(/\D/g, '');
  if (clean.length < 4) return clean;
  const last4 = clean.slice(-4);
  return `•••• •••• ${last4}`;
});

// Virtual for masked PAN: e.g. "•••••1234•"
investorSchema.virtual('maskedPan').get(function () {
  if (!this.panNumber) return '';
  const clean = this.panNumber.trim().toUpperCase();
  if (clean.length < 5) return clean;
  return `•••••${clean.slice(5, 9)}${clean.slice(9) || '•'}`;
});

// Virtual for masked Bank Account: e.g. "•••• •••• 5678"
investorSchema.virtual('maskedBankAccount').get(function () {
  const acct = this.bankDetails?.accountNumber;
  if (!acct) return '';
  const clean = acct.trim();
  if (clean.length <= 4) return clean;
  return `•••• •••• ${clean.slice(-4)}`;
});

investorSchema.set('toJSON', { virtuals: true });
investorSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Investor', investorSchema);

