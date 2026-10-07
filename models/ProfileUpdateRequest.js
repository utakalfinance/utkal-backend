const mongoose = require('mongoose');

const profileUpdateRequestSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      required: [true, 'Member ID is required'],
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
    },
    memberName: {
      type: String,
      required: [true, 'Member name is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
    },
    mobile: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    requestedChanges: {
      name: { type: String, trim: true },
      dob: { type: String, trim: true },
      gender: { type: String, trim: true },
      occupation: { type: String, trim: true },
      email: { type: String, trim: true },
      mobile: { type: String, trim: true },
      altMobile: { type: String, trim: true },
      preferredCommunication: { type: String, trim: true },
      address1: { type: String, trim: true },
      address2: { type: String, trim: true },
      address: { type: String, trim: true },
      district: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      photoUrl: { type: String, trim: true },
    },
    previousValues: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    adminRemarks: {
      type: String,
      trim: true,
    },
    reviewedBy: {
      type: String,
      trim: true,
    },
    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.ProfileUpdateRequest ||
  mongoose.model('ProfileUpdateRequest', profileUpdateRequestSchema);
