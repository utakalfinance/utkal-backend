const mongoose = require('mongoose');

const investmentPlanSchema = new mongoose.Schema(
  {
    planCode: {
      type: String,
      required: [true, 'Plan code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
    },
    version: {
      type: String,
      default: '1.0',
      trim: true,
    },
    multiplier: {
      type: Number,
      default: 2,
      min: 1,
    },
    approvedPercentage: {
      type: Number,
      default: 100,
      min: 0,
    },
    percentageBasis: {
      type: String,
      enum: ['Monthly', 'Annual', 'Total Contractual Percentage', 'None'],
      default: 'Total Contractual Percentage',
    },
    durationMonths: {
      type: Number,
      required: [true, 'Duration in months is required'],
      min: 1,
      default: 24,
    },
    availableDurations: {
      type: [Number],
      default: [12, 18, 24, 36, 48, 60],
    },
    terms: {
      type: String,
      required: [true, 'Approved terms and conditions are required'],
      trim: true,
    },
    minAmount: {
      type: Number,
      default: 1000,
      min: 500,
    },
    maxAmount: {
      type: Number,
      default: 10000000,
    },
    status: {
      type: String,
      enum: ['Approved', 'Draft', 'Disabled'],
      default: 'Approved',
      index: true,
    },
    // 2X / 3X investment structures must remain disabled or in Draft status until formal company compliance approval
    is2x3xStructure: {
      type: Boolean,
      default: false,
    },
    regulatoryNotice: {
      type: String,
      default: 'Subject to statutory mutual benefit cooperative norms. No speculative or unapproved return promises.',
    },
    approvedBy: {
      type: String,
      default: 'Executive Board',
    },
    approvedDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('InvestmentPlan', investmentPlanSchema);

