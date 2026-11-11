const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const District = require('../models/District');
const LoanApplication = require('../models/LoanApplication');
const Member = require('../models/Member');
const Application = require('../models/Application');
const Payment = require('../models/Payment');
const Referral = require('../models/Referral');
const Commission = require('../models/Commission');
const { sendDistrictAdminWelcomeEmail } = require('../utils/sendEmail');

/**
 * Helper to generate a secure temporary password
 */
const generateTemporaryPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let randomStr = '';
  for (let i = 0; i < 6; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `Utkal@${randomStr}!`;
};

/**
 * @desc    Get all District Admins with summary stats
 * @route   GET /api/district-admins
 * @access  Private (Super Admin)
 */
const getDistrictAdmins = async (req, res) => {
  try {
    const { search, status, districtId } = req.query;

    const query = { role: 'district_admin' };

    if (status && status !== 'All') {
      query.status = status.toLowerCase();
    }

    if (districtId && districtId !== 'All') {
      query.districtId = districtId;
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      query.$or = [
        { name: regex },
        { email: regex },
        { mobile: regex },
        { username: regex },
        { assignedDistrict: regex },
      ];
    }

    const admins = await User.find(query)
      .select('-password')
      .populate('districtId', 'name code state address contactNumber email')
      .sort({ createdAt: -1 })
      .lean();

    // Summary calculations
    const allAdmins = await User.find({ role: 'district_admin' }).lean();
    const totalDistrictAdmins = allAdmins.length;
    const activeDistrictAdmins = allAdmins.filter((a) => a.status === 'active').length;
    const inactiveDistrictAdmins = allAdmins.filter((a) => a.status === 'inactive').length;
    const assignedDistricts = new Set(
      allAdmins.map((a) => (a.districtId ? a.districtId.toString() : null)).filter(Boolean)
    ).size;

    return res.status(200).json({
      success: true,
      count: admins.length,
      summary: {
        totalDistrictAdmins,
        activeDistrictAdmins,
        inactiveDistrictAdmins,
        assignedDistricts,
      },
      admins: admins.map((admin) => ({
        id: admin._id,
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        mobile: admin.mobile,
        username: admin.username || admin.email.split('@')[0],
        role: admin.role,
        status: admin.status,
        districtId: admin.districtId?._id || admin.districtId,
        assignedDistrict: admin.districtId?.name || admin.assignedDistrict || 'Unassigned',
        districtCode: admin.districtId?.code || '',
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching district admins:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch district admins',
    });
  }
};

/**
 * @desc    Get single District Admin details
 * @route   GET /api/district-admins/:id
 * @access  Private (Super Admin)
 */
const getDistrictAdminById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Admin ID' });
    }

    const admin = await User.findOne({ _id: id, role: 'district_admin' })
      .select('-password')
      .populate('districtId')
      .lean();

    if (!admin) {
      return res.status(404).json({ success: false, message: 'District Admin not found' });
    }

    // Live counts for this district's loan applications
    const districtFilter = {
      $or: [
        ...(admin.districtId ? [{ districtId: admin.districtId._id }] : []),
        ...(admin.assignedDistrict ? [{ district: new RegExp(`^${admin.assignedDistrict}$`, 'i') }] : []),
      ],
    };

    const [totalLoans, pendingVerifications, verifiedLoans] = await Promise.all([
      LoanApplication.countDocuments(districtFilter),
      LoanApplication.countDocuments({
        ...districtFilter,
        status: { $in: ['Pending District Verification', 'Under Verification'] },
      }),
      LoanApplication.countDocuments({
        ...districtFilter,
        status: { $in: ['Forwarded to Super Admin', 'Pending Final Approval', 'Approved', 'Disbursed'] },
      }),
    ]);

    return res.status(200).json({
      success: true,
      admin: {
        id: admin._id,
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        mobile: admin.mobile,
        username: admin.username || admin.email.split('@')[0],
        role: admin.role,
        status: admin.status,
        districtId: admin.districtId?._id || null,
        assignedDistrict: admin.districtId?.name || admin.assignedDistrict || 'Unassigned',
        districtDetails: admin.districtId || null,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
        stats: {
          totalLoans,
          pendingVerifications,
          verifiedLoans,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching district admin details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch district admin details',
    });
  }
};

/**
 * @desc    Create new District Admin account
 * @route   POST /api/district-admins
 * @access  Private (Super Admin)
 */
const createDistrictAdmin = async (req, res) => {
  try {
    const { name, email, mobile, username, districtId, status, customPassword } = req.body;

    // 1. Basic Validations
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Full Name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    if (!mobile || !mobile.trim()) {
      return res.status(400).json({ success: false, message: 'Mobile number is required' });
    }

    const cleanMobile = mobile.trim().replace(/\D/g, '');
    if (cleanMobile.length < 10) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number' });
    }

    if (!districtId) {
      return res.status(400).json({ success: false, message: 'Assigned District is required' });
    }

    // 2. Validate District existence (by ObjectId or string name)
    let district = null;
    if (mongoose.Types.ObjectId.isValid(districtId)) {
      district = await District.findById(districtId);
    }
    if (!district) {
      district = await District.findOne({ name: new RegExp(`^${districtId.trim()}$`, 'i') });
    }

    if (!district) {
      return res.status(404).json({ success: false, message: 'Selected District does not exist in registry' });
    }

    // 3. Username generation / formatting
    let cleanUsername = (username || cleanEmail.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .trim();

    if (!cleanUsername) {
      cleanUsername = `admin.${district.name.toLowerCase().replace(/\s+/g, '')}`;
    }

    // 4. Duplicate checks
    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'A user account with this email address already exists',
      });
    }

    const existingUsername = await User.findOne({ username: cleanUsername });
    if (existingUsername) {
      // Auto-append short random suffix if generated username collided
      cleanUsername = `${cleanUsername}${Math.floor(100 + Math.random() * 900)}`;
    }

    const existingMobile = await User.findOne({ mobile: cleanMobile });
    if (existingMobile) {
      return res.status(400).json({
        success: false,
        message: 'A user account with this mobile number already exists',
      });
    }

    // 5. Password handling (generate secure temporary password or use custom)
    const rawPassword = customPassword && customPassword.trim().length >= 6
      ? customPassword.trim()
      : generateTemporaryPassword();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    // 6. Create User record
    const newAdmin = new User({
      name: name.trim(),
      email: cleanEmail,
      mobile: cleanMobile,
      username: cleanUsername,
      password: hashedPassword,
      role: 'district_admin',
      status: status === 'inactive' ? 'inactive' : 'active',
      districtId: district._id,
      assignedDistrict: district.name,
      mustChangePassword: true,
    });

    await newAdmin.save();

    // 7. Update District's assignedAdmin field
    district.assignedAdmin = {
      name: newAdmin.name,
      email: newAdmin.email,
      phone: newAdmin.mobile,
      userId: newAdmin._id,
      assignedAt: new Date(),
    };
    district.lastUpdatedBy = req.user?.name || 'Super Admin';
    await district.save();

    // 8. Dispatch login instructions and credentials email in background via Nodemailer
    setImmediate(async () => {
      try {
        console.log(`[District Admin] Dispatching welcome email with login instructions to: ${newAdmin.email}`);
        await sendDistrictAdminWelcomeEmail({
          email: newAdmin.email,
          name: newAdmin.name,
          username: newAdmin.username,
          assignedDistrict: district.name,
          tempPassword: rawPassword,
        });
      } catch (mailErr) {
        console.error('[District Admin Welcome Email Error]:', mailErr.message);
      }
    });

    return res.status(201).json({
      success: true,
      message: `District Admin account for ${district.name} created successfully. Login instructions emailed.`,
      temporaryPassword: rawPassword, // returned once for Super Admin display / copy
      admin: {
        id: newAdmin._id,
        _id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
        mobile: newAdmin.mobile,
        username: newAdmin.username,
        role: newAdmin.role,
        status: newAdmin.status,
        districtId: district._id,
        assignedDistrict: district.name,
        createdAt: newAdmin.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating district admin:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create district admin',
    });
  }
};

/**
 * @desc    Update District Admin profile (Name, Mobile, Status)
 * @route   PUT /api/district-admins/:id
 * @access  Private (Super Admin)
 */
const updateDistrictAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Admin ID' });
    }

    const admin = await User.findOne({ _id: id, role: 'district_admin' });
    if (!admin) {
      return res.status(404).json({ success: false, message: 'District Admin not found' });
    }

    if (name && name.trim()) {
      admin.name = name.trim();
    }

    if (mobile && mobile.trim()) {
      const cleanMobile = mobile.trim().replace(/\D/g, '');
      if (cleanMobile.length < 10) {
        return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit mobile number' });
      }
      // Check mobile collision
      const mobileExists = await User.findOne({ mobile: cleanMobile, _id: { $ne: admin._id } });
      if (mobileExists) {
        return res.status(400).json({ success: false, message: 'Mobile number already in use by another account' });
      }
      admin.mobile = cleanMobile;
    }

    if (status && ['active', 'inactive'].includes(status)) {
      admin.status = status;
    }

    await admin.save();

    // Keep District assignedAdmin in sync if assigned
    if (admin.districtId) {
      await District.findByIdAndUpdate(admin.districtId, {
        'assignedAdmin.name': admin.name,
        'assignedAdmin.phone': admin.mobile,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'District Admin updated successfully',
      admin: {
        id: admin._id,
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        mobile: admin.mobile,
        username: admin.username,
        role: admin.role,
        status: admin.status,
        districtId: admin.districtId,
        assignedDistrict: admin.assignedDistrict,
      },
    });
  } catch (error) {
    console.error('Error updating district admin:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update district admin',
    });
  }
};

/**
 * @desc    Change Assigned District for a District Admin
 * @route   PATCH /api/district-admins/:id/reassign-district
 * @access  Private (Super Admin)
 */
const reassignDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    const { newDistrictId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Admin ID' });
    }

    if (!newDistrictId || !mongoose.Types.ObjectId.isValid(newDistrictId)) {
      return res.status(400).json({ success: false, message: 'A valid Target District ID is required' });
    }

    const admin = await User.findOne({ _id: id, role: 'district_admin' });
    if (!admin) {
      return res.status(404).json({ success: false, message: 'District Admin not found' });
    }

    const targetDistrict = await District.findById(newDistrictId);
    if (!targetDistrict) {
      return res.status(404).json({ success: false, message: 'Target District not found' });
    }

    // 1. Release old district assignment if different
    const oldDistrictId = admin.districtId;
    if (oldDistrictId && oldDistrictId.toString() !== newDistrictId.toString()) {
      await District.findByIdAndUpdate(oldDistrictId, {
        assignedAdmin: {
          name: 'Unassigned',
          email: '',
          phone: '',
          userId: null,
          assignedAt: null,
        },
        lastUpdatedBy: req.user?.name || 'Super Admin',
      });
    }

    // 2. Assign to new district
    targetDistrict.assignedAdmin = {
      name: admin.name,
      email: admin.email,
      phone: admin.mobile,
      userId: admin._id,
      assignedAt: new Date(),
    };
    targetDistrict.lastUpdatedBy = req.user?.name || 'Super Admin';
    await targetDistrict.save();

    // 3. Update Admin user record
    admin.districtId = targetDistrict._id;
    admin.assignedDistrict = targetDistrict.name;
    await admin.save();

    return res.status(200).json({
      success: true,
      message: `Admin successfully reassigned to ${targetDistrict.name}`,
      admin: {
        id: admin._id,
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        mobile: admin.mobile,
        districtId: targetDistrict._id,
        assignedDistrict: targetDistrict.name,
        status: admin.status,
      },
    });
  } catch (error) {
    console.error('Error reassigning district admin:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reassign district admin',
    });
  }
};

/**
 * @desc    Toggle District Admin Account Status (Active / Inactive)
 * @route   PATCH /api/district-admins/:id/status
 * @access  Private (Super Admin)
 */
const toggleDistrictAdminStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Admin ID' });
    }

    const admin = await User.findOne({ _id: id, role: 'district_admin' });
    if (!admin) {
      return res.status(404).json({ success: false, message: 'District Admin not found' });
    }

    const nextStatus = status && ['active', 'inactive'].includes(status)
      ? status
      : admin.status === 'active'
      ? 'inactive'
      : 'active';

    admin.status = nextStatus;
    await admin.save();

    return res.status(200).json({
      success: true,
      message: `District Admin account has been ${nextStatus === 'active' ? 'activated' : 'deactivated'}`,
      status: admin.status,
    });
  } catch (error) {
    console.error('Error toggling district admin status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle account status',
    });
  }
};

/**
 * @desc    Reset District Admin Password
 * @route   POST /api/district-admins/:id/reset-password
 * @access  Private (Super Admin)
 */
const resetDistrictAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { customPassword } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Admin ID' });
    }

    const admin = await User.findOne({ _id: id, role: 'district_admin' });
    if (!admin) {
      return res.status(404).json({ success: false, message: 'District Admin not found' });
    }

    const rawPassword = customPassword && customPassword.trim().length >= 6
      ? customPassword.trim()
      : generateTemporaryPassword();

    const salt = await bcrypt.genSalt(10);
    admin.password = await bcrypt.hash(rawPassword, salt);
    admin.mustChangePassword = true;
    await admin.save();

    // Dispatch updated login credentials email in background
    setImmediate(async () => {
      try {
        await sendDistrictAdminWelcomeEmail({
          email: admin.email,
          name: admin.name,
          username: admin.username,
          assignedDistrict: admin.assignedDistrict,
          tempPassword: rawPassword,
        });
      } catch (mailErr) {
        console.error('[District Admin Password Reset Email Error]:', mailErr.message);
      }
    });

    return res.status(200).json({
      success: true,
      message: `Password reset successfully for ${admin.name}. New login instructions emailed.`,
      temporaryPassword: rawPassword,
    });
  } catch (error) {
    console.error('Error resetting district admin password:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reset password',
    });
  }
};

/**
 * =========================================================================
 * DISTRICT ADMIN PERMISSIONS & STRICT LOAN APPLICATION FILTERING
 * Enforced on backend: District Admin can ONLY access their assigned district
 * =========================================================================
 */

/**
 * Helper to construct strict district filter for authenticated user
 */
const getStrictDistrictFilter = (user) => {
  if (user.role === 'admin' || user.role === 'super_admin') {
    return {}; // Super Admin sees all
  }

  if (user.role === 'district_admin') {
    const conditions = [];
    if (user.districtId) {
      conditions.push({ districtId: user.districtId });
    }
    if (user.assignedDistrict) {
      conditions.push({ district: new RegExp(`^${user.assignedDistrict.trim()}$`, 'i') });
    }
    if (conditions.length === 0) {
      // If unassigned, they see nothing
      return { _id: null };
    }
    return { $or: conditions };
  }

  // Other roles not permitted
  return { _id: null };
};

/**
 * Safe helpers to resolve a LoanApplication by either MongoDB _id or applicationId string
 * Prevents CastError when invalid/undefined ID is passed
 */
const resolveLoanByIdOrAppId = async (idOrAppId) => {
  if (!idOrAppId || idOrAppId === 'undefined' || idOrAppId === 'null') {
    return null;
  }
  const cleanId = String(idOrAppId).trim();
  if (!cleanId || cleanId === 'undefined' || cleanId === 'null') {
    return null;
  }
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    const loan = await LoanApplication.findById(cleanId);
    if (loan) return loan;
  }
  return await LoanApplication.findOne({ applicationId: cleanId });
};

const resolveLoanLeanByIdOrAppId = async (idOrAppId) => {
  if (!idOrAppId || idOrAppId === 'undefined' || idOrAppId === 'null') {
    return null;
  }
  const cleanId = String(idOrAppId).trim();
  if (!cleanId || cleanId === 'undefined' || cleanId === 'null') {
    return null;
  }
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    const loan = await LoanApplication.findById(cleanId).lean();
    if (loan) return loan;
  }
  return await LoanApplication.findOne({ applicationId: cleanId }).lean();
};

/**
 * @desc    Get loan applications assigned to authenticated District Admin
 * @route   GET /api/district-admins/assigned-loans
 * @access  Private (District Admin & Super Admin)
 */
const getAssignedLoanApplications = async (req, res) => {
  try {
    const districtFilter = getStrictDistrictFilter(req.user);
    const { status, search } = req.query;

    const query = { ...districtFilter };

    if (status && status !== 'All') {
      query.status = status;
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { applicationId: regex },
            { loanId: regex },
            { memberId: regex },
            { applicantName: regex },
            { email: regex },
            { mobile: regex },
          ],
        },
      ];
    }

    const loans = await LoanApplication.find(query).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      count: loans.length,
      assignedDistrict: req.user.assignedDistrict || 'All',
      loans,
    });
  } catch (error) {
    console.error('Error fetching assigned loan applications:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch assigned loan applications',
    });
  }
};

/**
 * @desc    Get single assigned loan application with customer & KYC docs
 * @route   GET /api/district-admins/assigned-loans/:id
 * @access  Private (District Admin & Super Admin)
 */
const getAssignedLoanApplicationById = async (req, res) => {
  try {
    const rawId = req.params.id || req.query.id || req.query.applicationId;
    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Valid Application ID is required to fetch details',
      });
    }

    const loan = await resolveLoanLeanByIdOrAppId(rawId);

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan application not found' });
    }

    // Backend Authorization: Strict verification that this loan belongs to District Admin's district
    if (req.user.role === 'district_admin') {
      const userDistrictName = (req.user.assignedDistrict || '').toLowerCase().trim();
      const loanDistrictName = (loan.district || '').toLowerCase().trim();
      const matchesName = userDistrictName && loanDistrictName && userDistrictName === loanDistrictName;
      const matchesId = req.user.districtId && loan.districtId && req.user.districtId.toString() === loan.districtId.toString();

      if (!matchesName && !matchesId) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You are not authorized to view loan applications outside your assigned district',
        });
      }
    }

    return res.status(200).json({
      success: true,
      loan,
    });
  } catch (error) {
    console.error('Error fetching loan application details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan application details',
    });
  }
};

/**
 * @desc    District Admin verification action (Verify / Forward / Reject / Hold)
 * @route   POST /api/district-admins/assigned-loans/:id/verify
 * @access  Private (District Admin & Super Admin)
 */
const verifyLoanApplication = async (req, res) => {
  try {
    const rawId = req.params.id || req.body.id || req.body.applicationId;
    const { action, remarks } = req.body; // action: 'verify_and_forward' | 'hold' | 'reject'

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Valid Application ID is required for verification action',
      });
    }

    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan application not found' });
    }

    // Strict district security check
    if (req.user.role === 'district_admin') {
      const userDistrictName = (req.user.assignedDistrict || '').toLowerCase().trim();
      const loanDistrictName = (loan.district || '').toLowerCase().trim();
      const matchesName = userDistrictName && loanDistrictName && userDistrictName === loanDistrictName;
      const matchesId = req.user.districtId && loan.districtId && req.user.districtId.toString() === loan.districtId.toString();

      if (!matchesName && !matchesId) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You cannot verify loan applications outside your assigned district',
        });
      }
    }

    const adminName = req.user.name || 'District Admin';
    const now = new Date();

    if (action === 'verify_and_forward') {
      const adminId = req.user._id && req.user._id !== 'admin-root' ? req.user._id : null;
      loan.districtVerification = {
        status: 'Verified',
        verifiedBy: adminName,
        verifiedById: adminId,
        districtId: req.user.districtId || loan.districtId || null,
        verifiedAt: now,
        decisionDate: now,
        districtRemarks: remarks || 'Verified and forwarded to Super Admin for final approval.',
        rejectionReason: '',
        isForwardedToSuperAdmin: true,
        forwardedToSuperAdminAt: now,
      };
      loan.finalApproval = loan.finalApproval || {};
      loan.finalApproval.status = 'Pending';
      loan.status = 'Pending Final Approval';
      loan.verificationActivities.push({
        action: 'Verified & Forwarded to Super Admin',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: remarks || 'Preliminary verification complete',
      });
    } else if (action === 'hold') {
      loan.districtVerification = {
        status: 'On Hold',
        verifiedBy: adminName,
        verifiedAt: now,
        districtRemarks: remarks || 'Application placed on hold pending document clarification.',
        rejectionReason: '',
      };
      loan.status = 'On Hold';
    } else if (action === 'reject') {
      loan.districtVerification = {
        status: 'Rejected',
        verifiedBy: adminName,
        verifiedAt: now,
        districtRemarks: remarks || 'Application rejected by district administrator.',
        rejectionReason: remarks || 'Eligibility criteria not met during district verification.',
      };
      loan.status = 'Rejected';
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Allowed values: 'verify_and_forward', 'hold', 'reject'",
      });
    }

    await loan.save();

    return res.status(200).json({
      success: true,
      message: `Loan application ${loan.applicationId} status updated to: ${loan.status}`,
      loan,
    });
  } catch (error) {
    console.error('Error verifying loan application:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify loan application',
    });
  }
};

