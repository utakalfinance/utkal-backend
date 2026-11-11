const LoanEnquiry = require('../models/LoanEnquiry');
const { generateEnquiryId } = require('../utils/enquiryIdGenerator');

const VALID_STATUSES = [
  'New',
  'Contacted',
  'Membership Registration Informed',
  'Converted',
  'Closed',
];

/**
 * @desc    Submit a public loan interest enquiry
 * @route   POST /api/loan-enquiries
 * @access  Public (No authentication required)
 */
const createLoanEnquiry = async (req, res) => {
  try {
    const {
      fullName,
      mobileNumber,
      phone,
      mobile,
      email,
      loanCategory,
      expectedAmount,
      city,
      purpose,
    } = req.body;

    const applicantName = (fullName || '').trim();
    const rawMobile = String(mobileNumber || phone || mobile || '').replace(/\D/g, '');
    const applicantEmail = String(email || '').trim().toLowerCase();

    // Validation checks - ONLY Full Name, Mobile Number, and Email Address
    const errors = {};

    if (!applicantName || applicantName.length < 2) {
      errors.fullName = 'Full Name is required (minimum 2 characters)';
    }

    if (!rawMobile || rawMobile.length !== 10) {
      errors.mobileNumber = 'A valid 10-digit mobile number is required';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!applicantEmail || !emailRegex.test(applicantEmail)) {
      errors.email = 'A valid email address is required';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed for loan interest form',
        errors,
      });
    }

    // Generate unique sequential Enquiry ID (e.g. ENQ-1001)
    const enquiryId = await generateEnquiryId();

    // Save to LoanEnquiry collection
    const enquiry = await LoanEnquiry.create({
      enquiryId,
      fullName: applicantName,
      mobileNumber: rawMobile,
      email: applicantEmail,
      loanCategory: loanCategory ? String(loanCategory).trim() : 'General / Member Consultation',
      expectedAmount: expectedAmount ? Number(expectedAmount) : 0,
      city: city ? String(city).trim() : '',
      purpose: purpose ? String(purpose).trim() : 'Public loan interest submitted for associate membership consultation',
      status: 'New',
      submittedAt: new Date(),
      history: [
        {
          status: 'New',
          remarks: 'Public loan interest submitted via website',
          updatedBy: 'System / Public Visitor',
          updatedAt: new Date(),
        },
      ],
    });

    console.log(`[LoanEnquiry] New loan interest received: ${enquiryId} from ${applicantName} (${rawMobile})`);

    return res.status(201).json({
      success: true,
      message: 'Loan interest submitted successfully. Our loan officer will contact you to explain the membership registration process.',
      enquiryId: enquiry.enquiryId,
      enquiry: {
        _id: enquiry._id,
        enquiryId: enquiry.enquiryId,
        fullName: enquiry.fullName,
        mobileNumber: enquiry.mobileNumber,
        email: enquiry.email,
        loanCategory: enquiry.loanCategory,
        status: enquiry.status,
        submittedAt: enquiry.submittedAt,
      },
    });
  } catch (error) {
    console.error('Error creating loan enquiry:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while submitting loan interest',
    });
  }
};

/**
 * @desc    Get all loan enquiries with metrics, search and filters
 * @route   GET /api/loan-enquiries
 * @access  Protected (Admin only)
 */
