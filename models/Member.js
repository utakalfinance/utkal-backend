const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      required: [true, 'Member ID is required'],
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
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Member name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Member email is required'],
      lowercase: true,
      trim: true,
      index: true,
    },
    mobile: {
      type: String,
      trim: true,
    },
    membershipType: {
      type: String,
      default: 'Associate Member',
      trim: true,
    },
    membershipAmount: {
      type: Number,
      default: 200,
    },
    numberOfShares: {
      type: Number,
      default: 10,
    },
    shareValue: {
      type: Number,
      default: 10,
    },
    processingFee: {
      type: Number,
      default: 100,
    },
    totalContribution: {
      type: Number,
      default: 200,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
      index: true,
    },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    credentialsEmailStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    personalDetails: {
      title: { type: String, trim: true },
      firstName: { type: String, trim: true },
      middleName: { type: String, trim: true },
      lastName: { type: String, trim: true },
      relationshipPrefix: { type: String, trim: true },
      fatherLegalName: { type: String, trim: true },
      dob: { type: String, trim: true },
      age: { type: String, trim: true },
      gender: { type: String, trim: true },
      maritalStatus: { type: String, trim: true },
      education: { type: String, trim: true },
      religion: { type: String, trim: true },
      category: { type: String, trim: true },
      occupation: { type: String, trim: true },
      pan: { type: String, trim: true },
    },
    contactDetails: {
      mobile: { type: String, trim: true },
      altMobile: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true },
    },
    addressDetails: {
      address1: { type: String, trim: true },
      address2: { type: String, trim: true },
      villageTown: { type: String, trim: true },
      district: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      country: { type: String, trim: true },
      sameAsResidential: { type: Boolean, default: true },
      commAddress1: { type: String, trim: true },
      commAddress2: { type: String, trim: true },
      commVillageTown: { type: String, trim: true },
      commDistrict: { type: String, trim: true },
      commState: { type: String, trim: true },
      commPincode: { type: String, trim: true },
      commCountry: { type: String, trim: true },
    },
    nomineeDetails: {
      fullName: { type: String, trim: true },
      relationship: { type: String, trim: true },
      dob: { type: String, trim: true },
      mobile: { type: String, trim: true },
      address: { type: String, trim: true },
      sameAsApplicant: { type: Boolean, default: true },
      isMinor: { type: Boolean, default: false },
      guardianName: { type: String, trim: true },
      guardianRelationship: { type: String, trim: true },
    },
    membershipDetails: {
      membershipType: { type: String, default: 'Associate Member', trim: true },
      membershipAmount: { type: String, default: '200' },
      preferredCommunication: { type: String, default: 'Both' },
      numberOfShares: { type: Number, default: 10 },
      shareValue: { type: Number, default: 10 },
      processingFee: { type: Number, default: 100 },
      totalContribution: { type: Number, default: 200 },
    },
    documentDetails: {
      idProofType: { type: String, trim: true },
      idProofNumber: { type: String, trim: true },
      idProofUrl: { type: String, trim: true },
      addressProofType: { type: String, trim: true },
      addressProofNumber: { type: String, trim: true },
      addressProofUrl: { type: String, trim: true },
      photoUrl: { type: String, trim: true },
      signatureUrl: { type: String, trim: true },
      paymentReceiptUrl: { type: String, trim: true },
      additionalDocuments: [
        {
          documentType: { type: String, trim: true },
          documentName: { type: String, trim: true },
          documentUrl: { type: String, trim: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
    },
    paymentDetails: {
      method: { type: String, trim: true },
      amount: { type: Number, default: 200 },
      utrNumber: { type: String, trim: true },
      receiptUrl: { type: String, trim: true },
      paidAt: { type: Date },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Member || mongoose.model('Member', memberSchema);
