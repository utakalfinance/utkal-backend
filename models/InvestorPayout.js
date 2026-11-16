const mongoose = require('mongoose');

const investorPayoutSchema = new mongoose.Schema(
  {
    payoutId: {
      type: String,
      required: [true, 'Payout ID is required'],
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
    category: {
      type: String,
      enum: ['Payout', 'Refund'],
      default: 'Payout',
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be positive'],
    },
    paymentMethod: {
      type: String,
      default: 'Bank Transfer (NEFT/IMPS)',
      trim: true,
    },
    reference: {
      type: String,
      default: '',
      trim: true,
      description: 'Bank UTR or transfer reference',
    },
    payoutDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Paid', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    bankDetails: {
      accountNumber: String,
      accountHolderName: String,
      bankName: String,
      ifscCode: String,
    },
    approvedBy: {
      type: String,
      default: '',
    },
    approvedAt: {
      type: Date,
    },
    disbursedBy: {
      type: String,
      default: '',
    },
    disbursedAt: {
      type: Date,
    },
    adminRemarks: {
      type: String,
      default: '',
      trim: true,
    },
    // Ledger entry reference created once payout is paid/disbursed
    ledgerEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InvestorLedgerEntry',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('InvestorPayout', investorPayoutSchema);

