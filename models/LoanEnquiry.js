const mongoose = require('mongoose');

const loanEnquirySchema = new mongoose.Schema(
  {
    enquiryId: {
      type: String,
      required: [true, 'Enquiry ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    mobileNumber: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    loanCategory: {
      type: String,
      trim: true,
      default: 'General / Member Consultation',
      index: true,
    },
    expectedAmount: {
      type: Number,
      default: 0,
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    purpose: {
      type: String,
      trim: true,
      default: 'Public loan interest submitted for associate membership consultation',
    },
    status: {
      type: String,
      enum: [
        'New',
        'Contacted',
        'Membership Registration Informed',
        'Converted',
        'Closed',
      ],
      default: 'New',
      index: true,
    },
    adminRemarks: {
      type: String,
      trim: true,
      default: '',
    },
    contactedAt: {
      type: Date,
    },
    membershipInformedAt: {
      type: Date,
    },
    convertedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
    lastUpdatedBy: {
      type: String,
      trim: true,
      default: '',
    },
    history: [
      {
        status: { type: String, required: true },
        remarks: { type: String, default: '' },
        updatedBy: { type: String, default: 'Administrator' },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.LoanEnquiry || mongoose.model('LoanEnquiry', loanEnquirySchema);