/**
 * @desc    Get complete District Admin Dashboard summary metrics
 * @route   GET /api/district-admins/assigned/summary
 * @access  Private (District Admin & Super Admin)
 */
const getDistrictDashboardSummary = async (req, res) => {
  try {
    const districtFilter = getStrictDistrictFilter(req.user);

    const loans = await LoanApplication.find(districtFilter).sort({ createdAt: -1 }).lean();

    const totalAssigned = loans.length;
    const pendingVerification = loans.filter((l) =>
      ['Submitted', 'Pending District Verification', 'Under Verification'].includes(l.status)
    ).length;

    const documentsVerified = loans.filter((l) => {
      const docs = l.documents || [];
      return (
        docs.length > 0 &&
        docs.every((d) => d.verificationStatus === 'Verified') ||
        l.districtVerification?.status === 'Verified'
      );
    }).length;

    const onHold = loans.filter((l) => l.status === 'On Hold').length;
    const rejected = loans.filter((l) => l.status === 'Rejected').length;
    const forwarded = loans.filter((l) =>
      ['Forwarded to Super Admin', 'Pending Final Approval', 'Approved', 'Disbursed'].includes(l.status)
    ).length;

    const recentApplications = loans.slice(0, 6);
    const pendingApplications = loans
      .filter((l) => ['Submitted', 'Pending District Verification', 'Under Verification', 'On Hold'].includes(l.status))
      .slice(0, 6);

    // Collect recent activities from verificationActivities across loans
    const allActivities = [];
    loans.forEach((l) => {
      const acts = l.verificationActivities || [];
      acts.forEach((act) => {
        allActivities.push({
          applicationId: l.applicationId,
          applicantName: l.applicantName,
          action: act.action,
          performedBy: act.performedBy,
          role: act.role,
          timestamp: act.timestamp,
          notes: act.notes,
        });
      });
    });

    allActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentActivities = allActivities.slice(0, 10);

    return res.status(200).json({
      success: true,
      assignedDistrict: req.user.assignedDistrict || 'Unassigned',
      summary: {
        totalAssigned,
        pendingVerification,
        documentsVerified,
        onHold,
        rejected,
        forwarded,
      },
      recentApplications,
      pendingApplications,
      recentActivities,
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch dashboard summary',
    });
  }
};

/**
 * @desc    Verify individual document in loan application
 * @route   PATCH /api/district-admins/assigned/loans/:id/documents/:docId
 * @access  Private (District Admin & Super Admin)
 */
const verifyDocumentItem = async (req, res) => {
  try {
    const rawId = req.params.id || req.body.id || req.body.applicationId;
    const { docId } = req.params;
    const { verificationStatus, remarks } = req.body;

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Valid Application ID is required to verify documents',
      });
    }

    if (!['Pending', 'Verified', 'Rejected'].includes(verificationStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verificationStatus. Allowed: 'Pending', 'Verified', 'Rejected'",
      });
    }

    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan application not found' });
    }

    // Strict district check
    if (req.user.role === 'district_admin') {
      const userDist = (req.user.assignedDistrict || '').toLowerCase().trim();
      const loanDist = (loan.district || '').toLowerCase().trim();
      const matchesName = userDist && loanDist && userDist === loanDist;
      const matchesId = req.user.districtId && loan.districtId && req.user.districtId.toString() === loan.districtId.toString();
      if (!matchesName && !matchesId) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You cannot verify documents outside your assigned district',
        });
      }
    }

    const doc = loan.documents.id(docId);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document item not found in application' });
    }

    doc.verificationStatus = verificationStatus;
    doc.verificationRemarks = remarks || '';
    doc.verifiedAt = new Date();
    doc.verifiedBy = req.user.name || 'District Admin';

    loan.verificationActivities.push({
      action: `Document ${verificationStatus}: ${doc.documentType || doc.documentName}`,
      performedBy: req.user.name || 'District Admin',
      performedById: req.user._id && req.user._id !== 'admin-root' ? req.user._id : null,
      role: req.user.role || 'district_admin',
      timestamp: new Date(),
      notes: remarks || '',
    });

    // If currently 'Pending District Verification', transition to 'Under Verification'
    if (loan.status === 'Pending District Verification') {
      loan.status = 'Under Verification';
      loan.districtVerification.status = 'Under Verification';
    }

    await loan.save();

    return res.status(200).json({
      success: true,
      message: `Document ${doc.documentType} marked as ${verificationStatus}`,
      document: doc,
      loan,
    });
  } catch (error) {
    console.error('Error verifying document item:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify document item',
    });
  }
};

/**
 * @desc    Verify customer information
 * @route   POST /api/district-admins/assigned/loans/:id/customer-verify
 * @access  Private (District Admin & Super Admin)
 */
const verifyCustomerDetails = async (req, res) => {
  try {
    const rawId = req.params.id || req.body.id || req.body.applicationId;
    const { action, remarks, rejectionReason } = req.body; // 'verify' | 'reject' | 'hold'

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Valid Application ID is required for customer verification',
      });
    }

    if (!['verify', 'reject', 'hold'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Allowed: 'verify', 'reject', 'hold'",
      });
    }

    if ((action === 'reject' || action === 'hold') && !(remarks || rejectionReason)) {
      return res.status(400).json({
        success: false,
        message: `A reason or remark is mandatory when setting customer verification to ${action}`,
      });
    }

    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan application not found' });
    }

    // Strict district check
    if (req.user.role === 'district_admin') {
      const userDist = (req.user.assignedDistrict || '').toLowerCase().trim();
      const loanDist = (loan.district || '').toLowerCase().trim();
      const matchesName = userDist && loanDist && userDist === loanDist;
      const matchesId = req.user.districtId && loan.districtId && req.user.districtId.toString() === loan.districtId.toString();
      if (!matchesName && !matchesId) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You cannot verify customers outside your assigned district',
        });
      }
    }

    const adminName = req.user.name || 'District Admin';
    const adminId = req.user._id && req.user._id !== 'admin-root' ? req.user._id : null;
    const now = new Date();

    if (action === 'verify') {
      loan.customerVerification = {
        status: 'Verified',
        verifiedBy: adminName,
        verifiedAt: now,
        remarks: remarks || 'Customer identity, membership status, and address verified.',
        rejectionReason: '',
      };
      loan.verificationActivities.push({
        action: 'Customer Information Verified',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: remarks || 'Customer verified against statutory registry',
      });
    } else if (action === 'reject') {
      loan.customerVerification = {
        status: 'Rejected',
        verifiedBy: adminName,
        verifiedAt: now,
        remarks: remarks || '',
        rejectionReason: rejectionReason || remarks || 'Customer identity / residency criteria failed',
      };
      loan.status = 'Rejected';
      loan.districtVerification.status = 'Rejected';
      loan.districtVerification.rejectionReason = rejectionReason || remarks;
      loan.verificationActivities.push({
        action: 'Customer Verification Rejected',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: rejectionReason || remarks,
      });
    } else if (action === 'hold') {
      loan.customerVerification = {
        status: 'On Hold',
        verifiedBy: adminName,
        verifiedAt: now,
        remarks: remarks || 'Customer clarification required',
        rejectionReason: '',
      };
      loan.status = 'On Hold';
      loan.districtVerification.status = 'On Hold';
      loan.districtVerification.districtRemarks = remarks;
      loan.verificationActivities.push({
        action: 'Customer Verification Placed On Hold',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: remarks,
      });
    }

    await loan.save();

    return res.status(200).json({
      success: true,
      message: `Customer verification set to ${loan.customerVerification.status}`,
      customerVerification: loan.customerVerification,
      loan,
    });
  } catch (error) {
    console.error('Error verifying customer details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify customer details',
    });
  }
};

/**
 * @desc    Record District Admin decision on application
 * @route   POST /api/district-admins/assigned/loans/:id/decision
 * @access  Private (District Admin & Super Admin)
 */
const recordApplicationDecision = async (req, res) => {
  try {
    const rawId = req.params.id || req.body.id || req.body.applicationId;
    const { decision, remarks } = req.body; // 'verify_and_forward' | 'reject' | 'hold'

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(400).json({
        success: false,
        message: 'Application ID is missing or invalid. A valid application identifier is required.',
      });
    }

    if (!['verify_and_forward', 'reject', 'hold'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "Invalid decision. Allowed: 'verify_and_forward', 'reject', 'hold'",
      });
    }

    if ((decision === 'reject' || decision === 'hold') && !remarks) {
      return res.status(400).json({
        success: false,
        message: `Remarks / justification are mandatory when decision is ${decision}`,
      });
    }

    const loan = await resolveLoanByIdOrAppId(rawId);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: `Loan application not found for ID: ${rawId}`,
      });
    }

    // Strict district check
    if (req.user.role === 'district_admin') {
      const userDist = (req.user.assignedDistrict || '').toLowerCase().trim();
      const loanDist = (loan.district || '').toLowerCase().trim();
      const matchesName = userDist && loanDist && userDist === loanDist;
      const matchesId = req.user.districtId && loan.districtId && req.user.districtId.toString() === loan.districtId.toString();
      if (!matchesName && !matchesId) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You cannot process loan applications outside your assigned district',
        });
      }
    }

    const adminName = req.user.name || 'District Admin';
    const adminId = req.user._id && req.user._id !== 'admin-root' ? req.user._id : null;
    const now = new Date();

    if (decision === 'verify_and_forward') {
      loan.status = 'Pending Final Approval';
      loan.districtVerification = {
        status: 'Verified',
        verifiedBy: adminName,
        verifiedById: adminId,
        districtId: req.user.districtId || loan.districtId || null,
        verifiedAt: now,
        decisionDate: now,
        districtRemarks: remarks || 'Preliminary district verification complete. Forwarded to Super Admin for final sanction.',
        rejectionReason: '',
        isForwardedToSuperAdmin: true,
        forwardedToSuperAdminAt: now,
      };
      loan.finalApproval = loan.finalApproval || {};
      loan.finalApproval.status = 'Pending';
      loan.verificationActivities.push({
        action: 'Verified & Forwarded to Super Admin',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: remarks || 'Preliminary verification complete',
      });
    } else if (decision === 'reject') {
      loan.status = 'Rejected';
      loan.districtVerification = {
        status: 'Rejected',
        verifiedBy: adminName,
        verifiedById: adminId,
        verifiedAt: now,
        decisionDate: now,
        districtRemarks: remarks,
        rejectionReason: remarks,
        forwardedToSuperAdminAt: null,
      };
      loan.verificationActivities.push({
        action: 'Application Rejected at District Level',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: remarks,
      });
    } else if (decision === 'hold') {
      loan.status = 'On Hold';
      loan.districtVerification = {
        status: 'On Hold',
        verifiedBy: adminName,
        verifiedById: adminId,
        verifiedAt: now,
        decisionDate: now,
        districtRemarks: remarks,
        rejectionReason: '',
        forwardedToSuperAdminAt: null,
      };
      loan.verificationActivities.push({
        action: 'Application Placed On Hold',
        performedBy: adminName,
        performedById: adminId,
        role: req.user.role,
        timestamp: now,
        notes: remarks,
      });
    }

    await loan.save();

    return res.status(200).json({
      success: true,
      message: `Decision recorded. Application ${loan.applicationId} status is now: ${loan.status}`,
      loan,
    });
  } catch (error) {
    console.error('Error recording application decision:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to record application decision',
    });
  }
};

