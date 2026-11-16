const mongoose = require('mongoose');

const investmentRecordSchema = new mongoose.Schema(
  {
    investmentId: {
      type: String,
      required: [true, 'Investment Reference ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    investor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investor',
      required: [true, 'Investor reference is required'],
      index: true,
    },
    investorId: {
      type: String,
      required: [true, 'Investor ID is required'],
      trim: true,
      uppercase: true,
      index: true,
    },
    investorName: {
      type: String,
      required: [true, 'Investor name is required'],
      trim: true,
    },

    // Investment Financial Details
    amount: {
      type: Number,
      required: [true, 'Investment amount is required'],
      min: [1, 'Amount must be at least ₹1'],
    },
    investmentDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ['UPI', 'Bank Transfer', 'NEFT/RTGS', 'Cheque', 'Cash', 'Other'],
      default: 'UPI',
      trim: true,
    },
    utrNumber: {
      type: String,
      required: [true, 'Transaction reference / UTR is required'],
      trim: true,
      index: true,
    },
    receiptUrl: {
      type: String,
      default: '',
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    verifiedBy: {
      type: String,
      default: '',
    },
    verifiedAt: {
      type: Date,
    },
    adminRemarks: {
      type: String,
      default: '',
      trim: true,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },

    // Assigned Investment Plan & Terms
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InvestmentPlan',
    },
    planCode: {
      type: String,
      default: '',
      trim: true,
    },
    planName: {
      type: String,
      default: 'Approved Term Plan',
      trim: true,
    },
    version: {
      type: String,
      default: '1.0',
    },
    multiplier: {
      type: Number,
      default: 2,
    },
    contractualPercentage: {
      type: Number,
      default: 100,
    },
    percentageBasis: {
      type: String,
      enum: ['Monthly', 'Annual', 'Total Contractual Percentage', 'None'],
      default: 'Total Contractual Percentage',
    },
    durationMonths: {
      type: Number,
      default: 24,
    },
    assignedDate: {
      type: Date,
      default: Date.now,
    },
    maturityDate: {
      type: Date,
    },
    planStatus: {
      type: String,
      enum: ['None', 'Pending', 'Draft', 'Active', 'Matured', 'Completed', 'Cancelled', 'Terminated'],
      default: 'Pending',
      index: true,
    },

    // Investment Agreement
    agreementNumber: {
      type: String,
      default: '',
      trim: true,
    },
    agreementUrl: {
      type: String,
      default: '',
      trim: true,
    },
    agreementStatus: {
      type: String,
      enum: ['None', 'Draft', 'Generated', 'Signed', 'Approved', 'Executed', 'Pending'],
      default: 'Draft',
    },
    agreementUploadedAt: {
      type: Date,
    },

    // Dedicated 2X Contract Ledger Tracking Record for this specific investment
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
      durationMonths: { type: Number, default: 24 },
      startDate: { type: Date },
      maturityDate: { type: Date },
      totalEligiblePayouts: { type: Number, default: 0 },
      remainingPayout: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ['None', 'Pending', 'Draft', 'Active', 'Matured', 'Completed', 'Suspended'],
        default: 'Pending',
      },
      activatedAt: { type: Date },
      activatedBy: { type: String, default: '' },
    },

    // Linked Ledger & Payment References
    ledgerEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InvestorLedgerEntry',
    },
    paymentRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InvestorPayment',
    },

    createdBy: {
      type: String,
      default: 'Super Admin',
    },
  },
  {
    timestamps: true,
  }
);

investmentRecordSchema.set('toJSON', { virtuals: true });
investmentRecordSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('InvestmentRecord', investmentRecordSchema);

