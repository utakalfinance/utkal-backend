const mongoose = require('mongoose');

const investorAuditLogSchema = new mongoose.Schema(
  {
    investor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investor',
      index: true,
    },
    investorId: {
      type: String,
      trim: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        'Registration',
        'KYC',
        'Payment',
        'Investment',
        'PlanAssignment',
        'Agreement',
        'Ledger',
        'Payout',
        'Email',
        'Security',
      ],
      default: 'Registration',
      index: true,
    },
    performedBy: {
      type: String,
      default: 'Super Admin',
    },
    details: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('InvestorAuditLog', investorAuditLogSchema);

