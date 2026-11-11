const express = require('express');
const router = express.Router();
const {
  getDistrictAdmins,
  getDistrictAdminById,
  createDistrictAdmin,
  updateDistrictAdmin,
  reassignDistrict,
  toggleDistrictAdminStatus,
  resetDistrictAdminPassword,
  getAssignedLoanApplications,
  getAssignedLoanApplicationById,
  verifyLoanApplication,
  getDistrictDashboardSummary,
  verifyDocumentItem,
  verifyCustomerDetails,
  recordApplicationDecision,
  getDistrictLoanReports,
  getDistrictNotifications,
  getDistrictAdminProfile,
  updateDistrictAdminProfile,
  getPartnerDashboardSummary,
  getDistrictAssociates,
  getDistrictAssociateById,
  updateAssociateStatus,
  getDistrictReferrals,
  createDistrictReferral,
  updateDistrictReferralStatus,
  getDistrictFinancialRecords,
  getDistrictCommissions,
  getDistrictPartnerReports,
} = require('../controllers/districtAdminController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ============================================================================
// DISTRICT PARTNER WORKSPACE ENDPOINTS (Client Handover Terminology & Features)
// ============================================================================

// Partner Dashboard Summary & Analytics
router.get(
  '/assigned/partner-summary',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getPartnerDashboardSummary
);

// Associate Management Endpoints
router.get(
  '/assigned/associates',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictAssociates
);
router.get(
  '/assigned/associates/:id',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictAssociateById
);
router.patch(
  '/assigned/associates/:id/status',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  updateAssociateStatus
);

// Referral Management Endpoints
router.get(
  '/assigned/referrals',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictReferrals
);
router.post(
  '/assigned/referrals',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  createDistrictReferral
);
router.patch(
  '/assigned/referrals/:id/status',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  updateDistrictReferralStatus
);

// Financial Records
router.get(
  '/assigned/financial-records',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictFinancialRecords
);

// Commission Management
router.get(
  '/assigned/commissions',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictCommissions
);

// Partner Reports & Export Data
router.get(
  '/assigned/partner-reports',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictPartnerReports
);

// ============================================================================
// DISTRICT ADMIN WORKSPACE ENDPOINTS (Strictly Scoped by Authenticated District)
// ============================================================================

// 1. Dashboard summary metrics & recent applications
router.get(
  '/assigned/summary',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictDashboardSummary
);

// 2. Comprehensive district loan reports
router.get(
  '/assigned/reports',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictLoanReports
);

// 3. District notifications
router.get(
  '/assigned/notifications',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictNotifications
);

// 4. District Admin Profile (locked assigned district)
router.get(
  '/me/profile',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getDistrictAdminProfile
);
router.put(
  '/me/profile',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  updateDistrictAdminProfile
);

// 5. Assigned loan applications listing & details
router.get(
  '/assigned/loans',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getAssignedLoanApplications
);
router.get(
  '/assigned/loans/:id',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  getAssignedLoanApplicationById
);

// 6. Document review & verification
router.patch(
  '/assigned/loans/:id/documents/:docId',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  verifyDocumentItem
);

// 7. Customer verification
router.post(
  '/assigned/loans/:id/customer-verify',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  verifyCustomerDetails
);

// 8. Application decisions (verify & forward / reject / hold)
router.post(
  '/assigned/loans/:id/decision',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  recordApplicationDecision
);
router.post(
  '/assigned/loans/:id/verify',
  protect,
  authorize('district_admin', 'super_admin', 'admin'),
  verifyLoanApplication
);

// ============================================================================
// SUPER ADMIN DISTRICT ADMIN MANAGEMENT ENDPOINTS
// ============================================================================
router.get('/', protect, authorize('super_admin', 'admin'), getDistrictAdmins);
router.post('/', protect, authorize('super_admin', 'admin'), createDistrictAdmin);
router.get('/:id', protect, authorize('super_admin', 'admin'), getDistrictAdminById);
router.put('/:id', protect, authorize('super_admin', 'admin'), updateDistrictAdmin);
router.patch('/:id/reassign-district', protect, authorize('super_admin', 'admin'), reassignDistrict);
router.patch('/:id/status', protect, authorize('super_admin', 'admin'), toggleDistrictAdminStatus);
router.post('/:id/reset-password', protect, authorize('super_admin', 'admin'), resetDistrictAdminPassword);

module.exports = router;
