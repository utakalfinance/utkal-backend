const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  getCustomerLoanOverview,
  getAvailableLoanProducts,
  applyForLoan,
  getTrackApplicationStatus,
  getEmiSchedule,
  getNextLoanEligibility,
  getCustomerLoanApplications,
  getCustomerActiveLoans,
  getCustomerRepayments,
  recordCustomerEmiPayment,
  getCustomerLoanPaymentHistory,
  getSuperAdminLoanStats,
  getSuperAdminPendingFinalApprovals,
  getSuperAdminAllLoanApplications,
  getSuperAdminLoanApplicationById,
  superAdminProcessLoanDecision,
  getSuperAdminPendingDisbursements,
  superAdminDisburseLoan,
  getSuperAdminDisbursementHistory,
  getSuperAdminDistrictSummary,
  getSuperAdminEmiDashboard,
  getSuperAdminAllEmis,
  superAdminCollectEmiPayment,
  getSuperAdminEmiReports,
  getLoanSettings,
  updateLoanSettings,
} = require('../controllers/loanApplicationController');

// All customer endpoints are strictly authenticated and scoped to the logged-in member
router.get('/overview', protect, getCustomerLoanOverview);
router.get('/products', protect, getAvailableLoanProducts);
router.get('/settings', protect, getLoanSettings);
router.post('/apply', protect, upload.any(), applyForLoan);
router.get('/track', protect, getTrackApplicationStatus);
router.get('/emi-schedule', protect, getEmiSchedule);
router.get('/next-eligibility', protect, getNextLoanEligibility);
router.get('/my-applications', protect, getCustomerLoanApplications);
router.get('/my-active-loans', protect, getCustomerActiveLoans);
router.get('/repayments', protect, getCustomerRepayments);
router.post('/repay', protect, recordCustomerEmiPayment);
router.get('/payment-history', protect, getCustomerLoanPaymentHistory);

// =========================================================================
// SUPER ADMIN & EXECUTIVE CREDIT OVERSIGHT ROUTES
// =========================================================================
router.get('/admin/stats', protect, authorize('super_admin', 'admin'), getSuperAdminLoanStats);
router.get('/admin/pending-final-approval', protect, authorize('super_admin', 'admin'), getSuperAdminPendingFinalApprovals);
router.get('/admin/disbursements/pending', protect, authorize('super_admin', 'admin'), getSuperAdminPendingDisbursements);
router.get('/admin/disbursements/history', protect, authorize('super_admin', 'admin'), getSuperAdminDisbursementHistory);
router.get('/admin/districts-summary', protect, authorize('super_admin', 'admin'), getSuperAdminDistrictSummary);
router.get('/admin/all', protect, authorize('super_admin', 'admin'), getSuperAdminAllLoanApplications);

// EMI Collection & Reporting Routes
router.get('/admin/emi/dashboard', protect, authorize('super_admin', 'admin'), getSuperAdminEmiDashboard);
router.get('/admin/emi/installments', protect, authorize('super_admin', 'admin'), getSuperAdminAllEmis);
router.post('/admin/emi/collect', protect, authorize('super_admin', 'admin'), superAdminCollectEmiPayment);
router.get('/admin/emi/reports', protect, authorize('super_admin', 'admin'), getSuperAdminEmiReports);

// Dynamic Loan Policy & Settings Configuration
router.get('/admin/settings', protect, authorize('super_admin', 'admin'), getLoanSettings);
router.put('/admin/settings', protect, authorize('super_admin', 'admin'), updateLoanSettings);

router.get('/admin/:id', protect, authorize('super_admin', 'admin'), getSuperAdminLoanApplicationById);
router.post('/admin/:id/final-approval', protect, authorize('super_admin', 'admin'), superAdminProcessLoanDecision);
router.post('/admin/:id/disburse', protect, authorize('super_admin', 'admin'), superAdminDisburseLoan);

module.exports = router;

