const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema(
  {
    commissionId: {
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
    beneficiaryRole: {
      type: String,
      enum: ['District Partner', 'Associate Member'],
      default: 'District Partner',
    },
    category: {
      type: String,
      enum: [
        'Membership Admission',
        'Investor Inflow',
        'District Performance Override',
        'Referral Reward',
      ],
      default: 'Membership Admission',
    },
    sourceReference: {
      type: String,
      trim: true,
    },
    baseAmount: {
      type: Number,
      default: 0,
    },
    ratePercentage: {
      type: Number,
      default: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'cancelled'],
      default: 'pending',
      index: true,
    },
    approvedBy: {
      type: String,
      trim: true,
    },
    approvedAt: {
      type: Date,
    },
    paidAt: {
      type: Date,
    },
    payoutRef: {
      type: String,
      trim: true,
    },
    payoutMethod: {
      type: String,
      default: 'Direct Bank Settlement (IMPS/NEFT)',
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate commission ID if not provided
commissionSchema.pre('validate', async function (next) {
  if (!this.commissionId) {
    const count = await mongoose.model('Commission').countDocuments();
    const prefix = this.district ? this.district.slice(0, 3).toUpperCase() : 'COM';
    this.commissionId = `COM-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.models.Commission || mongoose.model('Commission', commissionSchema);

