const mongoose = require('mongoose');

const instalmentSchema = new mongoose.Schema({
  instalmentNumber: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  emiAmount: { type: Number, required: true },
  principalComponent: { type: Number, default: 0 },
  interestComponent: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  paidAt: { type: Date },
  paymentStatus: {
    type: String,
    enum: ['Upcoming', 'Paid', 'Overdue'],
    default: 'Upcoming',
  },
  transactionId: { type: String, default: '' },
  utrNumber: { type: String, default: '' },
  paymentMethod: { type: String, default: '' },
  receiptUrl: { type: String, default: '' },
});

const paymentRecordSchema = new mongoose.Schema({
  transactionId: { type: String, required: true },
  loanId: { type: String, default: '' },
  instalmentNumber: { type: Number },
  paymentDate: { type: Date, default: Date.now },
  amount: { type: Number, required: true },
  paymentMethod: { type: String, default: 'UPI (IndusInd QR)' },
  transactionReference: { type: String, default: '' },
  paymentStatus: { type: String, enum: ['Success', 'Pending', 'Failed'], default: 'Success' },
  receiptUrl: { type: String, default: '' },
});

const loanApplicationSchema = new mongoose.Schema(
  {
    applicationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    loanId: {
      type: String,
      sparse: true,
      trim: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    applicantName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    district: {
      type: String,
      default: 'Khurda',
      trim: true,
      index: true,
    },
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'District',
      default: null,
      index: true,
    },
    assignedDistrictAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    assignedDistrictAdminName: {
      type: String,
      default: '',
      trim: true,
    },
    isDistrictAdminAssigned: {
      type: Boolean,
      default: false,
      index: true,
    },
    loanType: {
      type: String,
      required: true,
      trim: true,
    },
    loanCategory: {
      type: String,
      default: 'Statutory Member Credit Facility',
      trim: true,
    },
    requestedAmount: {
      type: Number,
      required: true,
      min: 1000,
    },
    sanctionedAmount: {
      type: Number,
      default: 0,
    },
    interestRate: {
      type: Number,
      default: 11, // 11% for CIBIL > 600, 12% for CIBIL <= 600 per client guidelines
    },
    cibilScore: {
      type: Number,
      default: null,
    },
    cibilStatus: {
      type: String,
      default: '',
    },
    preferredTenureMonths: {
      type: Number,
      required: true,
      default: 2,
    },
    loanPurpose: {
      type: String,
      required: true,
      trim: true,
    },
    employmentDetails: {
      occupationType: { type: String, default: 'Self-Employed / Business', trim: true },
      monthlyIncome: { type: Number, default: 0 },
      employerOrBusinessName: { type: String, default: '', trim: true },
      workAddress: { type: String, default: '', trim: true },
    },
    documents: [
      {
        documentType: { type: String, required: true },
        documentName: { type: String, required: true },
        documentUrl: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
        verificationStatus: {
          type: String,
          enum: ['Pending', 'Verified', 'Rejected'],
          default: 'Pending',
        },
        verificationRemarks: { type: String, default: '' },
        verifiedAt: { type: Date },
        verifiedBy: { type: String, default: '' },
      },
    ],
    // Verification Workflows
    customerVerification: {
      status: {
        type: String,
        enum: ['Pending', 'Verified', 'Rejected', 'On Hold'],
        default: 'Pending',
      },
      verifiedBy: { type: String, default: '' },
      verifiedAt: { type: Date },
      remarks: { type: String, default: '' },
      rejectionReason: { type: String, default: '' },
    },
    districtVerification: {
      status: {
        type: String,
        enum: ['Pending', 'Under Verification', 'Verified', 'Rejected', 'On Hold'],
        default: 'Pending',
      },
      verifiedBy: { type: String, default: '' },
      verifiedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      districtId: { type: mongoose.Schema.Types.ObjectId, ref: 'District' },
      verifiedAt: { type: Date },
      decisionDate: { type: Date },
      districtRemarks: { type: String, default: '' },
      rejectionReason: { type: String, default: '' },
      isForwardedToSuperAdmin: { type: Boolean, default: false },
      forwardedToSuperAdminAt: { type: Date },
    },
    verificationActivities: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, required: true },
        performedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: { type: String, default: 'district_admin' },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, default: '' },
      },
    ],
    finalApproval: {
      status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'On Hold'],
        default: 'Pending',
      },
      approvedBy: { type: String, default: '' },
      approvedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: { type: Date },
      approvedAmount: { type: Number, default: 10000 },
      approvedTenureMonths: { type: Number, default: 3 },
      interestPolicyReference: { type: String, default: 'Utkal Finance Statutory Credit Policy 2026' },
      finalRemarks: { type: String, default: '' },
      rejectionReason: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: [
        'Submitted',
        'Pending District Verification',
        'Under Verification',
        'On Hold',
        'Rejected',
        'Forwarded to Super Admin',
        'Pending Final Approval',
        'Approved',
        'Approved – Not Disbursed',
        'Approved - Not Disbursed',
        'Disbursed',
        'Active',
        'Closed',
      ],
      default: 'Pending District Verification',
      index: true,
    },
    disbursement: {
      isDisbursed: { type: Boolean, default: false, index: true },
      disbursedAmount: { type: Number, default: 0 },
      disbursedAt: { type: Date },
      paymentMethod: {
        type: String,
        enum: [
          'Bank Transfer',
          'Bank Transfer (NEFT/RTGS/IMPS)',
          'UPI',
          'Cheque',
          'Cash / Cash Order',
          'Other',
        ],
        default: 'Bank Transfer (NEFT/RTGS/IMPS)',
      },
      transactionId: { type: String, default: '', trim: true, index: true },
      disbursementReference: { type: String, default: '', trim: true },
      remarks: { type: String, default: '', trim: true },
      disbursedBy: { type: String, default: '' },
      disbursedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      bankAccountOrUpi: { type: String, default: '' },
    },
    repayment: {
      totalPayableAmount: { type: Number, default: 0 },
      totalPaidAmount: { type: Number, default: 0 },
      outstandingBalance: { type: Number, default: 0 },
      monthlyEmiAmount: { type: Number, default: 0 },
      nextEmiDueDate: { type: Date },
      nextEmiAmount: { type: Number, default: 0 },
      schedule: [instalmentSchema],
    },
    payments: [paymentRecordSchema],
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.LoanApplication || mongoose.model('LoanApplication', loanApplicationSchema);
