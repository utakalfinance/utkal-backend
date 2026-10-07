const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Application = require('../models/Application');
const Member = require('../models/Member');
const { generatePaymentId } = require('../utils/paymentIdGenerator');

/**
 * Format date helper
 */
const formatDate = (dateInput) => {
  if (!dateInput) return 'N/A';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch (e) {
    return 'N/A';
  }
};

/**
 * Format a Payment document from MongoDB into a standard API response for frontend
 */
const formatPaymentRecord = (p) => {
  if (!p) return null;

  const rawStatus = (p.status || 'pending').toLowerCase();
  let displayStatus = 'Pending';
  if (['paid', 'successful', 'completed', 'verified'].includes(rawStatus)) {
    displayStatus = 'Paid';
  } else if (rawStatus === 'refunded') {
    displayStatus = 'Refunded';
  } else if (rawStatus === 'failed') {
    displayStatus = 'Failed';
  }

  return {
    id: p.paymentId,
    _id: p._id,
    paymentId: p.paymentId,
    memberId: p.memberId || 'N/A',
    memberName: p.memberName,
    member: p.memberName,
    email: p.email || '',
    mobile: p.mobile || '',
    applicationId: p.applicationRefId || (p.applicationId ? p.applicationId.toString() : ''),
    applicationMongoId: p.applicationId,
    userId: p.userId,
    depositId: '',
    purpose: p.purpose || 'Statutory Membership & Share Capital (10 Shares)',
    amount: Number(p.amount || 200),
    paymentMethod: p.paymentMethod || 'UPI (IndusInd Bank QR)',
    method: p.paymentMethod || 'UPI (IndusInd Bank QR)',
    status: displayStatus,
    rawStatus: p.status,
    utrNo: p.utrNo || p.transactionId || 'UPI_VERIFIED',
    transactionId: p.transactionId || p.utrNo || p.paymentId,
    date: formatDate(p.date || p.createdAt),
    rawDate: p.date || p.createdAt,
    receiptUrl: p.receiptUrl || '',
    receiptFileName: p.receiptFileName || 'Payment_Receipt.png',
    notes: p.notes || `Payment for ${p.memberName}`,
    verifiedBy: p.verifiedBy || '',
    verifiedAt: p.verifiedAt || null,
    history: Array.isArray(p.history) ? p.history : [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
};

/**
 * @desc    Get all payments from MongoDB payments collection
 * @route   GET /api/payments
 * @access  Public / Admin
 */
const getPayments = async (req, res) => {
  try {
    // 1. Auto-sync any approved application that doesn't have a Payment document yet
    const approvedApps = await Application.find({ status: 'approved' });
    for (const app of approvedApps) {
      const existingPayment = await Payment.findOne({ applicationId: app._id });
      if (!existingPayment) {
        const appId = app.applicationId || app._id.toString();
        const cleanDigits = appId.replace(/\D/g, '') || null;
        const paymentId = await generatePaymentId(cleanDigits);

        const p = app.personalDetails || {};
        const nameParts = [p.title || app.title, p.firstName || app.firstName, p.middleName || app.middleName, p.lastName || app.lastName].filter(Boolean);
        const memberName = nameParts.length > 0 ? nameParts.join(' ') : (app.applicantName || 'Applicant');
        const email = (app.contactDetails?.email || app.email || '').toLowerCase().trim();
        const mobile = app.contactDetails?.mobile || app.mobile || '';

        const amount = Number(app.paymentDetails?.amount || app.membershipDetails?.totalContribution || app.totalPaid || 200);
        const paymentMethod = app.paymentDetails?.method || app.paymentMethod || 'UPI (IndusInd Bank QR)';
        const utrNo = app.paymentDetails?.utrNumber || app.utrNo || 'UPI_VERIFIED';
        const receiptUrl = app.paymentDetails?.receiptUrl || app.documentDetails?.paymentReceiptUrl || '';
        const receiptFileName = app.paymentDetails?.receiptFileName || 'Statutory_Payment_Receipt.png';

        // Set status to 'paid' if applicant has payment confirmation / utr or approved
        const status = (app.paymentDetails?.status || 'paid').toLowerCase();

        await Payment.findOneAndUpdate(
          { applicationId: app._id },
          {
            $set: {
              paymentId,
              applicationId: app._id,
              applicationRefId: appId,
              memberId: app.memberId || 'N/A',
              memberName,
              email,
              mobile,
              purpose: 'Statutory Membership & Share Capital (10 Shares)',
              amount,
              paymentMethod,
              status,
              utrNo,
              transactionId: utrNo !== 'UPI_VERIFIED' ? utrNo : `TXN-${cleanDigits || paymentId.replace(/\D/g, '')}`,
              date: app.paymentDetails?.paidAt || app.reviewedAt || app.submittedAt || new Date(),
              receiptUrl,
              receiptFileName,
              notes: `Statutory membership subscription for ${memberName}. Application ${appId} approved by Admin.`,
              history: [
                {
                  field: 'Payment Status',
                  oldValue: 'Pending Approval',
                  newValue: status === 'paid' ? 'Paid' : 'Pending',
                  changedAt: app.reviewedAt || new Date(),
                  changedBy: 'Admin (Approval)',
                },
              ],
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    // 2. Fetch all payments directly from MongoDB
    const paymentsFromDb = await Payment.find().sort({ createdAt: -1 });
    const formatted = paymentsFromDb.map(formatPaymentRecord);

    return res.status(200).json({
      success: true,
      count: formatted.length,
      payments: formatted,
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payments',
    });
  }
};

/**
 * @desc    Get single payment by ID
 * @route   GET /api/payments/:id
 * @access  Public / Admin
 */
const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    let payment = await Payment.findOne({
      $or: [
        { paymentId: id },
        { applicationRefId: id },
        { transactionId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    return res.status(200).json({
      success: true,
      payment: formatPaymentRecord(payment),
    });
  } catch (error) {
    console.error('Error fetching payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payment',
    });
  }
};

/**
 * @desc    Create a new payment record in MongoDB
 * @route   POST /api/payments
 * @access  Admin
 */
const createPayment = async (req, res) => {
  try {
    const {
      memberId,
      memberName,
      applicationId,
      purpose,
      amount,
      paymentMethod,
      utrNo,
      transactionId,
      status = 'paid',
      notes,
      receiptUrl,
      receiptFileName,
    } = req.body;

    if (!memberName) {
      return res.status(400).json({
        success: false,
        message: 'Member name is required',
      });
    }

    const paymentId = await generatePaymentId();

    const payment = await Payment.create({
      paymentId,
      applicationRefId: applicationId || '',
      memberId: memberId || 'N/A',
      memberName,
      purpose: purpose || 'Statutory Membership & Share Capital (10 Shares)',
      amount: Number(amount || 200),
      paymentMethod: paymentMethod || 'UPI (IndusInd Bank QR)',
      status: status.toLowerCase(),
      utrNo: utrNo || transactionId || 'MANUAL_ENTRY',
      transactionId: transactionId || utrNo || paymentId,
      receiptUrl: receiptUrl || '',
      receiptFileName: receiptFileName || 'Payment_Receipt.png',
      notes: notes || `Payment created for ${memberName}`,
      history: [
        {
          field: 'Payment Created',
          oldValue: 'None',
          newValue: status,
          changedAt: new Date(),
          changedBy: 'Admin',
        },
      ],
    });

    return res.status(201).json({
      success: true,
      message: 'Payment record created successfully in MongoDB',
      payment: formatPaymentRecord(payment),
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create payment',
    });
  }
};

/**
 * @desc    Update payment record / status
 * @route   PATCH /api/payments/:id
 * @access  Admin
 */
const updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const payment = await Payment.findOne({
      $or: [
        { paymentId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Apply allowed updates
    if (updates.status) {
      payment.history.push({
        field: 'Payment Status',
        oldValue: payment.status,
        newValue: updates.status,
        changedAt: new Date(),
        changedBy: 'Admin',
      });
      payment.status = updates.status.toLowerCase();
    }
    if (updates.amount !== undefined) payment.amount = Number(updates.amount);
    if (updates.purpose) payment.purpose = updates.purpose;
    if (updates.paymentMethod) payment.paymentMethod = updates.paymentMethod;
    if (updates.utrNo) payment.utrNo = updates.utrNo;
    if (updates.transactionId) payment.transactionId = updates.transactionId;
    if (updates.notes) payment.notes = updates.notes;
    if (updates.receiptUrl) payment.receiptUrl = updates.receiptUrl;

    await payment.save();

    return res.status(200).json({
      success: true,
      message: 'Payment updated successfully in MongoDB',
      payment: formatPaymentRecord(payment),
    });
  } catch (error) {
    console.error('Error updating payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update payment',
    });
  }
};

/**
 * @desc    Verify payment
 * @route   POST /api/payments/:id/verify
 * @access  Admin
 */
const verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findOne({
      $or: [
        { paymentId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    payment.history.push({
      field: 'Payment Status',
      oldValue: payment.status,
      newValue: 'paid',
      changedAt: new Date(),
      changedBy: 'Admin (Manual Verification)',
    });
    payment.status = 'paid';
    payment.verifiedBy = 'Admin';
    payment.verifiedAt = new Date();

    await payment.save();

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully in MongoDB',
      payment: formatPaymentRecord(payment),
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify payment',
    });
  }
};

/**
 * @desc    Refund payment
 * @route   POST /api/payments/:id/refund
 * @access  Admin
 */
const refundPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findOne({
      $or: [
        { paymentId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    payment.history.push({
      field: 'Payment Status',
      oldValue: payment.status,
      newValue: 'refunded',
      changedAt: new Date(),
      changedBy: 'Admin (Refund Action)',
    });
    payment.status = 'refunded';

    await payment.save();

    return res.status(200).json({
      success: true,
      message: 'Payment refunded successfully in MongoDB',
      payment: formatPaymentRecord(payment),
    });
  } catch (error) {
    console.error('Error refunding payment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to refund payment',
    });
  }
};

module.exports = {
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  verifyPayment,
  refundPayment,
};