/**
 * @desc    Get comprehensive District Loan Reports
 * @route   GET /api/district-admins/assigned/reports
 * @access  Private (District Admin & Super Admin)
 */
const getDistrictLoanReports = async (req, res) => {
  try {
    const districtFilter = getStrictDistrictFilter(req.user);
    const { startDate, endDate } = req.query;

    const query = { ...districtFilter };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const loans = await LoanApplication.find(query).sort({ createdAt: -1 }).lean();

    // Summary counts
    const totalLoans = loans.length;
    const verifiedLoans = loans.filter((l) =>
      ['Forwarded to Super Admin', 'Pending Final Approval', 'Approved', 'Disbursed'].includes(l.status)
    ).length;
    const pendingLoans = loans.filter((l) =>
      ['Submitted', 'Pending District Verification', 'Under Verification'].includes(l.status)
    ).length;
    const rejectedLoans = loans.filter((l) => l.status === 'Rejected').length;
    const onHoldLoans = loans.filter((l) => l.status === 'On Hold').length;
    const forwardedLoans = loans.filter((l) =>
      ['Forwarded to Super Admin', 'Pending Final Approval'].includes(l.status)
    ).length;

    // Status report breakdown
    const statusCounts = {};
    loans.forEach((l) => {
      const s = l.status || 'Submitted';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    // Tenure report breakdown
    const tenureCounts = { 3: 0, 6: 0, 9: 0, other: 0 };
    const tenureAmounts = { 3: 0, 6: 0, 9: 0, other: 0 };
    loans.forEach((l) => {
      const t = l.preferredTenureMonths;
      const amt = l.requestedAmount || 0;
      if (t === 3 || t === 6 || t === 9) {
        tenureCounts[t] = (tenureCounts[t] || 0) + 1;
        tenureAmounts[t] = (tenureAmounts[t] || 0) + amt;
      } else {
        tenureCounts.other = (tenureCounts.other || 0) + 1;
        tenureAmounts.other = (tenureAmounts.other || 0) + amt;
      }
    });

    // Monthly breakdown
    const monthlyData = {};
    loans.forEach((l) => {
      const date = new Date(l.createdAt);
      const key = `${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()}`;
      if (!monthlyData[key]) {
        monthlyData[key] = { month: key, count: 0, requestedAmount: 0, verifiedCount: 0 };
      }
      monthlyData[key].count += 1;
      monthlyData[key].requestedAmount += l.requestedAmount || 0;
      if (['Forwarded to Super Admin', 'Pending Final Approval', 'Approved', 'Disbursed'].includes(l.status)) {
        monthlyData[key].verifiedCount += 1;
      }
    });

    // Loan amount report
    const totalRequestedAmount = loans.reduce((acc, l) => acc + (l.requestedAmount || 0), 0);
    const totalVerifiedAmount = loans
      .filter((l) => ['Forwarded to Super Admin', 'Pending Final Approval', 'Approved', 'Disbursed'].includes(l.status))
      .reduce((acc, l) => acc + (l.requestedAmount || 0), 0);

    return res.status(200).json({
      success: true,
      assignedDistrict: req.user.assignedDistrict || 'Unassigned',
      summary: {
        totalLoans,
        verifiedLoans,
        pendingLoans,
        rejectedLoans,
        onHoldLoans,
        forwardedLoans,
        totalRequestedAmount,
        totalVerifiedAmount,
      },
      statusReport: statusCounts,
      tenureReport: {
        counts: tenureCounts,
        amounts: tenureAmounts,
      },
      monthlyReport: Object.values(monthlyData),
      loans,
    });
  } catch (error) {
    console.error('Error fetching loan reports:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch loan reports',
    });
  }
};

/**
 * @desc    Get real-time District Admin Notifications
 * @route   GET /api/district-admins/assigned/notifications
 * @access  Private (District Admin & Super Admin)
 */
const getDistrictNotifications = async (req, res) => {
  try {
    const districtFilter = getStrictDistrictFilter(req.user);

    const loans = await LoanApplication.find(districtFilter).sort({ createdAt: -1 }).limit(30).lean();

    const notifications = [];
    const now = Date.now();

    loans.forEach((l) => {
      const createdTime = new Date(l.createdAt).getTime();
      const ageHours = (now - createdTime) / (1000 * 60 * 60);

      // New application notification
      if (ageHours <= 168) {
        notifications.push({
          id: `new-${l._id}`,
          title: 'New Loan Application Assigned',
          message: `${l.applicantName} (${l.memberId}) submitted a loan request for ₹${(l.requestedAmount || 10000).toLocaleString('en-IN')}.`,
          type: 'new_application',
          timestamp: l.createdAt,
          applicationId: l.applicationId,
          loanId: l._id,
        });
      }

      // Pending action notification
      if (['Pending District Verification', 'Under Verification'].includes(l.status)) {
        notifications.push({
          id: `pending-${l._id}`,
          title: 'Application Requires Verification',
          message: `${l.applicationId} - ${l.applicantName} is awaiting physical document & KYC review.`,
          type: 'verification_required',
          timestamp: l.updatedAt || l.createdAt,
          applicationId: l.applicationId,
          loanId: l._id,
        });
      }

      // On Hold notification
      if (l.status === 'On Hold') {
        notifications.push({
          id: `hold-${l._id}`,
          title: 'Application On Hold',
          message: `${l.applicationId} is currently placed on hold. Remark: "${l.districtVerification?.districtRemarks || 'Awaiting documents'}".`,
          type: 'status_update',
          timestamp: l.updatedAt || l.createdAt,
          applicationId: l.applicationId,
          loanId: l._id,
        });
      }

      // Forwarded to Super Admin
      if (['Forwarded to Super Admin', 'Pending Final Approval'].includes(l.status)) {
        notifications.push({
          id: `forwarded-${l._id}`,
          title: 'Forwarded to Super Admin',
          message: `${l.applicationId} has been verified and forwarded to Super Admin for final sanction.`,
          type: 'super_admin_remark',
          timestamp: l.districtVerification?.forwardedToSuperAdminAt || l.updatedAt,
          applicationId: l.applicationId,
          loanId: l._id,
        });
      }
    });

    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({
      success: true,
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    console.error('Error fetching district notifications:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch notifications',
    });
  }
};

/**
 * @desc    Get logged-in District Admin profile
 * @route   GET /api/district-admins/me/profile
 * @access  Private (District Admin)
 */
const getDistrictAdminProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').populate('districtId').lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'Admin user not found' });
    }

    return res.status(200).json({
      success: true,
      profile: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        username: user.username || user.email.split('@')[0],
        role: user.role,
        assignedDistrict: user.districtId?.name || user.assignedDistrict || 'Unassigned',
        districtCode: user.districtId?.code || '',
        districtDetails: user.districtId || null,
        status: user.status,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Error fetching admin profile:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch admin profile',
    });
  }
};

/**
 * @desc    Update District Admin profile (Name, Mobile, Password)
 * @route   PUT /api/district-admins/me/profile
 * @access  Private (District Admin)
 */
const updateDistrictAdminProfile = async (req, res) => {
  try {
    const { name, mobile, currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name && name.trim()) {
      user.name = name.trim();
    }

    if (mobile && mobile.trim()) {
      const cleanMobile = mobile.trim().replace(/\D/g, '');
      if (cleanMobile.length < 10) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number' });
      }
      user.mobile = cleanMobile;
    }

    // Password change verification
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required to change password' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password does not match' });
      }
      if (newPassword.trim().length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
      }
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword.trim(), salt);
      user.mustChangePassword = false;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        username: user.username,
        role: user.role,
        assignedDistrict: user.assignedDistrict,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update profile',
    });
  }
};

/**
 * ============================================================================
 * DISTRICT PARTNER WORKSPACE CONTROLLERS (FINAL CLIENT HANDOVER SPECIFICATION)
 * ============================================================================
 */

/**
 * Robust helper to build case-insensitive regex for district name matching (handles both 'Khurda' and 'Khurda Circle')
 */
const buildDistrictRegex = (assignedDistrict) => {
  if (!assignedDistrict) return null;
  const clean = assignedDistrict.replace(/\s*circle\s*$/i, '').trim();
  if (!clean) return null;
  return new RegExp(`^${clean}(?:\\s+circle)?$`, 'i');
};

/**
 * @desc    Get District Partner Dashboard Summary & Analytics
 * @route   GET /api/district-admins/assigned/partner-summary
 * @access  Private (District Partner / Super Admin)
 */