const getLoanEnquiries = async (req, res) => {
  try {
    const { status, search, startDate, endDate, dateFilter } = req.query;
    const filter = {};

    // Filter by Status
    if (status && status !== 'All') {
      filter.status = status;
    }

    // Search by Name, Mobile, Enquiry ID, or Email
    if (search && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { enquiryId: { $regex: term, $options: 'i' } },
        { fullName: { $regex: term, $options: 'i' } },
        { mobileNumber: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
      ];
    }

    // Filter by Date
    if (startDate || endDate) {
      filter.submittedAt = {};
      if (startDate) {
        filter.submittedAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.submittedAt.$lte = end;
      }
    } else if (dateFilter && dateFilter !== 'All') {
      const now = new Date();
      if (dateFilter === 'Today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filter.submittedAt = { $gte: start };
      } else if (dateFilter === 'This Week') {
        const firstDayOfWeek = new Date(now);
        firstDayOfWeek.setDate(now.getDate() - now.getDay());
        firstDayOfWeek.setHours(0, 0, 0, 0);
        filter.submittedAt = { $gte: firstDayOfWeek };
      } else if (dateFilter === 'This Month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        filter.submittedAt = { $gte: startOfMonth };
      }
    }

    // Fetch filtered list
    const enquiries = await LoanEnquiry.find(filter).sort({ submittedAt: -1, createdAt: -1 });

    // Aggregate summary metrics across the entire collection (Real MongoDB Counts)
    const [total, newCount, contactedCount, informedCount, convertedCount, closedCount] = await Promise.all([
      LoanEnquiry.countDocuments(),
      LoanEnquiry.countDocuments({ status: 'New' }),
      LoanEnquiry.countDocuments({ status: 'Contacted' }),
      LoanEnquiry.countDocuments({ status: 'Membership Registration Informed' }),
      LoanEnquiry.countDocuments({ status: 'Converted' }),
      LoanEnquiry.countDocuments({ status: 'Closed' }),
    ]);

    const summary = {
      total,
      new: newCount,
      contacted: contactedCount,
      membershipInformed: informedCount,
      converted: convertedCount,
      closed: closedCount,
    };

    return res.status(200).json({
      success: true,
      count: enquiries.length,
      summary,
      enquiries,
    });
  } catch (error) {
    console.error('Error fetching loan enquiries:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching loan enquiries',
    });
  }
};

/**
 * @desc    Get single loan enquiry by ID or enquiryId
 * @route   GET /api/loan-enquiries/:id
 * @access  Protected (Admin only)
 */
const getLoanEnquiryById = async (req, res) => {
  try {
    const { id } = req.params;
    let enquiry = null;

    if (id.startsWith('ENQ-')) {
      enquiry = await LoanEnquiry.findOne({ enquiryId: id });
    } else {
      enquiry = await LoanEnquiry.findById(id);
    }

    if (!enquiry) {
      return res.status(404).json({
        success: false,
        message: 'Loan enquiry not found',
      });
    }

    return res.status(200).json({
      success: true,
      enquiry,
    });
  } catch (error) {
    console.error('Error fetching loan enquiry by id:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching loan enquiry details',
    });
  }
};

/**
 * @desc    Update loan enquiry status and admin remarks
 * @route   PATCH /api/loan-enquiries/:id/status or PATCH /api/loan-enquiries/:id
 * @access  Protected (Admin only)
 */
const updateLoanEnquiryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminRemarks, remarks, notes } = req.body;

    let enquiry = null;
    if (id.startsWith('ENQ-')) {
      enquiry = await LoanEnquiry.findOne({ enquiryId: id });
    } else {
      enquiry = await LoanEnquiry.findById(id);
    }

    if (!enquiry) {
      return res.status(404).json({
        success: false,
        message: 'Loan enquiry not found',
      });
    }

    const newRemarks = adminRemarks !== undefined ? adminRemarks : (remarks !== undefined ? remarks : notes);
    const updatedBy = req.user?.email || req.user?.name || 'Administrator';

    // Status update if provided
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed statuses: ${VALID_STATUSES.join(', ')}`,
        });
      }

      enquiry.status = status;

      // Status timestamps
      if (status === 'Contacted' && !enquiry.contactedAt) {
        enquiry.contactedAt = new Date();
      } else if (status === 'Membership Registration Informed') {
        enquiry.membershipInformedAt = new Date();
      } else if (status === 'Converted') {
        enquiry.convertedAt = new Date();
      } else if (status === 'Closed') {
        enquiry.closedAt = new Date();
      }
    }

    if (newRemarks !== undefined) {
      enquiry.adminRemarks = String(newRemarks).trim();
    }

    enquiry.lastUpdatedBy = updatedBy;

    // Push to history audit trail
    if (!enquiry.history) enquiry.history = [];
    enquiry.history.push({
      status: enquiry.status,
      remarks: enquiry.adminRemarks || '',
      updatedBy,
      updatedAt: new Date(),
    });

    await enquiry.save();

    console.log(`[LoanEnquiry] Updated enquiry ${enquiry.enquiryId}: Status="${enquiry.status}" by ${updatedBy}`);

    return res.status(200).json({
      success: true,
      message: `Loan enquiry ${enquiry.enquiryId} status updated to "${enquiry.status}".`,
      enquiry,
    });
  } catch (error) {
    console.error('Error updating loan enquiry status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating loan enquiry',
    });
  }
};

module.exports = {
  createLoanEnquiry,
  getLoanEnquiries,
  getLoanEnquiryById,
  updateLoanEnquiryStatus,
};
