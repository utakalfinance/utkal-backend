const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      required: [true, 'Payment ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      index: true,
    },
    applicationRefId: {
      type: String,
      trim: true,
      index: true,
    },
    memberId: {
      type: String,
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    memberName: {
      type: String,
      required: [true, 'Member name is required'],
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    mobile: {
      type: String,
      trim: true,
    },
    purpose: {
      type: String,
      default: 'Statutory Membership & Share Capital (10 Shares)',
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      default: 200,
    },
    paymentMethod: {
      type: String,
      default: 'UPI (IndusInd Bank QR)',
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'successful', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    utrNo: {
      type: String,
      trim: true,
    },
    transactionId: {
      type: String,
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    receiptUrl: {
      type: String,
      trim: true,
    },
    receiptFileName: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    verifiedBy: {
      type: String,
      trim: true,
    },
    verifiedAt: {
      type: Date,
    },
    history: [
      {
        field: String,
        oldValue: String,
        newValue: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