const getPartnerDashboardSummary = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    const memberDistrictFilter = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { 'addressDetails.district': districtRegex },
        { 'addressDetails.commDistrict': districtRegex },
        { district: districtRegex },
      ],
    };

    const applicationDistrictFilter = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { 'addressDetails.district': districtRegex },
        { 'addressDetails.commDistrict': districtRegex },
      ],
    };

    const districtMembersList = await Member.find(memberDistrictFilter).select('memberId _id').lean();
    const circleMemberIds = districtMembersList.map((m) => m.memberId).filter(Boolean);
    const circleMemberObjIds = districtMembersList.map((m) => m._id);

    const referralDistrictFilter = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { district: districtRegex },
        ...(circleMemberIds.length > 0 ? [{ associateMemberId: { $in: circleMemberIds } }] : []),
        ...(circleMemberObjIds.length > 0 ? [{ associateId: { $in: circleMemberObjIds } }] : []),
      ],
    };

    const commissionDistrictFilter = isSuperAdmin || !districtRegex ? {} : {
      district: districtRegex,
    };

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. Total Associate Members & New
    const totalAssociates = await Member.countDocuments(memberDistrictFilter);
    const newAssociates = await Member.countDocuments({
      ...memberDistrictFilter,
      createdAt: { $gte: thirtyDaysAgo },
    });

    // 2. Referrals & Investor Submissions
    const totalReferrals = await Referral.countDocuments(referralDistrictFilter);
    const investorSubmissions = await Referral.countDocuments({
      ...referralDistrictFilter,
      referralType: 'Investor Submission',
    });

    // 3. Verified District Receipts
    const districtMembers = await Member.find(memberDistrictFilter).select('memberId').lean();
    const memberIds = districtMembers.map((m) => m.memberId).filter(Boolean);

    const paymentFilter = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { memberId: { $in: memberIds } },
        { district: districtRegex },
      ],
    };

    const verifiedPayments = await Payment.find({
      ...paymentFilter,
      status: { $in: ['paid', 'successful'] },
    }).lean();

    const verifiedReceiptsAmount = verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const verifiedReceiptsCount = verifiedPayments.length;

    const pendingPayments = await Payment.find({
      ...paymentFilter,
      status: 'pending',
    }).lean();
    const pendingReceiptsAmount = pendingPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // 4. Pending Document Verification
    const pendingDocVerification = await Application.countDocuments({
      ...applicationDistrictFilter,
      status: { $in: ['pending', 'correction_required'] },
    });

    // 5. Approved & Paid Commission
    const approvedCommissions = await Commission.find({
      ...commissionDistrictFilter,
      status: 'approved',
    }).lean();
    const approvedCommissionTotal = approvedCommissions.reduce((sum, c) => sum + (Number(c.commissionAmount) || 0), 0);

    const paidCommissions = await Commission.find({
      ...commissionDistrictFilter,
      status: 'paid',
    }).lean();
    const paidCommissionTotal = paidCommissions.reduce((sum, c) => sum + (Number(c.commissionAmount) || 0), 0);

    const pendingCommissions = await Commission.find({
      ...commissionDistrictFilter,
      status: 'pending',
    }).lean();
    const pendingCommissionTotal = pendingCommissions.reduce((sum, c) => sum + (Number(c.commissionAmount) || 0), 0);

    // 6. Recent Associate Registrations (5)
    const recentAssociates = await Member.find(memberDistrictFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('memberId name mobile membershipType status joiningDate createdAt addressDetails')
      .lean();

    // 7. Recent Referrals (5)
    const recentReferrals = await Referral.find(referralDistrictFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // 8. Monthly Associate Registration Trend (last 6 months)
    const associateTrendData = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      const year = d.getFullYear();
      const month = d.getMonth();
      const startOfMonth = new Date(year, month, 1);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const count = await Member.countDocuments({
        ...memberDistrictFilter,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      });

      associateTrendData.push({
        month: `${monthNames[month]} ${String(year).slice(-2)}`,
        count,
      });
    }

    // 9. Referral Performance Breakdown
    const referralStatuses = ['New', 'In Process', 'Converted', 'Rejected', 'On Hold'];
    const referralPerformance = {};
    for (const st of referralStatuses) {
      referralPerformance[st] = await Referral.countDocuments({
        ...referralDistrictFilter,
        status: st,
      });
    }

    // 10. Investor Submission Volume
    const investorRecords = await Referral.find({
      ...referralDistrictFilter,
      referralType: 'Investor Submission',
    }).lean();
    const totalInvestorVolume = investorRecords.reduce((sum, r) => sum + (Number(r.investmentAmount) || 0), 0);

    return res.status(200).json({
      success: true,
      assignedDistrict: districtName || 'All Districts',
      summary: {
        totalAssociates,
        newAssociates,
        totalReferrals,
        investorSubmissions,
        verifiedReceiptsAmount,
        verifiedReceiptsCount,
        pendingDocVerification,
        approvedCommission: approvedCommissionTotal,
        paidCommission: paidCommissionTotal,
        pendingCommission: pendingCommissionTotal,
      },
      charts: {
        associateTrend: associateTrendData,
        referralPerformance,
        investorOverview: {
          count: investorSubmissions,
          totalVolume: totalInvestorVolume,
        },
        districtCollection: {
          verifiedAmount: verifiedReceiptsAmount,
          pendingAmount: pendingReceiptsAmount,
          verifiedCount: verifiedReceiptsCount,
          pendingCount: pendingPayments.length,
        },
        commissionOverview: {
          pending: pendingCommissionTotal,
          approved: approvedCommissionTotal,
          paid: paidCommissionTotal,
          total: pendingCommissionTotal + approvedCommissionTotal + paidCommissionTotal,
        },
      },
      recentAssociates,
      recentReferrals,
    });
  } catch (error) {
    console.error('Error fetching partner dashboard summary:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch partner dashboard summary',
    });
  }
};

/**
 * @desc    Get District Associates with Filters & Search
 * @route   GET /api/district-admins/assigned/associates
 * @access  Private (District Partner / Super Admin)
 */
const getDistrictAssociates = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    // Non-destructive idempotent sync: ensure any existing approved or pending applications in MongoDB have their Member document safely initialized without touching existing Member records
    try {
      const allApps = await Application.find({ status: { $in: ['approved', 'pending'] } }).lean();
      for (const app of allApps) {
        const tempMemberId = app.memberId || app.applicationId || `APP-${app._id.toString().slice(-6).toUpperCase()}`;
        const nameParts = [
          app.personalDetails?.title,
          app.personalDetails?.firstName,
          app.personalDetails?.middleName,
          app.personalDetails?.lastName,
        ].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(' ') : app.applicantName || 'Associate Member';
        const email = (app.contactDetails?.email || app.email || `member_${tempMemberId.toLowerCase().replace(/[^a-z0-9]/g, '')}@utkalfinance.com`).toLowerCase().trim();
        const mobile = app.contactDetails?.mobile || app.mobile || '';
        const initialStatus = app.status === 'approved' ? 'active' : 'pending';

        const updateDoc = {
          $setOnInsert: {
            memberId: tempMemberId,
            applicationId: app._id,
            applicationRefId: app.applicationId || app._id.toString(),
            name,
            email,
            mobile,
            membershipType: app.membershipDetails?.membershipType || 'Associate Member',
            status: initialStatus,
            joiningDate: app.reviewedAt || app.submittedAt || app.createdAt || new Date(),
          },
          $set: {
            numberOfShares: app.membershipDetails?.numberOfShares || 10,
            shareValue: app.membershipDetails?.shareValue || 10,
            processingFee: app.membershipDetails?.processingFee || 100,
            totalContribution: app.membershipDetails?.totalContribution || 200,
          },
        };

        if (app.personalDetails && Object.keys(app.personalDetails).length > 0) {
          updateDoc.$set.personalDetails = app.personalDetails;
        }
        if (app.contactDetails && Object.keys(app.contactDetails).length > 0) {
          updateDoc.$set.contactDetails = app.contactDetails;
        }
        if (app.addressDetails && Object.keys(app.addressDetails).length > 0) {
          updateDoc.$set.addressDetails = app.addressDetails;
        }
        if (app.documentDetails && Object.keys(app.documentDetails).length > 0) {
          updateDoc.$set.documentDetails = app.documentDetails;
        }
        if (app.paymentDetails && Object.keys(app.paymentDetails).length > 0) {
          updateDoc.$set.paymentDetails = app.paymentDetails;
        }

        await Member.findOneAndUpdate(
          { $or: [{ applicationId: app._id }, { memberId: tempMemberId }] },
          updateDoc,
          { upsert: true, new: true }
        );
      }
    } catch (syncErr) {
      console.warn('Non-blocking associate member check notice:', syncErr.message);
    }

    const baseFilter = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { 'addressDetails.district': districtRegex },
        { 'addressDetails.commDistrict': districtRegex },
        { district: districtRegex },
      ],
    };

    const { search, status, page = 1, limit = 15 } = req.query;
    const query = { ...baseFilter };

    if (status && status !== 'All') {
      query.status = status.toLowerCase();
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { name: regex },
            { memberId: regex },
            { mobile: regex },
            { email: regex },
          ],
        },
      ];
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const totalCount = await Member.countDocuments(query);
    const associates = await Member.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Summary counts for filter tabs
    const allCount = await Member.countDocuments(baseFilter);
    const activeCount = await Member.countDocuments({ ...baseFilter, status: 'active' });
    const pendingCount = await Member.countDocuments({ ...baseFilter, status: { $in: ['pending', 'inactive'] } });
    const suspendedCount = await Member.countDocuments({ ...baseFilter, status: 'suspended' });

    return res.status(200).json({
      success: true,
      associates,
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      summary: {
        all: allCount,
        active: activeCount,
        pending: pendingCount,
        suspended: suspendedCount,
      },
    });
  } catch (error) {
    console.error('Error fetching district associates:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch associates',
    });
  }
};

/**
 * @desc    Get Detailed Associate Dossier (KYC, Application, Payments, Performance)
 * @route   GET /api/district-admins/assigned/associates/:id
 * @access  Private (District Partner / Super Admin)
 */
