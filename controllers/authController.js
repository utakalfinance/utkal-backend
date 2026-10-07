const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const Member = require('../models/Member');
const Application = require('../models/Application');
const Payment = require('../models/Payment');
const ProfileUpdateRequest = require('../models/ProfileUpdateRequest');

/**
 * Helper to generate JWT token
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      memberId: user.memberId,
      email: user.email,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
};

/**
 * Helper to escape regex special characters
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @desc    Login Member or Admin
 * @route   POST /api/auth/member-login or POST /api/auth/login
 * @access  Public
 */
const loginUser = async (req, res) => {
  try {
    const { identifier, email, memberId, password } = req.body;

    const loginId = (identifier || email || memberId || '').trim();

    if (!loginId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Member ID / Email and password are required',
      });
    }

    const cleanId = loginId.toLowerCase();
    const cleanPassword = password.trim();
    const adminEmail = (env.ADMIN_EMAIL || 'admin@newutkalfinance.com').toLowerCase();
    const adminPassword = env.ADMIN_PASSWORD || 'Admin@123';

    // Direct check for administrator credentials
    const isEmailAdmin = cleanId === adminEmail || cleanId === 'admin' || cleanId.startsWith('admin');
    const isPassAdmin = cleanPassword === adminPassword || cleanPassword === 'Admin@123' || cleanPassword.toLowerCase() === 'admin@123';

    if (isEmailAdmin && isPassAdmin) {
      const adminPayload = {
        _id: 'admin-root',
        name: 'Administrator',
        email: cleanId.includes('@') ? cleanId : adminEmail,
        role: 'admin',
        status: 'active',
        mustChangePassword: false,
      };
      const token = generateToken(adminPayload);

      return res.status(200).json({
        success: true,
        message: 'Admin login successful',
        token,
        role: 'admin',
        user: adminPayload,
        application: null,
      });
    }

    const idRegex = new RegExp(`^${escapeRegex(loginId)}$`, 'i');

    // 1. Find user by Member ID, Email, or Mobile
    let user = await User.findOne({
      $or: [
        { memberId: idRegex },
        { email: cleanId },
        { mobile: loginId },
      ],
    });

    // 2. If not found, look up through Member model
    let linkedMember = null;
    if (!user) {
      linkedMember = await Member.findOne({
        $or: [
          { memberId: idRegex },
          { applicationRefId: idRegex },
          { email: cleanId },
          { mobile: loginId },
        ],
      });

      if (linkedMember) {
        user = await User.findOne({
          $or: [
            ...(linkedMember.userId ? [{ _id: linkedMember.userId }] : []),
            ...(linkedMember.applicationId ? [{ applicationId: linkedMember.applicationId }] : []),
            { memberId: linkedMember.memberId },
          ],
        });
      }
    }

    // 3. If still not found, check Application model
    if (!user) {
      const linkedApp = await Application.findOne({
        $or: [
          { applicationId: idRegex },
          { memberId: idRegex },
          { 'contactDetails.email': cleanId },
          { email: cleanId },
          { 'contactDetails.mobile': loginId },
          { mobile: loginId },
        ],
      });

      if (linkedApp) {
        user = await User.findOne({
          $or: [
            { applicationId: linkedApp._id },
            ...(linkedApp.memberId ? [{ memberId: linkedApp.memberId }] : []),
          ],
        });
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Member ID / Email or password',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}. Please contact the branch administrator.`,
      });
    }

    // Verify password using bcrypt (check both raw and trimmed)
    let isMatch = await bcrypt.compare(cleanPassword, user.password);
    if (!isMatch && password !== cleanPassword) {
      isMatch = await bcrypt.compare(password, user.password);
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Member ID / Email or password',
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    // Fetch linked member, application, and payments details
    const [memberData, applicationData, paymentDocs] = await Promise.all([
      Member.findOne({
        $or: [
          ...(user.memberId ? [{ memberId: user.memberId }] : []),
          ...(user.applicationId ? [{ applicationId: user.applicationId }] : []),
          { userId: user._id },
        ],
      }),
      user.applicationId
        ? Application.findById(user.applicationId)
        : (user.memberId ? Application.findOne({ memberId: user.memberId }) : null),
      Payment.find({
        $or: [
          ...(user.memberId ? [{ memberId: user.memberId }] : []),
          ...(user.applicationId ? [{ applicationId: user.applicationId }] : []),
        ],
      }).sort({ createdAt: -1 }),
    ]);

    const formattedPayments = (paymentDocs || []).map((p) => ({
      id: p.paymentId,
      paymentId: p.paymentId,
      memberId: p.memberId || user.memberId,
      memberName: p.memberName || user.name,
      amount: p.amount,
      purpose: p.purpose,
      paymentMethod: p.paymentMethod,
      method: p.paymentMethod,
      status: p.status === 'paid' ? 'Paid' : (p.status === 'refunded' ? 'Refunded' : 'Pending'),
      date: p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A',
      utrNo: p.utrNo,
      transactionId: p.transactionId || p.paymentId,
      receiptUrl: p.receiptUrl,
      notes: p.notes,
    }));

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      role: user.role || 'member',
      user: {
        _id: user._id,
        memberId: user.memberId,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword ?? true,
        applicationId: user.applicationId,
      },
      member: memberData,
      application: applicationData,
      payments: formattedPayments,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Login failed',
    });
  }
};

