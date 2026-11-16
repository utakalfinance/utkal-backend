const mongoose = require('mongoose');

const investorLedgerEntrySchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: [true, 'Transaction ID is required'],
      unique: true,
      trim: true,
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
      index: true,
    },
    date: {
      type: Date,
      default: Date.now,
      required: true,
    },
    description: {
      type: String,
      required: [true, 'Transaction description is required'],
      trim: true,
    },
    category: {
      type: String,
      enum: [
        'Opening Balance',
        'Investment Received',
        'Additional Investment',
        'Approved Investor Payout',
        'Capital Repayment',
        'Return Payment',
        'Adjustments',
        'Reversal',
        'Initial Investment',
        'Additional Verified Receipt',
        'Refund',
        'Authorized Adjustment',
      ],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['Credit', 'Debit'],
      required: true,
    },
    credit: {
      type: Number,
      default: 0,
      min: 0,
    },
    debit: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Running balance strictly calculated from recorded ledger transactions
    runningBalance: {
      type: Number,
      required: true,
    },
    reference: {
      type: String,
      default: '',
      trim: true,
    },
    isReversed: {
      type: Boolean,
      default: false,
      index: true,
    },
    reversalEntryId: {
      type: String,
      default: '',
      trim: true,
    },
    reversalReferenceId: {
      type: String,
      default: '',
      trim: true,
    },
    reversalReason: {
      type: String,
      default: '',
      trim: true,
    },
    verificationStatus: {
      type: String,
      enum: ['Verified', 'Pending', 'Voided'],
      default: 'Verified',
      index: true,
    },
    remarks: {
      type: String,
      default: '',
      trim: true,
    },
    createdBy: {
      type: String,
      default: 'Super Admin',
    },
    // Audit trail showing who created, verified, or adjusted this entry
    auditTrail: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        details: { type: String, default: '' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('InvestorLedgerEntry', investorLedgerEntrySchema);

