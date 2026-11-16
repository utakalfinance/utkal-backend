const express = require('express');
const router = express.Router();
const { adminOnly } = require('../middleware/adminMiddleware');
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
} = require('../controllers/investorController');

// All routes are protected by Super Admin authentication
router.use(adminOnly);

// 1. Top Summary Statistics
router.get('/stats', getInvestorStats);

// 2. Global Ledger Entries & Reversal
router.get('/ledger/all', getAllLedgerEntries);
router.post('/ledger/reverse/:entryId', reverseLedgerEntry);

// 3. Fund Allocation & Loan Reconciliation
router.get('/reconciliation/funds-and-loans', getFundAllocationAndReconciliation);

// 4. Financial Reports
router.get('/reports/generate', getFinancialReports);

// 5. Available Investment Plans & Plan Configuration
router.get('/plans', getInvestmentPlans);
router.post('/plans', createInvestmentPlan);
router.put('/plans/:id', updateInvestmentPlan);

// 6. Investors CRUD & Search
router.get('/', getInvestors);
router.get('/:id', getInvestorById);

router.post(
  '/',
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

router.put(
  '/:id',
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
router.patch('/:id/kyc-verify', verifyKyc);
router.patch('/:id/request-correction', requestKycCorrection);

// 5. Payment Recording & Verification
router.post('/:id/payments', upload.single('receipt'), recordPayment);
router.patch('/payments/:paymentId/verify', verifyPayment);

// 6. Plan Assignment & Agreement
router.post('/:id/assign-plan', assignPlan);
router.patch('/:id/activate-plan', activateInvestorPlan);
router.post('/:id/agreement', upload.single('agreementFile'), uploadAgreement);

// 7. Payouts, Refunds & Ledger Adjustments
router.post('/:id/payouts', recordPayoutOrRefund);
router.post('/:id/ledger-adjustments', addLedgerAdjustment);

// 8. Communication & Notification Dispatch (Email & SMS)
router.post('/:id/send-confirmation-email', sendConfirmationEmail);
router.post('/:id/send-notification', sendInvestorNotification);

// 9. Additional / Repeat Investment Endpoints
router.get('/:id/investments', getInvestorInvestments);
router.post(
  '/:id/investments',
  upload.fields([
    { name: 'receipt', maxCount: 1 },
    { name: 'agreementFile', maxCount: 1 },
  ]),
  createAdditionalInvestment
);
router.patch('/:id/investments/:investmentRecordId/verify', verifyInvestmentPayment);

module.exports = router;

