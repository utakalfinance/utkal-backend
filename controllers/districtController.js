const District = require('../models/District');
const Member = require('../models/Member');
const Application = require('../models/Application');
const LoanEnquiry = require('../models/LoanEnquiry');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { sendDistrictAdminWelcomeEmail } = require('../utils/sendEmail');

/**
 * Generate secure temporary password for new district administrator
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
 * Helper to compute live member and loan counts for a district
 */
const getDistrictStats = async (districtName, districtCode) => {
  const nameRegex = new RegExp(`^${districtName.trim()}`, 'i');
  const codeRegex = new RegExp(`^${districtCode.trim()}`, 'i');

  const [totalMembers, totalApplications, loanEnquiries] = await Promise.all([
    Member.countDocuments({
      $or: [
        { 'addressDetails.district': nameRegex },
        { district: nameRegex },
        { branch: nameRegex },
      ],
    }),
    Application.countDocuments({
      $or: [
        { 'addressDetails.district': nameRegex },
        { district: nameRegex },
        { branch: nameRegex },
      ],
    }),
    LoanEnquiry.find({
      $or: [
        { city: nameRegex },
        { purpose: nameRegex },
      ],
    }).lean(),
  ]);

  const totalLoanApps = loanEnquiries.length;
  const pendingLoans = loanEnquiries.filter((l) => (l.status || '').toLowerCase() === 'new').length;
  const approvedLoans = loanEnquiries.filter((l) => (l.status || '').toLowerCase() === 'converted').length;

  return {
    totalMembers,
    totalApplications,
    totalLoanApplications: totalLoanApps,
    pendingLoanVerifications: pendingLoans,
    approvedLoans,
  };
};

/**
 * @desc    Get all districts with summary metrics and filters
 * @route   GET /api/districts
 * @access  Protected (Super Admin / Admin)
 */
const getDistricts = async (req, res) => {
  try {
    const { search, status, state } = req.query;
    const filter = {};

    if (status && status !== 'All') {
      filter.status = status.toLowerCase();
    }

    if (state && state !== 'All') {
      filter.state = new RegExp(`^${state.trim()}$`, 'i');
    }

    if (search && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { code: { $regex: term, $options: 'i' } },
        { address: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { contactNumber: { $regex: term, $options: 'i' } },
      ];
    }

    const districts = await District.find(filter).sort({ name: 1 });

    // Compute live stats for each district
    const enrichedDistricts = await Promise.all(
      districts.map(async (dist) => {
        let assignedAdmin = dist.assignedAdmin;
        if (!assignedAdmin?.name || assignedAdmin.name === 'Unassigned') {
          const nameRegex = new RegExp(`^${dist.name.trim()}$`, 'i');
          const matchedAdmin = await User.findOne({
            role: 'district_admin',
            $or: [
              { districtId: dist._id },
              { assignedDistrict: nameRegex },
            ],
          }).select('name email mobile _id status');
          if (matchedAdmin) {
            assignedAdmin = {
              name: matchedAdmin.name,
              email: matchedAdmin.email,
              phone: matchedAdmin.mobile,
              userId: matchedAdmin._id,
            };
          }
        }
        const stats = await getDistrictStats(dist.name, dist.code);
        return {
          ...dist.toObject(),
          assignedAdmin,
          ...stats,
        };
      })
    );

    // Compute summary cards across entire district registry
    const [totalDistricts, activeDistricts, inactiveDistricts, assignedAdminsCount] = await Promise.all([
      District.countDocuments(),
      District.countDocuments({ status: 'active' }),
      District.countDocuments({ status: 'inactive' }),
      User.countDocuments({ role: 'district_admin' }),
    ]);

    const summary = {
      totalDistricts,
      activeDistricts,
      inactiveDistricts,
      totalDistrictAdmins: assignedAdminsCount,
    };

    return res.status(200).json({
      success: true,
      count: enrichedDistricts.length,
      summary,
      districts: enrichedDistricts,
    });
  } catch (error) {
    console.error('Error fetching districts:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching districts',
    });
  }
};