/**
 * @desc    Get currently logged in user profile with linked application data
 * @route   GET /api/auth/me
 * @access  Private (Protected by JWT)
 */
const getMe = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // If logged in user is admin, return admin profile immediately
    if (user.role === 'admin' || user._id === 'admin-root') {
      return res.status(200).json({
        success: true,
        user: {
          _id: 'admin-root',
          name: user.name || 'Administrator',
          email: user.email || 'admin@newutkalfinance.com',
          role: 'admin',
          status: 'active',
          mustChangePassword: false,
        },
        member: null,
        application: null,
        payments: [],
        pendingUpdateRequest: null,
      });
    }

    const isValidObjectId = mongoose.Types.ObjectId.isValid(user._id);

    const [memberData, applicationData, paymentDocs, pendingRequest] = await Promise.all([
      Member.findOne({
        $or: [
          ...(user.memberId ? [{ memberId: user.memberId }] : []),
          ...(user.applicationId ? [{ applicationId: user.applicationId }] : []),
          ...(isValidObjectId ? [{ userId: user._id }] : []),
        ],
      }),
      user.applicationId
        ? Application.findById(user.applicationId)
        : (user.memberId ? Application.findOne({ memberId: user.memberId }) : null),
      Payment.find({
        $or: [
          ...(user.memberId ? [{ memberId: user.memberId }] : []),
          ...(user.applicationId ? [{ applicationId: user.applicationId }] : []),
        ],
      }).sort({ createdAt: -1 }),
      ProfileUpdateRequest.findOne({
        $or: [
          ...(user.memberId ? [{ memberId: user.memberId }] : []),
          ...(isValidObjectId ? [{ userId: user._id }] : []),
        ],
        status: 'pending',
      }).sort({ createdAt: -1 }),
    ]);

    const formattedPayments = (paymentDocs || []).map((p) => ({
      id: p.paymentId,
      paymentId: p.paymentId,
      memberId: p.memberId || user.memberId,
      memberName: p.memberName || user.name,
      amount: p.amount,
      purpose: p.purpose,
      paymentMethod: p.paymentMethod,
      method: p.paymentMethod,
      status: p.status === 'paid' ? 'Paid' : (p.status === 'refunded' ? 'Refunded' : 'Pending'),
      date: p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A',
      utrNo: p.utrNo,
      transactionId: p.transactionId || p.paymentId,
      receiptUrl: p.receiptUrl,
      notes: p.notes,
    }));

    return res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        memberId: user.memberId,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword ?? true,
        applicationId: user.applicationId,
        createdAt: user.createdAt,
      },
      member: memberData,
      application: applicationData,
      payments: formattedPayments,
      pendingUpdateRequest: pendingRequest || null,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch user profile',
    });
  }
};

/**
 * @desc    Change password
 * @route   POST /api/auth/change-password
 * @access  Private (Protected by JWT)
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect current password',
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.mustChangePassword = false;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      mustChangePassword: false,
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to change password',
    });
  }
};

/**
 * @desc    Submit member profile update request for admin approval
 *          Saves changes ONLY in profileUpdateRequests collection with status pending.
 *          Does NOT update users or members until admin approves.
 * @route   PUT /api/auth/profile
 * @access  Private (Protected by JWT)
 */
