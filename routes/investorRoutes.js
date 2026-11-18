const express = require('express');
const router = express.Router();
const { adminOnly, adminOrAssociate } = require('../middleware/adminMiddleware');
const upload = require('../middleware/uploadMiddleware');
const {
  getInvestorStats,
  getInvestors,
  getInvestorById,
  createInvestor,
  updateInvestor,
  verifyKyc,
  requestKycCorrection,
  recordPayment,
  verifyPayment,
  getInvestmentPlans,
  assignPlan,
  activateInvestorPlan,
  createInvestmentPlan,
  updateInvestmentPlan,
  recordPayoutOrRefund,
  addLedgerAdjustment,
  reverseLedgerEntry,
  getAllLedgerEntries,
  getFundAllocationAndReconciliation,
  getFinancialReports,
  sendConfirmationEmail,
  sendInvestorNotification,
  uploadAgreement,
  getInvestorInvestments,
  createAdditionalInvestment,
  verifyInvestmentPayment,
  associateApproveInvestor,
  finalApproveInvestor,
  getAssociatesList,
} = require('../controllers/investorController');

// 1. Top Summary Statistics (Accessible to Admin & Associate)
router.get('/stats', adminOrAssociate, getInvestorStats);

// 2. Global Ledger Entries & Reversal (Super Admin Only)
router.get('/ledger/all', adminOnly, getAllLedgerEntries);
router.post('/ledger/reverse/:entryId', adminOnly, reverseLedgerEntry);

// 3. Fund Allocation & Loan Reconciliation (Super Admin Only)
router.get('/reconciliation/funds-and-loans', adminOnly, getFundAllocationAndReconciliation);

// 4. Financial Reports (Super Admin Only)
router.get('/reports/generate', adminOnly, getFinancialReports);

// 5. Available Investment Plans (List for Admin & Associate, Config for Admin Only)
router.get('/plans', adminOrAssociate, getInvestmentPlans);
router.post('/plans', adminOnly, createInvestmentPlan);
router.put('/plans/:id', adminOnly, updateInvestmentPlan);

// 6. Investors CRUD & Search (Admin & Associate)
router.get('/associates-list', adminOnly, getAssociatesList);
router.get('/', adminOrAssociate, getInvestors);
router.get('/:id', adminOrAssociate, getInvestorById);

router.post(
  '/',
  adminOrAssociate,
  upload.fields([
    { name: 'aadhaarFront', maxCount: 1 },
    { name: 'aadhaarBack', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'paymentReceipt', maxCount: 1 },
    { name: 'agreement', maxCount: 1 },
    { name: 'investmentAgreement', maxCount: 1 },
  ]),
  createInvestor
);

// Two-Tier Approval Workflow Endpoints:
// Stage 1: Associate Member approves investor -> sends to Admin queue
router.post('/:id/associate-approve', adminOrAssociate, associateApproveInvestor);
router.patch('/:id/associate-approve', adminOrAssociate, associateApproveInvestor);

// Stage 2: Super Admin gives final approval -> activates investor
router.post('/:id/final-approve', adminOnly, finalApproveInvestor);
router.patch('/:id/final-approve', adminOnly, finalApproveInvestor);

router.put(
  '/:id',
  adminOnly,
  upload.fields([
    { name: 'aadhaarFront', maxCount: 1 },
    { name: 'aadhaarBack', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'paymentReceipt', maxCount: 1 },
    { name: 'agreement', maxCount: 1 },
  ]),
  updateInvestor
);

// 7. KYC Verification & Correction Request
router.patch('/:id/kyc-verify', adminOnly, verifyKyc);
router.patch('/:id/request-correction', adminOnly, requestKycCorrection);

// 8. Payment Recording & Verification
router.post('/:id/payments', adminOnly, upload.single('receipt'), recordPayment);
router.patch('/payments/:paymentId/verify', adminOnly, verifyPayment);

// 9. Plan Assignment & Agreement
router.post('/:id/assign-plan', adminOnly, assignPlan);
router.patch('/:id/activate-plan', adminOnly, activateInvestorPlan);
router.post('/:id/agreement', adminOnly, upload.single('agreementFile'), uploadAgreement);

// 10. Payouts, Refunds & Ledger Adjustments
router.post('/:id/payouts', adminOnly, recordPayoutOrRefund);
router.post('/:id/ledger-adjustments', adminOnly, addLedgerAdjustment);

// 11. Communication & Notification Dispatch (Email & SMS)
router.post('/:id/send-confirmation-email', adminOnly, sendConfirmationEmail);
router.post('/:id/send-notification', adminOnly, sendInvestorNotification);

// 12. Additional / Repeat Investment Endpoints
router.get('/:id/investments', adminOrAssociate, getInvestorInvestments);
router.post(
  '/:id/investments',
  adminOnly,
  upload.fields([
    { name: 'receipt', maxCount: 1 },
    { name: 'agreementFile', maxCount: 1 },
  ]),
  createAdditionalInvestment
);
router.patch('/:id/investments/:investmentRecordId/verify', adminOnly, verifyInvestmentPayment);

module.exports = router;

