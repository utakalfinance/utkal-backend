const mongoose = require('mongoose');

const investorPaymentSchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      required: [true, 'Payment ID is required'],
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
    investorName: {
      type: String,
      required: [true, 'Investor name is required'],
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, 'Investment amount is required'],
      min: [1, 'Amount must be positive'],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ['UPI', 'Bank Transfer', 'NEFT/RTGS', 'Cheque', 'Cash', 'Other'],
      default: 'UPI',
      trim: true,
    },
    utrNumber: {
      type: String,
      required: [true, 'UTR / Transaction Reference is required'],
      trim: true,
      index: true,
    },
    receiptUrl: {
      type: String,
      default: '',
      trim: true,
    },
    // CRITICAL: Uploading receipt does NOT auto-verify. Default MUST be 'Pending'.
    status: {
      type: String,
      enum: ['Pending', 'Verified', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    adminRemarks: {
      type: String,
      default: '',
      trim: true,
    },
    verifiedBy: {
      type: String,
      default: '',
    },
    verifiedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      default: '',
    },
    // Ledger entry reference created once payment is verified
    ledgerEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InvestorLedgerEntry',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('InvestorPayment', investorPaymentSchema);