const getDistrictAssociateById = async (req, res) => {
  try {
    const { id } = req.params;
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    let member = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      member = await Member.findById(id).lean();
      if (!member) {
        member = await Member.findOne({ applicationId: id }).lean();
      }
    }
    if (!member) {
      member = await Member.findOne({ memberId: id }).lean();
    }
    if (!member) {
      member = await Member.findOne({ applicationRefId: id }).lean();
    }

    if (!member) {
      return res.status(404).json({ success: false, message: 'Associate Member not found' });
    }

    // Strict district check
    if (!isSuperAdmin && districtRegex) {
      const memberDistrict = member.addressDetails?.district || member.addressDetails?.commDistrict || member.district;
      if (!districtRegex.test(memberDistrict || '')) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: This Associate Member belongs to a different district circle.',
        });
      }
    }

    // Populate related Application safely with multi-field fallback
    let application = null;
    try {
      if (member.applicationId && mongoose.Types.ObjectId.isValid(member.applicationId)) {
        application = await Application.findById(member.applicationId).lean();
      }
    } catch (e) {
      // Ignore cast errors
    }

    if (!application) {
      // 1. High-confidence exact queries
      const exactQueries = [];
      if (member.applicationRefId) {
        exactQueries.push({ applicationId: member.applicationRefId });
        exactQueries.push({ applicationNumber: member.applicationRefId });
      }
      if (member.applicationId) {
        exactQueries.push({ applicationId: String(member.applicationId) });
      }
      if (member.memberId) {
        exactQueries.push({ memberId: member.memberId });
      }
      if (member.mobile && member.mobile.length >= 10 && !member.mobile.startsWith('9861000000')) {
        exactQueries.push({ 'contactDetails.mobile': member.mobile.trim() });
        exactQueries.push({ mobile: member.mobile.trim() });
      }

      if (exactQueries.length > 0) {
        application = await Application.findOne({ $or: exactQueries }).sort({ createdAt: -1 }).lean();
      }

      // 2. Secondary non-generic queries
      if (!application) {
        const secondaryQueries = [];
        const isGenericEmail = !member.email || member.email.includes('applicant@utkalfinance.com') || member.email.includes('member_');
        if (member.email && !isGenericEmail) {
          secondaryQueries.push({ 'contactDetails.email': new RegExp(`^${member.email.trim()}$`, 'i') });
          secondaryQueries.push({ email: new RegExp(`^${member.email.trim()}$`, 'i') });
        }
        if (member.name && member.name !== 'Associate Member') {
          const cleanName = member.name.trim();
          secondaryQueries.push({ applicantName: new RegExp(`^${cleanName}$`, 'i') });
          const parts = cleanName.split(' ').filter(Boolean);
          if (parts.length >= 2) {
            secondaryQueries.push({
              'personalDetails.firstName': new RegExp(`^${parts[0]}$`, 'i'),
              'personalDetails.lastName': new RegExp(`^${parts[parts.length - 1]}$`, 'i'),
            });
          }
        }

        if (secondaryQueries.length > 0) {
          application = await Application.findOne({ $or: secondaryQueries }).sort({ createdAt: -1 }).lean();
        }
      }
    }

    // Populate related Payments
    const payments = await Payment.find({
      $or: [
        { memberId: member.memberId },
        { email: member.email },
        ...(member.mobile ? [{ mobile: member.mobile }] : []),
      ],
    }).sort({ date: -1 }).lean();

    // Associate-wise performance (referrals generated by this associate)
    const referrals = await Referral.find({
      $or: [
        { associateId: member._id },
        { associateMemberId: member.memberId },
      ],
    }).sort({ createdAt: -1 }).lean();

    // Robust document extraction combining Member, Application, and Payment records
    const memberDocs = member.documentDetails || member.documents || {};
    const appDocs = application?.documentDetails || application?.documents || {};
    const appPayment = application?.paymentDetails || {};
    const memberPayment = member.paymentDetails || {};

    const idProofUrl =
      memberDocs.idProofUrl ||
      memberDocs.idProof ||
      memberDocs.idProofFile ||
      memberDocs.doc2_govId ||
      member.idProofUrl ||
      appDocs.idProofUrl ||
      appDocs.idProof ||
      appDocs.idProofFile ||
      appDocs.doc2_govId ||
      application?.idProofUrl ||
      application?.idProof ||
      '';

    const addressProofUrl =
      memberDocs.addressProofUrl ||
      memberDocs.addressProof ||
      memberDocs.addressProofFile ||
      memberDocs.doc3_addressProof ||
      member.addressProofUrl ||
      appDocs.addressProofUrl ||
      appDocs.addressProof ||
      appDocs.addressProofFile ||
      appDocs.doc3_addressProof ||
      application?.addressProofUrl ||
      application?.addressProof ||
      '';

    const photoUrl =
      memberDocs.photoUrl ||
      memberDocs.photo ||
      memberDocs.photoFile ||
      memberDocs.doc1_photo ||
      member.photoUrl ||
      appDocs.photoUrl ||
      appDocs.photo ||
      appDocs.photoFile ||
      appDocs.doc1_photo ||
      application?.photoUrl ||
      application?.photo ||
      '';

    const signatureUrl =
      memberDocs.signatureUrl ||
      memberDocs.signature ||
      memberDocs.signatureFile ||
      memberDocs.doc4_signature ||
      member.signatureUrl ||
      appDocs.signatureUrl ||
      appDocs.signature ||
      appDocs.signatureFile ||
      appDocs.doc4_signature ||
      application?.signatureUrl ||
      application?.signature ||
      '';

    const paymentReceiptUrl =
      memberDocs.paymentReceiptUrl ||
      memberPayment.receiptUrl ||
      memberPayment.paymentReceiptUrl ||
      appDocs.paymentReceiptUrl ||
      appPayment.receiptUrl ||
      appPayment.paymentReceiptUrl ||
      payments[0]?.receiptUrl ||
      payments[0]?.receiptFile ||
      application?.paymentReceiptUrl ||
      '';

    const eduCertUrl =
      memberDocs.doc3_eduCert ||
      memberDocs.doc3_eduCertFile ||
      memberDocs.educationCertUrl ||
      appDocs.doc3_eduCert ||
      appDocs.doc3_eduCertFile ||
      appDocs.educationCertUrl ||
      '';

    const birthCertUrl =
      memberDocs.doc4_birthCert ||
      memberDocs.doc4_birthCertFile ||
      memberDocs.birthCertUrl ||
      appDocs.doc4_birthCert ||
      appDocs.doc4_birthCertFile ||
      appDocs.birthCertUrl ||
      '';

    const utilityUrl =
      memberDocs.doc5_utility ||
      memberDocs.doc5_utilityFile ||
      memberDocs.utilityBillUrl ||
      appDocs.doc5_utility ||
      appDocs.doc5_utilityFile ||
      appDocs.utilityBillUrl ||
      '';

    const panDocUrl =
      memberDocs.panCard ||
      memberDocs.panDoc ||
      memberDocs.doc_pan ||
      memberDocs.panFile ||
      appDocs.panCard ||
      appDocs.panDoc ||
      appDocs.doc_pan ||
      appDocs.panFile ||
      '';

    const additionalDocs = [
      ...(Array.isArray(memberDocs.additionalDocuments) ? memberDocs.additionalDocuments : []),
      ...(Array.isArray(appDocs.additionalDocuments) ? appDocs.additionalDocuments : []),
      ...(Array.isArray(member.documents) ? member.documents : []),
      ...(Array.isArray(application?.documents) ? application.documents : []),
    ];

    const enrichedDocumentDetails = {
      ...appDocs,
      ...memberDocs,
      idProofUrl,
      addressProofUrl,
      photoUrl,
      signatureUrl,
      paymentReceiptUrl,
      doc3_eduCert: eduCertUrl,
      doc4_birthCert: birthCertUrl,
      doc5_utility: utilityUrl,
      panCard: panDocUrl,
      idProofType: memberDocs.idProofType || appDocs.idProofType || 'Aadhaar Card',
      addressProofType: memberDocs.addressProofType || appDocs.addressProofType || 'Aadhaar Card',
      additionalDocuments: additionalDocs,
    };

    // Structured documents list for uniform UI rendering
    const documentsList = [];
    const defaultVerification = 'Verified';
    const idType = (enrichedDocumentDetails.idProofType || 'Aadhaar Card').trim();
    const addrType = (enrichedDocumentDetails.addressProofType || 'Aadhaar Card').trim();

    if (photoUrl) {
      documentsList.push({
        id: 'photo',
        documentType: 'Photograph',
        documentName: 'Passport Photograph',
        documentUrl: photoUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (idProofUrl) {
      const isSameAsAddr = addressProofUrl && idProofUrl === addressProofUrl;
      documentsList.push({
        id: 'idproof',
        documentType: isSameAsAddr ? 'Identity & Address Proof' : 'Identity Proof',
        documentName: isSameAsAddr ? `${idType} (Identity & Address Proof)` : `${idType} (Identity Proof)`,
        documentUrl: idProofUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (addressProofUrl && addressProofUrl !== idProofUrl) {
      documentsList.push({
        id: 'addressproof',
        documentType: 'Address Proof',
        documentName: `${addrType} (Address Proof)`,
        documentUrl: addressProofUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (signatureUrl) {
      documentsList.push({
        id: 'signature',
        documentType: 'Specimen Signature',
        documentName: 'Digital Signature Specimen',
        documentUrl: signatureUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (paymentReceiptUrl) {
      documentsList.push({
        id: 'paymentReceipt',
        documentType: 'Payment Receipt',
        documentName: '₹200 Statutory Membership Payment Receipt',
        documentUrl: paymentReceiptUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (eduCertUrl) {
      documentsList.push({
        id: 'eduCert',
        documentType: 'Educational Certificate',
        documentName: 'Educational Degree / Certificate',
        documentUrl: eduCertUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (birthCertUrl) {
      documentsList.push({
        id: 'birthCert',
        documentType: 'Birth / Age Proof',
        documentName: 'Birth / Age / Identity Certificate',
        documentUrl: birthCertUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (utilityUrl) {
      documentsList.push({
        id: 'utilityDoc',
        documentType: 'Utility Document',
        documentName: 'Electricity Bill / Bank Passbook',
        documentUrl: utilityUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (panDocUrl) {
      documentsList.push({
        id: 'panDoc',
        documentType: 'PAN Card Document',
        documentName: 'Permanent Account Number (PAN) Card',
        documentUrl: panDocUrl,
        verificationStatus: defaultVerification,
      });
    }

    if (Array.isArray(additionalDocs)) {
      additionalDocs.forEach((addDoc, idx) => {
        const rawUrl = addDoc?.documentUrl || addDoc?.url || addDoc?.file || '';
        if (rawUrl && !documentsList.some((d) => d.documentUrl === rawUrl)) {
          documentsList.push({
            id: addDoc._id ? addDoc._id.toString() : `add-${idx}`,
            documentType: addDoc.documentType || 'Additional Document',
            documentName: addDoc.documentName || addDoc.documentType || 'Supporting Document',
            documentUrl: rawUrl,
            verificationStatus: defaultVerification,
          });
        }
      });
    }

    const memberPersonal = member.personalDetails || {};
    const appPersonal = application?.personalDetails || {};
    const appNominee = application?.nomineeDetails || {};

    const enrichedPersonalDetails = {
      ...appPersonal,
      ...memberPersonal,
      fatherLegalName:
        memberPersonal.fatherLegalName ||
        memberPersonal.fatherName ||
        memberPersonal.guardianName ||
        member.fatherLegalName ||
        member.fatherName ||
        appPersonal.fatherLegalName ||
        appPersonal.fatherName ||
        appPersonal.guardianName ||
        appNominee.guardianName ||
        '',
      dob:
        memberPersonal.dob ||
        memberPersonal.dateOfBirth ||
        memberPersonal.birthDate ||
        member.dob ||
        appPersonal.dob ||
        appPersonal.dateOfBirth ||
        '',
      age:
        memberPersonal.age ||
        member.age ||
        appPersonal.age ||
        '',
      gender:
        memberPersonal.gender ||
        memberPersonal.sex ||
        member.gender ||
        appPersonal.gender ||
        '',
      maritalStatus:
        memberPersonal.maritalStatus ||
        memberPersonal.marital ||
        member.maritalStatus ||
        appPersonal.maritalStatus ||
        '',
      pan:
        memberPersonal.pan ||
        memberPersonal.panNumber ||
        memberPersonal.panCard ||
        member.pan ||
        member.panNumber ||
        appPersonal.pan ||
        appPersonal.panNumber ||
        application?.pan ||
        (memberDocs.idProofType === 'PAN Card' ? (memberDocs.idProofNumber || member.idProofNumber) : '') ||
        (appDocs.idProofType === 'PAN Card' ? (appDocs.idProofNumber || application?.idProofNumber) : '') ||
        '',
      education: memberPersonal.education || appPersonal.education || '',
      religion: memberPersonal.religion || appPersonal.religion || '',
      category: memberPersonal.category || appPersonal.category || '',
      occupation: memberPersonal.occupation || appPersonal.occupation || '',
    };

    // Non-blocking sync back to Member record in MongoDB to preserve enriched state
    if (application && (!member.personalDetails?.fatherLegalName || !member.documentDetails?.idProofUrl)) {
      Member.updateOne(
        { _id: member._id },
        {
          $set: {
            personalDetails: enrichedPersonalDetails,
            documentDetails: enrichedDocumentDetails,
            ...(application.addressDetails && !member.addressDetails?.address1 ? { addressDetails: application.addressDetails } : {}),
            ...(application.contactDetails && !member.contactDetails?.mobile ? { contactDetails: application.contactDetails } : {}),
          },
        }
      ).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      associate: {
        ...member,
        documentDetails: enrichedDocumentDetails,
        documents: documentsList,
        personalDetails: enrichedPersonalDetails,
      },
      application,
      payments,
      performance: {
        totalReferrals: referrals.length,
        convertedReferrals: referrals.filter((r) => r.status === 'Converted').length,
        investorSubmissions: referrals.filter((r) => r.referralType === 'Investor Submission').length,
        referrals,
      },
    });
  } catch (error) {
    console.error('Error fetching associate details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch associate details',
    });
  }
};

/**
 * @desc    Update Associate Membership Status (Active, Pending, Suspended)
 * @route   PATCH /api/district-admins/assigned/associates/:id/status
 * @access  Private (District Partner / Super Admin)
 */
const updateAssociateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;

    if (!['active', 'pending', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid membership status. Allowed: active, pending, suspended' });
    }

    let member = await Member.findById(id);
    if (!member) {
      member = await Member.findOne({ memberId: id });
    }
    if (!member) {
      return res.status(404).json({ success: false, message: 'Associate Member not found' });
    }

    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(req.user?.assignedDistrict);

    if (!isSuperAdmin && districtRegex) {
      const memberDistrict = member.addressDetails?.district || member.addressDetails?.commDistrict || member.district;
      if (!districtRegex.test(memberDistrict || '')) {
        return res.status(403).json({ success: false, message: 'Access Denied: District mismatch' });
      }
    }

    member.status = status;
    await member.save();

    // If User record exists, sync status
    if (member.userId) {
      await User.findByIdAndUpdate(member.userId, { status: status === 'active' ? 'active' : 'inactive' }).catch(() => {});
    }

    // If linked Application record exists, synchronize status
    if (member.applicationId) {
      const appStatus = status === 'active' ? 'approved' : status === 'pending' ? 'pending' : 'rejected';
      await Application.updateOne({ _id: member.applicationId }, { $set: { status: appStatus } }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: `Associate status updated to ${status}`,
      associate: member,
    });
  } catch (error) {
    console.error('Error updating associate status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update associate status',
    });
  }
};

/**
 * @desc    Get District Referrals with Statistics & Filters
 * @route   GET /api/district-admins/assigned/referrals
 * @access  Private (District Partner / Super Admin)
 */
const getDistrictReferrals = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    let baseFilter = {};
    if (!isSuperAdmin && districtRegex) {
      // Find associates registered in this district circle
      const circleAssociates = await Member.find({
        $or: [
          { 'addressDetails.district': districtRegex },
          { 'addressDetails.commDistrict': districtRegex },
          { district: districtRegex },
        ],
      }).select('memberId _id').lean();

      const assocIds = circleAssociates.map((a) => a.memberId).filter(Boolean);
      const assocObjIds = circleAssociates.map((a) => a._id);

      baseFilter = {
        $or: [
          { district: districtRegex },
          ...(assocIds.length > 0 ? [{ associateMemberId: { $in: assocIds } }] : []),
          ...(assocObjIds.length > 0 ? [{ associateId: { $in: assocObjIds } }] : []),
        ],
      };
    }

    const { search, status, type } = req.query;
    const query = { ...baseFilter };

    if (status && status !== 'All') {
      query.status = status;
    }
    if (type && type !== 'All') {
      query.referralType = type;
    }
    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      const searchConditions = [
        { customerName: regex },
        { mobile: regex },
        { email: regex },
        { referralId: regex },
        { associateName: regex },
        { associateMemberId: regex },
        { referralCode: regex },
      ];

      if (baseFilter.$or) {
        query.$and = [{ $or: baseFilter.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    const referrals = await Referral.find(query).sort({ createdAt: -1 }).lean();

    const totalReferrals = await Referral.countDocuments(baseFilter);
    const convertedCount = await Referral.countDocuments({ ...baseFilter, status: 'Converted' });
    const inProcessCount = await Referral.countDocuments({ ...baseFilter, status: 'In Process' });
    const newCount = await Referral.countDocuments({ ...baseFilter, status: 'New' });
    const investorCount = await Referral.countDocuments({ ...baseFilter, referralType: 'Investor Submission' });

    return res.status(200).json({
      success: true,
      referrals,
      stats: {
        total: totalReferrals,
        converted: convertedCount,
        inProcess: inProcessCount,
        new: newCount,
        investorCount,
      },
    });
  } catch (error) {
    console.error('Error fetching district referrals:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch referrals',
    });
  }
};

/**
 * @desc    Create a New Referral in District Circle
 * @route   POST /api/district-admins/assigned/referrals
 * @access  Private (District Partner / Super Admin)
 */
const createDistrictReferral = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const {
      customerName,
      mobile,
      email,
      address,
      referralType = 'Member Registration',
      investmentAmount = 0,
      tenureMonths = 12,
      associateMemberId,
      associateName,
      notes,
    } = req.body;

    if (!customerName || !mobile) {
      return res.status(400).json({ success: false, message: 'Customer Name and Mobile are required' });
    }

    const count = await Referral.countDocuments();
    const prefix = districtName ? districtName.slice(0, 3).toUpperCase() : 'REF';
    const referralId = `REF-${prefix}-${String(count + 1).padStart(4, '0')}`;

    const newReferral = new Referral({
      referralId,
      district: districtName || 'Khurda',
      districtId: req.user?.districtId || null,
      districtPartnerId: req.user?._id || null,
      associateMemberId: associateMemberId || '',
      associateName: associateName || '',
      customerName: customerName.trim(),
      mobile: mobile.trim(),
      email: email ? email.trim() : '',
      address: address ? address.trim() : '',
      referralType,
      investmentAmount: Number(investmentAmount) || 0,
      tenureMonths: Number(tenureMonths) || 12,
      status: 'New',
      notes: notes ? notes.trim() : '',
      createdBy: req.user?.name || 'District Partner',
    });

    await newReferral.save();

    return res.status(201).json({
      success: true,
      message: 'Referral registered successfully',
      referral: newReferral,
    });
  } catch (error) {
    console.error('Error creating referral:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create referral',
    });
  }
};

/**
 * @desc    Update Referral Status & Notes
 * @route   PATCH /api/district-admins/assigned/referrals/:id/status
 * @access  Private (District Partner / Super Admin)
 */
const updateDistrictReferralStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const referral = await Referral.findById(id);
    if (!referral) {
      return res.status(404).json({ success: false, message: 'Referral record not found' });
    }

    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(req.user?.assignedDistrict);

    if (!isSuperAdmin && districtRegex && !districtRegex.test(referral.district || '')) {
      return res.status(403).json({ success: false, message: 'Access Denied: District mismatch' });
    }

    referral.status = status;
    if (notes) referral.notes = notes;
    if (status === 'Converted') {
      referral.convertedAt = new Date();
    }
    await referral.save();

    return res.status(200).json({
      success: true,
      message: `Referral status updated to ${status}`,
      referral,
    });
  } catch (error) {
    console.error('Error updating referral status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update referral status',
    });
  }
};

/**
 * @desc    Get District Financial Records (Own Membership, Associate Payments, Transactions, Commissions, Payouts)
 * @route   GET /api/district-admins/assigned/financial-records
 * @access  Private (District Partner / Super Admin)
 */
const getDistrictFinancialRecords = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    // 1. Own Membership record for District Partner
    const ownUser = await User.findById(req.user?._id).select('-password').lean();

    // 2. Associate Membership Payments
    const districtMembers = await Member.find(
      isSuperAdmin || !districtRegex ? {} : {
        $or: [
          { 'addressDetails.district': districtRegex },
          { 'addressDetails.commDistrict': districtRegex },
          { district: districtRegex },
        ],
      }
    ).select('memberId name mobile').lean();

    const memberIds = districtMembers.map((m) => m.memberId).filter(Boolean);
    const memberNameMap = {};
    districtMembers.forEach((m) => {
      memberNameMap[m.memberId] = m.name;
    });

    const paymentQuery = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { memberId: { $in: memberIds } },
        { district: districtRegex },
      ],
    };

    const associatePayments = await Payment.find(paymentQuery)
      .sort({ date: -1 })
      .lean();

    // Format associate payments
    const formattedAssociatePayments = associatePayments.map((p) => ({
      ...p,
      associateName: p.memberName || memberNameMap[p.memberId] || 'Associate Member',
      verificationStatus: p.status === 'paid' || p.status === 'successful' ? 'Verified' : (p.status === 'failed' ? 'Rejected' : 'Pending Verification'),
      reconciliationStatus: p.status === 'paid' || p.status === 'successful' ? 'Reconciled' : 'Pending Reconciliation',
    }));

    // 3. District Transaction History
    const districtTransactions = formattedAssociatePayments.map((p, idx) => ({
      id: p._id,
      transactionId: p.transactionId || p.paymentId || `TXN-${String(idx + 1).padStart(5, '0')}`,
      associateName: p.associateName,
      paymentCategory: p.purpose || 'Statutory Membership & Share Capital (10 Shares)',
      amount: p.amount || 200,
      paymentDate: p.date || p.createdAt,
      utrNumber: p.utrNo || 'Awaiting UTR',
      verificationStatus: p.verificationStatus,
      reconciliationStatus: p.reconciliationStatus,
      receiptUrl: p.receiptUrl,
      verifiedBy: p.verifiedBy || (p.status === 'paid' ? 'Administration' : 'Pending'),
    }));

    // 4. Approved Commission Statement
    const approvedCommissions = await Commission.find({
      ...(isSuperAdmin || !districtRegex ? {} : { district: districtRegex }),
      status: 'approved',
    }).sort({ approvedAt: -1 }).lean();

    // 5. Payout History
    const payoutHistory = await Commission.find({
      ...(isSuperAdmin || !districtRegex ? {} : { district: districtRegex }),
      status: 'paid',
    }).sort({ paidAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      assignedDistrict: districtName,
      ownMembership: {
        name: ownUser?.name || 'District Partner',
        email: ownUser?.email,
        mobile: ownUser?.mobile,
        partnerId: ownUser?.username || `DP-${districtName ? districtName.slice(0, 3).toUpperCase() : 'OD'}-001`,
        assignedDistrict: districtName,
        status: ownUser?.status || 'Active',
        role: 'District Partner',
        admittedDate: ownUser?.createdAt,
      },
      associatePayments: formattedAssociatePayments,
      districtTransactions,
      approvedCommissions,
      payoutHistory,
    });
  } catch (error) {
    console.error('Error fetching district financial records:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch financial records',
    });
  }
};

/**
 * @desc    Get District Commission Summary & Ledgers
 * @route   GET /api/district-admins/assigned/commissions
 * @access  Private (District Partner / Super Admin)
 */
const getDistrictCommissions = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    const baseFilter = isSuperAdmin || !districtRegex ? {} : { district: districtRegex };

    const commissions = await Commission.find(baseFilter).sort({ createdAt: -1 }).lean();

    const pendingTotal = commissions.filter((c) => c.status === 'pending').reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const approvedTotal = commissions.filter((c) => c.status === 'approved').reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const paidTotal = commissions.filter((c) => c.status === 'paid').reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const totalCommission = pendingTotal + approvedTotal + paidTotal;

    const associateLedger = commissions.filter((c) => c.beneficiaryRole === 'Associate Member');
    const partnerLedger = commissions.filter((c) => c.beneficiaryRole === 'District Partner');
    const paymentHistory = commissions.filter((c) => c.status === 'paid');

    return res.status(200).json({
      success: true,
      summary: {
        total: totalCommission,
        pending: pendingTotal,
        approved: approvedTotal,
        paid: paidTotal,
      },
      associateLedger,
      partnerLedger,
      paymentHistory,
      allCommissions: commissions,
    });
  } catch (error) {
    console.error('Error fetching district commissions:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch commissions',
    });
  }
};

/**
 * @desc    Generate District Partner Reports (Periods & Categories with Working Export Data)
 * @route   GET /api/district-admins/assigned/partner-reports
 * @access  Private (District Partner / Super Admin)
 */
const getDistrictPartnerReports = async (req, res) => {
  try {
    const districtName = (req.user?.assignedDistrict || '').trim();
    const isSuperAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const districtRegex = buildDistrictRegex(districtName);

    const { period = 'monthly', category = 'associate_performance', startDate, endDate } = req.query;

    // Calculate date filter
    const now = new Date();
    let dateFilter = {};

    if (startDate && endDate) {
      dateFilter = { $gte: new Date(startDate), $lte: new Date(endDate) };
    } else if (period === 'daily') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      dateFilter = { $gte: startOfDay };
    } else if (period === 'weekly') {
      const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = { $gte: pastWeek };
    } else if (period === 'monthly') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { $gte: startOfMonth };
    } else if (period === 'yearly') {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      dateFilter = { $gte: startOfYear };
    }

    const memberBase = isSuperAdmin || !districtRegex ? {} : {
      $or: [
        { 'addressDetails.district': districtRegex },
        { 'addressDetails.commDistrict': districtRegex },
        { district: districtRegex },
      ],
    };

    let reportRows = [];
    let reportTotals = {};

    if (category === 'associate_performance') {
      const query = { ...memberBase };
      if (Object.keys(dateFilter).length) query.createdAt = dateFilter;

      const members = await Member.find(query).sort({ createdAt: -1 }).lean();

      reportRows = members.map((m) => ({
        associateId: m.memberId,
        name: m.name,
        mobile: m.mobile,
        category: m.membershipType || 'Associate Member',
        status: m.status,
        joiningDate: m.joiningDate ? new Date(m.joiningDate).toLocaleDateString('en-GB') : '—',
        shares: m.numberOfShares || 10,
        contribution: `₹${m.totalContribution || 200}`,
      }));

      reportTotals = {
        totalAssociates: members.length,
        activeAssociates: members.filter((m) => m.status === 'active').length,
        totalShares: members.reduce((sum, m) => sum + (m.numberOfShares || 10), 0),
        totalCapital: `₹${members.reduce((sum, m) => sum + (m.totalContribution || 200), 0)}`,
      };
    } else if (category === 'district_collection' || category === 'membership_collection') {
      const districtMembers = await Member.find(memberBase).select('memberId').lean();
      const memberIds = districtMembers.map((m) => m.memberId).filter(Boolean);

      const query = {
        ...(isSuperAdmin || !districtRegex ? {} : {
          $or: [
            { memberId: { $in: memberIds } },
            { district: districtRegex },
          ],
        }),
      };
      if (Object.keys(dateFilter).length) query.date = dateFilter;

      const payments = await Payment.find(query).sort({ date: -1 }).lean();

      reportRows = payments.map((p) => ({
        paymentId: p.paymentId,
        memberId: p.memberId,
        memberName: p.memberName,
        amount: `₹${p.amount || 200}`,
        date: p.date ? new Date(p.date).toLocaleDateString('en-GB') : '—',
        utrNo: p.utrNo || 'Awaiting UTR',
        status: p.status,
        method: p.paymentMethod || 'UPI QR',
      }));

      const totalCollectionAmount = payments.filter((p) => p.status === 'paid' || p.status === 'successful').reduce((sum, p) => sum + (p.amount || 0), 0);

      reportTotals = {
        totalTransactions: payments.length,
        verifiedReceipts: payments.filter((p) => p.status === 'paid' || p.status === 'successful').length,
        pendingVerification: payments.filter((p) => p.status === 'pending').length,
        totalCollection: `₹${totalCollectionAmount.toLocaleString('en-IN')}`,
      };
    } else if (category === 'referral_performance') {
      const query = { ...(isSuperAdmin || !districtRegex ? {} : { district: districtRegex }) };
      if (Object.keys(dateFilter).length) query.createdAt = dateFilter;

      const referrals = await Referral.find(query).sort({ createdAt: -1 }).lean();

      reportRows = referrals.map((r) => ({
        referralId: r.referralId,
        customerName: r.customerName,
        mobile: r.mobile,
        type: r.referralType,
        associateName: r.associateName || 'Direct District Partner',
        investmentAmount: r.investmentAmount ? `₹${r.investmentAmount.toLocaleString('en-IN')}` : '—',
        status: r.status,
        date: new Date(r.createdAt).toLocaleDateString('en-GB'),
      }));

      reportTotals = {
        totalReferrals: referrals.length,
        converted: referrals.filter((r) => r.status === 'Converted').length,
        inProcess: referrals.filter((r) => r.status === 'In Process').length,
        totalInvestorVolume: `₹${referrals.reduce((sum, r) => sum + (r.investmentAmount || 0), 0).toLocaleString('en-IN')}`,
      };
    } else if (category === 'commission_statement') {
      const query = { ...(isSuperAdmin || !districtRegex ? {} : { district: districtRegex }) };
      if (Object.keys(dateFilter).length) query.createdAt = dateFilter;

      const commissions = await Commission.find(query).sort({ createdAt: -1 }).lean();

      reportRows = commissions.map((c) => ({
        commissionId: c.commissionId,
        beneficiaryRole: c.beneficiaryRole,
        associateName: c.associateName || 'District Partner',
        category: c.category,
        baseAmount: `₹${c.baseAmount || 0}`,
        amount: `₹${c.commissionAmount || 0}`,
        status: c.status,
        payoutRef: c.payoutRef || '—',
        date: new Date(c.createdAt).toLocaleDateString('en-GB'),
      }));

      reportTotals = {
        totalCommissionRecords: commissions.length,
        approvedTotal: `₹${commissions.filter((c) => c.status === 'approved').reduce((sum, c) => sum + (c.commissionAmount || 0), 0).toLocaleString('en-IN')}`,
        paidTotal: `₹${commissions.filter((c) => c.status === 'paid').reduce((sum, c) => sum + (c.commissionAmount || 0), 0).toLocaleString('en-IN')}`,
        pendingTotal: `₹${commissions.filter((c) => c.status === 'pending').reduce((sum, c) => sum + (c.commissionAmount || 0), 0).toLocaleString('en-IN')}`,
      };
    }

    return res.status(200).json({
      success: true,
      period,
      category,
      district: districtName || 'All Districts',
      totals: reportTotals,
      rows: reportRows,
    });
  } catch (error) {
    console.error('Error generating partner reports:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate partner reports',
    });
  }
};

module.exports = {
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
  // New District Partner endpoints
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
};
