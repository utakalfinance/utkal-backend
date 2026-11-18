const mongoose = require('mongoose');

const loanSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'default_loan_policy',
      unique: true,
      trim: true,
      index: true,
    },
    // Loan Amount Configurations
    defaultAmount: {
      type: Number,
      default: 10000,
      min: 1000,
    },
    minAmount: {
      type: Number,
      default: 5000,
      min: 1000,
    },
    maxAmount: {
      type: Number,
      default: 50000,
      min: 1000,
    },
    isAmountFixed: {
      type: Boolean,
      default: true,
    },
    allowedAmounts: {
      type: [Number],
      default: [10000, 20000, 30000, 50000],
    },

    // Interest Rate Configurations
    monthlyInterestRate: {
      type: Number,
      default: 1,
      min: 0,
      max: 100,
    },
    baseInterestRate: {
      type: Number,
      default: 12,
      min: 0,
      max: 100,
    },
    highCibilInterestRate: {
      type: Number,
      default: 11,
      min: 0,
      max: 100,
    },
    standardCibilInterestRate: {
      type: Number,
      default: 12,
      min: 0,
      max: 100,
    },
    cibilThreshold: {
      type: Number,
      default: 600,
    },
    interestRateDisplay: {
      type: String,
      default: '11% p.a.',
      trim: true,
    },

    // Tenure and EMI Configurations
    availableTenureMonths: {
      type: [Number],
      default: [3, 6, 9],
    },
    defaultTenureMonths: {
      type: Number,
      default: 3,
    },
    emiCalculationMethod: {
      type: String,
      enum: ['reducing_balance', 'flat_rate'],
      default: 'reducing_balance',
    },
    processingFeePercent: {
      type: Number,
      default: 1,
      min: 0,
    },
    processingFeeFixed: {
      type: Number,
      default: 0,
      min: 0,
    },
    aboutEmiNote: {
      type: String,
      default:
        'EMI is calculated on reducing balance. Monthly repayments are scheduled on the 5th of each month following disbursement with zero prepayment penalty.',
      trim: true,
    },
    repaymentGuidelines: {
      type: [String],
      default: [
        'Monthly installments are auto-debited or payable via direct UPI/IMPS.',
        'Grace period of 3 business days is provided before late charges apply.',
        'Timely repayments elevate your credit profile and unlock larger loan limits.',
      ],
    },
    policyReference: {
      type: String,
      default: 'Utkal Finance Statutory Member Credit Policy 2026',
      trim: true,
    },
    updatedBy: {
      type: String,
      default: 'Super Admin',
      trim: true,
    },
    updatedById: {
      type: mongoose.Schema.Types.Mixed, // Supports MongoDB ObjectId or system identity string (e.g. 'admin-root')
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Helper static method to get or create default settings singleton
loanSettingSchema.statics.getOrCreateDefault = async function () {
  let setting = await this.findOne({ key: 'default_loan_policy' });
  if (!setting) {
    setting = await this.create({ key: 'default_loan_policy' });
  }
  return setting;
};

module.exports = mongoose.model('LoanSetting', loanSettingSchema);