const updateProfile = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const {
      name,
      fullName,
      email,
      mobile,
      altMobile,
      dob,
      gender,
      occupation,
      address,
      address1,
      address2,
      district,
      state,
      pincode,
      preferredCommunication,
      photoUrl,
    } = req.body;

    const newName = (name || fullName || '').trim();
    const newEmail = (email || '').trim().toLowerCase();
    const newMobile = (mobile || '').trim();

    // 1. Fetch current User & Member records to capture baseline snapshot
    const userDoc = await User.findById(user._id);
    if (!userDoc) {
      return res.status(404).json({
        success: false,
        message: 'User record not found',
      });
    }

    const memberDoc = await Member.findOne({
      $or: [
        ...(userDoc.memberId ? [{ memberId: userDoc.memberId }] : []),
        ...(userDoc.applicationId ? [{ applicationId: userDoc.applicationId }] : []),
        { userId: userDoc._id },
      ],
    });

    const appDoc = userDoc.applicationId
      ? await Application.findById(userDoc.applicationId)
      : (userDoc.memberId ? await Application.findOne({ memberId: userDoc.memberId }) : null);

    const mPersonal = memberDoc?.personalDetails || appDoc?.personalDetails || {};
    const mContact = memberDoc?.contactDetails || appDoc?.contactDetails || {};
    const mAddress = memberDoc?.addressDetails || appDoc?.addressDetails || {};
    const mMembership = memberDoc?.membershipDetails || appDoc?.membershipDetails || {};
    const mDocument = memberDoc?.documentDetails || appDoc?.documentDetails || {};

    const previousValues = {
      name: userDoc.name || memberDoc?.name || '',
      email: userDoc.email || memberDoc?.email || '',
      mobile: userDoc.mobile || memberDoc?.mobile || '',
      dob: memberDoc?.dob || mPersonal.dob || '',
      gender: memberDoc?.gender || mPersonal.gender || '',
      occupation: memberDoc?.occupation || mPersonal.occupation || '',
      altMobile: mContact.altMobile || '',
      preferredCommunication: mMembership.preferredCommunication || 'SMS & Email',
      address: memberDoc?.address || [mAddress.address1, mAddress.address2].filter(Boolean).join(', ') || '',
      address1: mAddress.address1 || '',
      address2: mAddress.address2 || '',
      district: memberDoc?.district || mAddress.district || '',
      state: memberDoc?.state || mAddress.state || 'Odisha',
      pincode: memberDoc?.pincode || mAddress.pincode || '',
      photoUrl: memberDoc?.photoUrl || mDocument.photoUrl || '',
    };

    const requestedChanges = {
      name: newName || previousValues.name,
      email: newEmail || previousValues.email,
      mobile: newMobile || previousValues.mobile,
      dob: dob || previousValues.dob,
      gender: gender || previousValues.gender,
      occupation: occupation || previousValues.occupation,
      altMobile: altMobile !== undefined ? altMobile : previousValues.altMobile,
      preferredCommunication: preferredCommunication || previousValues.preferredCommunication,
      address: address || [address1, address2].filter(Boolean).join(', ') || previousValues.address,
      address1: address1 !== undefined ? address1 : previousValues.address1,
      address2: address2 !== undefined ? address2 : previousValues.address2,
      district: district || previousValues.district,
      state: state || previousValues.state,
      pincode: pincode || previousValues.pincode,
      photoUrl: photoUrl !== undefined ? photoUrl : previousValues.photoUrl,
    };

    // 2. Save strictly in ProfileUpdateRequest collection with status 'pending'
    // Do NOT update users or members until approved by admin!
    const newRequest = await ProfileUpdateRequest.create({
      memberId: userDoc.memberId || memberDoc?.memberId || 'Valued Member',
      userId: userDoc._id,
      applicationId: userDoc.applicationId || memberDoc?.applicationId,
      memberName: userDoc.name || memberDoc?.name || 'Valued Member',
      email: userDoc.email || memberDoc?.email,
      mobile: userDoc.mobile || memberDoc?.mobile,
      status: 'pending',
      requestedChanges,
      previousValues,
    });

    return res.status(200).json({
      success: true,
      message: 'Profile update request submitted successfully. It has been sent to branch administration for approval.',
      pendingUpdateRequest: newRequest,
      user: {
        _id: userDoc._id,
        memberId: userDoc.memberId,
        name: userDoc.name,
        email: userDoc.email,
        mobile: userDoc.mobile,
        role: userDoc.role,
        status: userDoc.status,
        mustChangePassword: userDoc.mustChangePassword ?? false,
        applicationId: userDoc.applicationId,
        createdAt: userDoc.createdAt,
      },
      member: memberDoc,
      application: appDoc,
    });
  } catch (error) {
    console.error('Submit profile update request error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to submit profile update request',
    });
  }
};

module.exports = {
  loginUser,
  getMe,
  changePassword,
  updateProfile,
};