/**
 * @desc    Get single district by ID with detailed breakdown
 * @route   GET /api/districts/:id
 * @access  Protected (Super Admin / Admin)
 */
const getDistrictById = async (req, res) => {
  try {
    const { id } = req.params;
    const district = await District.findById(id);

    if (!district) {
      return res.status(404).json({
        success: false,
        message: 'District not found',
      });
    }

    const stats = await getDistrictStats(district.name, district.code);

    // Auto-detect assigned admin if missing or unassigned
    let assignedAdmin = district.assignedAdmin;
    if (!assignedAdmin?.name || assignedAdmin.name === 'Unassigned') {
      const nameRegex = new RegExp(`^${district.name.trim()}$`, 'i');
      const matchedAdmin = await User.findOne({
        role: 'district_admin',
        $or: [
          { districtId: district._id },
          { assignedDistrict: nameRegex },
        ],
      }).select('name email mobile _id status');
      if (matchedAdmin) {
        assignedAdmin = {
          name: matchedAdmin.name,
          email: matchedAdmin.email,
          phone: matchedAdmin.mobile,
          userId: matchedAdmin._id,
        };
      }
    }

    // Fetch latest activity records (members & applications for this district)
    const nameRegex = new RegExp(`^${district.name.trim()}`, 'i');
    const [recentMembers, recentApps, recentLoans] = await Promise.all([
      Member.find({
        $or: [{ 'addressDetails.district': nameRegex }, { district: nameRegex }],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('memberId name mobile status createdAt joiningDate')
        .lean(),
      Application.find({
        $or: [{ 'addressDetails.district': nameRegex }, { district: nameRegex }],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('applicationId applicantName mobile status createdAt')
        .lean(),
      LoanEnquiry.find({
        $or: [{ city: nameRegex }, { purpose: nameRegex }],
      })
        .sort({ submittedAt: -1 })
        .limit(5)
        .select('enquiryId fullName loanCategory expectedAmount status submittedAt')
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      district: {
        ...district.toObject(),
        assignedAdmin,
        ...stats,
        recentMembers,
        recentApplications: recentApps,
        recentLoans,
      },
    });
  } catch (error) {
    console.error('Error fetching district details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while fetching district details',
    });
  }
};

/**
 * @desc    Create a new district
 * @route   POST /api/districts
 * @access  Protected (Super Admin only)
 */
const createDistrict = async (req, res) => {
  try {
    const {
      name,
      code,
      state = 'Odisha',
      address,
      contactNumber,
      email,
      description = '',
      status = 'active',
      adminName,
      username,
      customPassword,
    } = req.body;

    // Field validations
    const errors = {};
    if (!name || !name.trim()) errors.name = 'District Name is required';
    if (!code || !code.trim()) errors.code = 'District Code is required';
    if (!address || !address.trim()) errors.address = 'Branch / Office Address is required';
    if (!contactNumber || !contactNumber.trim()) errors.contactNumber = 'Contact Number is required';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      errors.email = 'A valid email address is required';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed for new district',
        errors,
      });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanMobile = contactNumber.trim().replace(/\D/g, '');

    // Check code uniqueness
    const existingCode = await District.findOne({ code: cleanCode });
    if (existingCode) {
      return res.status(400).json({
        success: false,
        message: `District code '${cleanCode}' is already registered for ${existingCode.name}. District code must be unique.`,
        errors: { code: 'District code must be unique' },
      });
    }

    // Check name uniqueness
    const existingDistrict = await District.findOne({
      name: new RegExp(`^${cleanName}$`, 'i'),
    });
    if (existingDistrict) {
      return res.status(400).json({
        success: false,
        message: `A district named '${cleanName}' is already registered.`,
        errors: { name: 'District name already exists' },
      });
    }

    // 1. Create the District document
    const newDistrict = await District.create({
      name: cleanName,
      code: cleanCode,
      state: state.trim() || 'Odisha',
      address: address.trim(),
      contactNumber: cleanMobile,
      email: cleanEmail,
      description: description ? description.trim() : '',
      status: status.toLowerCase() === 'inactive' ? 'inactive' : 'active',
      assignedAdmin: { name: 'Provisioning...', email: cleanEmail, phone: cleanMobile },
      createdBy: req.user?.email || req.user?.name || 'Super Admin',
      lastUpdatedBy: req.user?.email || req.user?.name || 'Super Admin',
    });

    // 2. Provision or link District Administrator user account
    const rawPassword = customPassword && customPassword.trim().length >= 6
      ? customPassword.trim()
      : generateTemporaryPassword();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    const displayName = (adminName || '').trim() || `${cleanName} Circle Admin`;
    const cleanUsername = (username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    let baseUsername = cleanUsername || `admin.${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    let finalUsername = baseUsername;

    const existingUsernameUser = await User.findOne({ username: finalUsername });
    if (existingUsernameUser) {
      finalUsername = `${baseUsername}${Math.floor(100 + Math.random() * 900)}`;
    }

    let adminUser = await User.findOne({ email: cleanEmail });

    if (adminUser) {
      // User exists with this email - update jurisdiction to this newly created circle
      adminUser.name = displayName;
      adminUser.assignedDistrict = cleanName;
      adminUser.districtId = newDistrict._id;
      adminUser.mobile = cleanMobile;
      adminUser.password = hashedPassword;
      adminUser.role = 'district_admin';
      adminUser.status = 'active';
      adminUser.mustChangePassword = true;
      await adminUser.save();
    } else {
      // Create fresh District Admin user
      adminUser = new User({
        name: displayName,
        email: cleanEmail,
        mobile: cleanMobile,
        username: finalUsername,
        password: hashedPassword,
        role: 'district_admin',
        status: 'active',
        districtId: newDistrict._id,
        assignedDistrict: cleanName,
        mustChangePassword: true,
      });
      await adminUser.save();
    }

    // 3. Atomically record assigned admin inside the District document
    newDistrict.assignedAdmin = {
      name: adminUser.name,
      email: adminUser.email,
      phone: adminUser.mobile,
      userId: adminUser._id,
      assignedAt: new Date(),
    };
    await newDistrict.save();

    // 4. Dispatch welcome credentials email via Nodemailer asynchronously in background
    setImmediate(async () => {
      try {
        console.log(`[District Setup] Dispatching credentials email for ${cleanName} to: ${cleanEmail}`);
        await sendDistrictAdminWelcomeEmail({
          email: cleanEmail,
          name: adminUser.name,
          username: adminUser.username || cleanEmail,
          assignedDistrict: `${cleanName} Circle`,
          tempPassword: rawPassword,
        });
        console.log(`[District Setup] Credentials email dispatched successfully to ${cleanEmail}`);
      } catch (mailErr) {
        console.error('[District Setup Credentials Email Error]:', mailErr.message);
      }
    });

    console.log(`[District] Created district ${newDistrict.name} (${newDistrict.code}) & provisioned admin ${adminUser.email}`);

    return res.status(201).json({
      success: true,
      message: `District '${newDistrict.name}' created successfully. Administrative login credentials have been dispatched to ${cleanEmail}.`,
      district: newDistrict,
      admin: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        username: adminUser.username,
        assignedDistrict: newDistrict.name,
      },
      temporaryPassword: rawPassword,
    });
  } catch (error) {
    console.error('Error creating district:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'District code or email must be unique. A record already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while creating district',
    });
  }
};

/**
 * @desc    Update district details
 * @route   PUT /api/districts/:id
 * @access  Protected (Super Admin only)
 */
const updateDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      code,
      state,
      address,
      contactNumber,
      email,
      description,
      status,
      assignedAdmin,
    } = req.body;

    const district = await District.findById(id);
    if (!district) {
      return res.status(404).json({
        success: false,
        message: 'District not found',
      });
    }

    // If code is being changed, ensure uniqueness
    if (code) {
      const cleanCode = code.trim().toUpperCase();
      if (cleanCode !== district.code) {
        const existing = await District.findOne({ code: cleanCode, _id: { $ne: id } });
        if (existing) {
          return res.status(400).json({
            success: false,
            message: `District code '${cleanCode}' is already in use by '${existing.name}'.`,
          });
        }
        district.code = cleanCode;
      }
    }

    if (name) district.name = name.trim();
    if (state) district.state = state.trim();
    if (address) district.address = address.trim();
    if (contactNumber) district.contactNumber = contactNumber.trim();
    if (email) district.email = email.trim().toLowerCase();
    if (typeof description === 'string') district.description = description.trim();
    if (status) district.status = status.toLowerCase() === 'inactive' ? 'inactive' : 'active';
    if (assignedAdmin) district.assignedAdmin = assignedAdmin;

    district.lastUpdatedBy = req.user?.email || req.user?.name || 'Super Admin';

    await district.save();

    const stats = await getDistrictStats(district.name, district.code);

    return res.status(200).json({
      success: true,
      message: `District '${district.name}' updated successfully`,
      district: {
        ...district.toObject(),
        ...stats,
      },
    });
  } catch (error) {
    console.error('Error updating district:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating district',
    });
  }
};

/**
 * @desc    Activate or Deactivate district
 * @route   PATCH /api/districts/:id/status
 * @access  Protected (Super Admin only)
 */
const updateDistrictStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const cleanStatus = (status || '').toLowerCase();
    if (!['active', 'inactive'].includes(cleanStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'active' or 'inactive'",
      });
    }

    const district = await District.findById(id);
    if (!district) {
      return res.status(404).json({
        success: false,
        message: 'District not found',
      });
    }

    district.status = cleanStatus;
    district.lastUpdatedBy = req.user?.email || req.user?.name || 'Super Admin';
    await district.save();

    console.log(`[District] District ${district.name} (${district.code}) status updated to ${cleanStatus}`);

    return res.status(200).json({
      success: true,
      message: `District '${district.name}' is now ${cleanStatus.toUpperCase()}`,
      district,
    });
  } catch (error) {
    console.error('Error updating district status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating district status',
    });
  }
};

/**
 * @desc    Delete a district (Safe deletion rule: Only allowed if zero members and applications)
 * @route   DELETE /api/districts/:id
 * @access  Protected (Super Admin only)
 */
const deleteDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    const district = await District.findById(id);

    if (!district) {
      return res.status(404).json({
        success: false,
        message: 'District not found',
      });
    }

    // Business rule: Do not allow deleting a district with existing members or applications unless force query is passed
    const { force } = req.query;
    const stats = await getDistrictStats(district.name, district.code);
    if (force !== 'true' && (stats.totalMembers > 0 || stats.totalApplications > 0 || stats.totalLoanApplications > 0)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete district '${district.name}' because it contains ${stats.totalMembers} approved members and ${stats.totalApplications} applications. Please deactivate the district or confirm deletion to preserve statutory compliance records.`,
      });
    }

    // Unlink any user assigned to this district
    await User.updateMany(
      { $or: [{ districtId: district._id }, { assignedDistrict: new RegExp(`^${district.name.trim()}$`, 'i') }] },
      { $set: { districtId: null, assignedDistrict: null } }
    );

    await District.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: `District '${district.name}' deleted successfully`,
    });
  } catch (error) {
    console.error('Error deleting district:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while deleting district',
    });
  }
};

module.exports = {
  getDistricts,
  getDistrictById,
  createDistrict,
  updateDistrict,
  updateDistrictStatus,
  deleteDistrict,
};
