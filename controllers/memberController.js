const mongoose = require('mongoose');
const Application = require('../models/Application');
const User = require('../models/User');
const Member = require('../models/Member');
const { generateMemberId } = require('../utils/memberIdGenerator');

/**
 * Helper to format date into '29 Sep 2026'
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
 * Format a Member document from MongoDB into a standard API response
 */
const formatMemberRecord = (memberDoc) => {
  if (!memberDoc) return null;
  const m = memberDoc.toObject ? memberDoc.toObject() : memberDoc;
  const p = m.personalDetails || {};
  const c = m.contactDetails || {};
  const a = m.addressDetails || {};
  const n = m.nomineeDetails || {};
  const mem = m.membershipDetails || {};
  const doc = m.documentDetails || {};

  const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
  const applicantName = m.name || (nameParts.length > 0 ? nameParts.join(' ') : 'Valued Member');

  const memberId = m.memberId || 'NUF-M-0001';
  const membershipStatus = (m.status || 'active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

  // Build documents list
  const documentsList = [];
  const defaultVerification = 'Verified';

  const idType = (doc.idProofType || 'Aadhaar Card').trim();
  const addrType = (doc.addressProofType || 'Aadhaar Card').trim();
  const isIdAadhaar = idType.toLowerCase().includes('aadhaar');
  const isAddrAadhaar = addrType.toLowerCase().includes('aadhaar');
  const isSameUrl = doc.idProofUrl && doc.addressProofUrl && doc.idProofUrl === doc.addressProofUrl;

  if (doc.idProofUrl) {
    const isCombined = (isIdAadhaar && isAddrAadhaar) || isSameUrl;
    documentsList.push({
      id: `${m._id}-idproof`,
      documentType: isCombined ? 'Identity & Address Proof' : 'Identity Proof',
      documentName: isCombined ? `${idType} (Identity & Address Proof)` : `${idType} (ID Proof)`,
      documentUrl: doc.idProofUrl,
      uploadedAt: m.createdAt || m.joiningDate,
      verificationStatus: defaultVerification,
    });
  }

  if (doc.addressProofUrl) {
    const isDuplicateAadhaar = isAddrAadhaar && (isIdAadhaar || isSameUrl);
    if (!doc.idProofUrl || (!isDuplicateAadhaar && !documentsList.some((d) => d.documentUrl === doc.addressProofUrl))) {
      documentsList.push({
        id: `${m._id}-addressproof`,
        documentType: 'Address Proof',
        documentName: `${addrType || 'Address Document'} (Address Proof)`,
        documentUrl: doc.addressProofUrl,
        uploadedAt: m.createdAt || m.joiningDate,
        verificationStatus: defaultVerification,
      });
    }
  }

  if (doc.photoUrl) {
    documentsList.push({
      id: `${m._id}-photo`,
      documentType: 'Photograph',
      documentName: 'Passport Photograph',
      documentUrl: doc.photoUrl,
      uploadedAt: m.createdAt || m.joiningDate,
      verificationStatus: defaultVerification,
    });
  }

  if (doc.signatureUrl) {
    documentsList.push({
      id: `${m._id}-signature`,
      documentType: 'Signature',
      documentName: 'Digital Signature Specimen',
      documentUrl: doc.signatureUrl,
      uploadedAt: m.createdAt || m.joiningDate,
      verificationStatus: defaultVerification,
    });
  }

  if (Array.isArray(doc.additionalDocuments)) {
    doc.additionalDocuments.forEach((addDoc, idx) => {
      if (addDoc.documentUrl) {
        documentsList.push({
          id: addDoc._id ? addDoc._id.toString() : `${m._id}-add-${idx}`,
          documentType: addDoc.documentType || 'Additional Document',
          documentName: addDoc.documentName || addDoc.documentType || 'Supporting Document',
          documentUrl: addDoc.documentUrl,
          uploadedAt: addDoc.uploadedAt || m.createdAt || m.joiningDate,
          verificationStatus: defaultVerification,
        });
      }
    });
  }

  return {
    _id: m._id,
    id: memberId,
    memberId,
    applicationId: m.applicationRefId || (m.applicationId ? m.applicationId.toString() : ''),
    name: applicantName,
    applicantName,
    email: m.email || c.email || '',
    mobile: m.mobile || c.mobile || '',
    membershipType: m.membershipType || mem.membershipType || 'Associate Member',
    membershipAmount: String(m.membershipAmount || mem.membershipAmount || 200),
    numberOfShares: m.numberOfShares || mem.numberOfShares || 10,
    shareValue: m.shareValue || mem.shareValue || 10,
    processingFee: m.processingFee || mem.processingFee || 100,
    totalContribution: m.totalContribution || mem.totalContribution || 200,
    status: (m.status || 'active').toLowerCase(),
    membershipStatus,
    joiningDate: formatDate(m.joiningDate || m.createdAt),
    createdAt: m.createdAt || m.joiningDate,
    personalDetails: p,
    contactDetails: c,
    addressDetails: a,
    nomineeDetails: n,
    membershipDetails: mem,
    documentDetails: doc,
    documents: documentsList,
    paymentDetails: m.paymentDetails || {},
  };
};

/**
 * @desc    Get all real approved members from MongoDB members collection
 * @route   GET /api/members
 * @access  Public / Admin
 */
const getMembers = async (req, res) => {
  try {
    // 1. Sync any approved application that might be missing a Member document in MongoDB
    const approvedApps = await Application.find({ status: 'approved' });
    for (const app of approvedApps) {
      const existingMember = await Member.findOne({ applicationId: app._id });
      if (!existingMember) {
        let memberId = app.memberId;
        if (!memberId || !memberId.startsWith('NUF-M-')) {
          memberId = await generateMemberId();
          app.memberId = memberId;
          await app.save();
        }

        const p = app.personalDetails || {};
        const nameParts = [p.title || app.title, p.firstName || app.firstName, p.middleName || app.middleName, p.lastName || app.lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(' ') : (app.applicantName || 'Applicant');
        const email = (app.contactDetails?.email || app.email || `member_${memberId.toLowerCase().replace(/[^a-z0-9]/g, '')}@utkalfinance.com`).toLowerCase().trim();
        const mobile = app.contactDetails?.mobile || app.mobile || '';

        await Member.findOneAndUpdate(
          { applicationId: app._id },
          {
            $set: {
              memberId,
              applicationId: app._id,
              applicationRefId: app.applicationId || app._id.toString(),
              name,
              email,
              mobile,
              membershipType: app.membershipDetails?.membershipType || 'Associate Member',
              membershipAmount: app.membershipDetails?.membershipAmount ? Number(app.membershipDetails.membershipAmount) : 200,
              numberOfShares: app.membershipDetails?.numberOfShares || 10,
              shareValue: app.membershipDetails?.shareValue || 10,
              processingFee: app.membershipDetails?.processingFee || 100,
              totalContribution: app.membershipDetails?.totalContribution || 200,
              status: 'active',
              joiningDate: app.reviewedAt || app.submittedAt || app.createdAt || new Date(),
              credentialsEmailStatus: app.credentialsEmailStatus || 'pending',
              personalDetails: app.personalDetails || {},
              contactDetails: app.contactDetails || {},
              addressDetails: app.addressDetails || {},
              nomineeDetails: app.nomineeDetails || {},
              membershipDetails: app.membershipDetails || {},
              documentDetails: app.documentDetails || {},
              paymentDetails: app.paymentDetails || {},
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    // 2. Fetch directly from the real Member collection in MongoDB
    const membersFromDb = await Member.find().sort({ createdAt: -1 });
    const membersList = membersFromDb.map(formatMemberRecord);

    return res.status(200).json({
      success: true,
      count: membersList.length,
      members: membersList,
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch members',
    });
  }
};

/**
 * @desc    Get single member details by memberId or applicationId or _id
 * @route   GET /api/members/:id
 * @access  Public / Admin
 */
const getMemberById = async (req, res) => {
  try {
    const { id } = req.params;

    let member = await Member.findOne({
      $or: [
        { memberId: id },
        { applicationRefId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
      ],
    });

    if (!member) {
      // Fallback: check if approved application exists and create member
      const app = await Application.findOne({
        $or: [
          { memberId: id },
          { applicationId: id },
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : []),
        ],
        status: 'approved',
      });

      if (app) {
        const p = app.personalDetails || {};
        const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(' ') : 'Applicant';
        const email = (app.contactDetails?.email || app.email || `member_${app._id}@utkalfinance.com`).toLowerCase().trim();
        const memberId = app.memberId || `NUF-M-${(app.applicationId || app._id.toString()).replace(/\D/g, '').slice(-4).padStart(4, '0')}`;

        member = await Member.findOneAndUpdate(
          {
            $or: [{ memberId }, { applicationId: app._id }],
          },
          {
            $set: {
              memberId,
              applicationId: app._id,
              applicationRefId: app.applicationId || app._id.toString(),
              name,
              email,
              mobile: app.contactDetails?.mobile || '',
              membershipType: app.membershipDetails?.membershipType || 'Associate Member',
              membershipAmount: app.membershipDetails?.membershipAmount ? Number(app.membershipDetails.membershipAmount) : 200,
              numberOfShares: app.membershipDetails?.numberOfShares || 10,
              shareValue: app.membershipDetails?.shareValue || 10,
              processingFee: app.membershipDetails?.processingFee || 100,
              totalContribution: app.membershipDetails?.totalContribution || 200,
              status: 'active',
              joiningDate: app.reviewedAt || new Date(),
              personalDetails: app.personalDetails || {},
              contactDetails: app.contactDetails || {},
              addressDetails: app.addressDetails || {},
              nomineeDetails: app.nomineeDetails || {},
              membershipDetails: app.membershipDetails || {},
              documentDetails: app.documentDetails || {},
              paymentDetails: app.paymentDetails || {},
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }

    if (!member) {
      return res.status(404).json({
        success: false,
        message: `Approved member not found for ID "${id}"`,
      });
    }

    return res.status(200).json({
      success: true,
      member: formatMemberRecord(member),
    });
  } catch (error) {
    console.error('Error fetching member details:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch member details',
    });
  }
};

/**
 * @desc    Toggle/Update member status (Active / Inactive)
 * @route   PATCH /api/members/:id/status
 * @access  Public / Admin
 */
const updateMemberStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    const newStatus = status.toLowerCase() === 'active' ? 'active' : 'inactive';

    const user = await User.findOne({
      $or: [
        { memberId: id },
        ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
      ],
    });

    if (user) {
      user.status = newStatus;
      await user.save();
    }

    // Update real Member document in MongoDB
    const updatedMember = await Member.findOneAndUpdate(
      {
        $or: [
          { memberId: id },
          { applicationRefId: id },
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }, { applicationId: id }] : []),
        ],
      },
      { $set: { status: newStatus } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: `Member status updated to ${newStatus}`,
      memberId: id,
      status: newStatus === 'active' ? 'Active' : 'Inactive',
      member: formatMemberRecord(updatedMember),
    });
  } catch (error) {
    console.error('Error updating member status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update member status',
    });
  }
};

module.exports = {
  getMembers,
  getMemberById,
  updateMemberStatus,
};
