const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referralId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    district: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'District',
      index: true,
    },
    districtPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    associateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      index: true,
    },
    associateMemberId: {
      type: String,
      trim: true,
    },
    associateName: {
      type: String,
      trim: true,
    },
    customerName: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    referralType: {
      type: String,
      enum: ['Member Registration', 'Investor Submission', 'General Referral'],
      default: 'Member Registration',
      index: true,
    },
    investmentAmount: {
      type: Number,
      default: 0,
    },
    tenureMonths: {
      type: Number,
      default: 12,
    },
    status: {
      type: String,
      enum: ['New', 'In Process', 'Converted', 'Rejected', 'On Hold'],
      default: 'New',
      index: true,
    },
    referralCode: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    convertedAt: {
      type: Date,
    },
    createdBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate referral ID if not provided
referralSchema.pre('validate', async function (next) {
  if (!this.referralId) {
    const count = await mongoose.model('Referral').countDocuments();
    const prefix = this.district ? this.district.slice(0, 3).toUpperCase() : 'REF';
    this.referralId = `REF-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.models.Referral || mongoose.model('Referral', referralSchema);

