const ProfileUpdateRequest = require('../models/ProfileUpdateRequest');
const User = require('../models/User');
const Member = require('../models/Member');
const Application = require('../models/Application');

/**
 * @desc    Get all member profile update requests
 * @route   GET /api/profile-updates
 * @access  Admin
 */
const getProfileUpdateRequests = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status.toLowerCase();
    }

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term, 'i');
      filter.$or = [
        { memberId: regex },
        { memberName: regex },
        { email: regex },
        { mobile: regex },
      ];
    }

    const requests = await ProfileUpdateRequest.find(filter).sort({ createdAt: -1 });

    const totalCount = await ProfileUpdateRequest.countDocuments();
    const pendingCount = await ProfileUpdateRequest.countDocuments({ status: 'pending' });
    const approvedCount = await ProfileUpdateRequest.countDocuments({ status: 'approved' });
    const rejectedCount = await ProfileUpdateRequest.countDocuments({ status: 'rejected' });

    return res.status(200).json({
      success: true,
      count: requests.length,
      counts: {
        total: totalCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
      data: requests,
    });
  } catch (error) {
    console.error('Error getting profile update requests:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch profile update requests',
    });
  }
};

/**
 * @desc    Get single profile update request by ID
 * @route   GET /api/profile-updates/:id
 * @access  Admin
 */
const getProfileUpdateRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await ProfileUpdateRequest.findById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Profile update request not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: request,
    });
  } catch (error) {
    console.error('Error fetching profile update request:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch request details',
    });
  }
};

/**
 * @desc    Approve profile update request and apply changes to User and Member collections
 * @route   PATCH /api/profile-updates/:id/approve
 * @access  Admin
 */
const approveProfileUpdateRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminRemarks = '', reviewerName = 'Branch Administrator' } = req.body;

    const request = await ProfileUpdateRequest.findById(id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Profile update request not found',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${request.status}.`,
      });
    }

    const { requestedChanges } = request;
    const newName = (requestedChanges.name || '').trim();
    const newEmail = (requestedChanges.email || '').trim().toLowerCase();
    const newMobile = (requestedChanges.mobile || '').trim();
    const {
      dob,
      gender,
      occupation,
      altMobile,
      preferredCommunication,
      address1,
      address2,
      address,
      district,
      state,
      pincode,
      photoUrl,
    } = requestedChanges;

    // 1. Update User document
    let userDoc = null;
    if (request.userId) {
      userDoc = await User.findById(request.userId);
    }
    if (!userDoc && request.memberId) {
      userDoc = await User.findOne({ memberId: request.memberId });
    }

    if (userDoc) {
      if (newName) userDoc.name = newName;
      if (newEmail) userDoc.email = newEmail;
      if (newMobile) userDoc.mobile = newMobile;
      await userDoc.save();
    }

    // 2. Update Member document
    let memberDoc = await Member.findOne({
      $or: [
        { memberId: request.memberId },
        ...(request.userId ? [{ userId: request.userId }] : []),
        ...(request.applicationId ? [{ applicationId: request.applicationId }] : []),
      ],
    });

    if (memberDoc) {
      if (newName) {
        memberDoc.name = newName;
        memberDoc.personalDetails = memberDoc.personalDetails || {};
        memberDoc.personalDetails.fullName = newName;
        const parts = newName.split(' ');
        memberDoc.personalDetails.firstName = parts[0] || '';
        memberDoc.personalDetails.lastName = parts.slice(1).join(' ') || '';
      }
      if (newEmail) {
        memberDoc.email = newEmail;
        memberDoc.contactDetails = memberDoc.contactDetails || {};
        memberDoc.contactDetails.email = newEmail;
      }
      if (newMobile) {
        memberDoc.mobile = newMobile;
        memberDoc.contactDetails = memberDoc.contactDetails || {};
        memberDoc.contactDetails.mobile = newMobile;
      }
      if (altMobile !== undefined && altMobile !== '') {
        memberDoc.contactDetails = memberDoc.contactDetails || {};
        memberDoc.contactDetails.altMobile = altMobile;
      }
      if (dob) {
        memberDoc.dob = dob;
        memberDoc.personalDetails = memberDoc.personalDetails || {};
        memberDoc.personalDetails.dob = dob;
      }
      if (gender) {
        memberDoc.gender = gender;
        memberDoc.personalDetails = memberDoc.personalDetails || {};
        memberDoc.personalDetails.gender = gender;
      }
      if (occupation) {
        memberDoc.occupation = occupation;
        memberDoc.personalDetails = memberDoc.personalDetails || {};
        memberDoc.personalDetails.occupation = occupation;
      }

      // Address
      const resolvedAddress = address || [address1, address2].filter(Boolean).join(', ');
      if (resolvedAddress) memberDoc.address = resolvedAddress;
      if (address1 || address2 || district || state || pincode) {
        memberDoc.addressDetails = memberDoc.addressDetails || {};
        if (address1) memberDoc.addressDetails.address1 = address1;
        if (address2) memberDoc.addressDetails.address2 = address2;
        if (district) {
          memberDoc.district = district;
          memberDoc.addressDetails.district = district;
        }
        if (state) {
          memberDoc.state = state;
          memberDoc.addressDetails.state = state;
        }
        if (pincode) {
          memberDoc.pincode = pincode;
          memberDoc.addressDetails.pincode = pincode;
        }
      }

      if (preferredCommunication) {
        memberDoc.membershipDetails = memberDoc.membershipDetails || {};
        memberDoc.membershipDetails.preferredCommunication = preferredCommunication;
      }

      if (photoUrl) {
        memberDoc.photoUrl = photoUrl;
        memberDoc.documentDetails = memberDoc.documentDetails || {};
        memberDoc.documentDetails.photoUrl = photoUrl;
      }

      await memberDoc.save();
    }

    // 3. Update Application document if linked
    let appDoc = null;
    if (request.applicationId || request.memberId) {
      appDoc = await Application.findOne({
        $or: [
          ...(request.applicationId ? [{ _id: request.applicationId }] : []),
          { memberId: request.memberId },
        ],
      });

      if (appDoc) {
        if (newName) {
          appDoc.applicantName = newName;
          appDoc.personalDetails = appDoc.personalDetails || {};
          appDoc.personalDetails.fullName = newName;
          const parts = newName.split(' ');
          appDoc.personalDetails.firstName = parts[0] || '';
          appDoc.personalDetails.lastName = parts.slice(1).join(' ') || '';
        }
        if (newEmail) {
          appDoc.email = newEmail;
          appDoc.contactDetails = appDoc.contactDetails || {};
          appDoc.contactDetails.email = newEmail;
        }
        if (newMobile) {
          appDoc.mobile = newMobile;
          appDoc.contactDetails = appDoc.contactDetails || {};
          appDoc.contactDetails.mobile = newMobile;
        }
        if (altMobile !== undefined && altMobile !== '') {
          appDoc.contactDetails = appDoc.contactDetails || {};
          appDoc.contactDetails.altMobile = altMobile;
        }
        if (dob) {
          appDoc.personalDetails = appDoc.personalDetails || {};
          appDoc.personalDetails.dob = dob;
        }
        if (gender) {
          appDoc.personalDetails = appDoc.personalDetails || {};
          appDoc.personalDetails.gender = gender;
        }
        if (occupation) {
          appDoc.personalDetails = appDoc.personalDetails || {};
          appDoc.personalDetails.occupation = occupation;
        }
        if (address1 || address2 || district || state || pincode) {
          appDoc.addressDetails = appDoc.addressDetails || {};
          if (address1) appDoc.addressDetails.address1 = address1;
          if (address2) appDoc.addressDetails.address2 = address2;
          if (district) appDoc.addressDetails.district = district;
          if (state) appDoc.addressDetails.state = state;
          if (pincode) appDoc.addressDetails.pincode = pincode;
        }
        if (preferredCommunication) {
          appDoc.membershipDetails = appDoc.membershipDetails || {};
          appDoc.membershipDetails.preferredCommunication = preferredCommunication;
        }
        if (photoUrl) {
          appDoc.documentDetails = appDoc.documentDetails || {};
          appDoc.documentDetails.photoUrl = photoUrl;
        }
        await appDoc.save();
      }
    }

    // 4. Mark request as approved
    request.status = 'approved';
    request.reviewedBy = reviewerName || 'Branch Administrator';
    request.reviewedAt = new Date();
    request.adminRemarks = adminRemarks || 'Profile update approved by administrator.';
    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Profile update request approved successfully. User & Member records updated.',
      data: request,
    });
  } catch (error) {
    console.error('Error approving profile update request:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve profile update request',
    });
  }
};

/**
 * @desc    Reject profile update request (leaves User and Member records unchanged)
 * @route   PATCH /api/profile-updates/:id/reject
 * @access  Admin
 */
const rejectProfileUpdateRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminRemarks = '', reviewerName = 'Branch Administrator' } = req.body;

    const request = await ProfileUpdateRequest.findById(id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Profile update request not found',
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${request.status}.`,
      });
    }

    // Mark request as rejected without touching User, Member, or Application collections
    request.status = 'rejected';
    request.reviewedBy = reviewerName || 'Branch Administrator';
    request.reviewedAt = new Date();
    request.adminRemarks = adminRemarks || 'Profile update request rejected by administrator.';
    await request.save();

    return res.status(200).json({
      success: true,
      message: 'Profile update request rejected. Original records remain unchanged.',
      data: request,
    });
  } catch (error) {
    console.error('Error rejecting profile update request:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject profile update request',
    });
  }
};

module.exports = {
  getProfileUpdateRequests,
  getProfileUpdateRequestById,
  approveProfileUpdateRequest,
  rejectProfileUpdateRequest,
};
