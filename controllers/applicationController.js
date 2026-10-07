const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Application = require('../models/Application');
const User = require('../models/User');
const Member = require('../models/Member');
const Payment = require('../models/Payment');
const { generateTempPassword } = require('../utils/generatePassword');
const { sendCredentialsEmail } = require('../utils/sendEmail');
const { generateMemberId } = require('../utils/memberIdGenerator');
const { generatePaymentId } = require('../utils/paymentIdGenerator');

/**
 * @desc    Create a new membership application
 * @route   POST /api/applications
 * @access  Public
 */
const createApplication = async (req, res) => {
  console.log("POST /api/applications received");
  try {
    const formData = req.body || {};

    const parseIfJson = (val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch (e) {
          return val;
        }
      }
      return val || {};
    };

    const personal = parseIfJson(formData.personal || formData.personalDetails);
    const address = parseIfJson(formData.address || formData.addressDetails);
    const account = parseIfJson(formData.account);
    const nominee = parseIfJson(formData.nominee || formData.nomineeDetails);
    const shares = parseIfJson(formData.shares || formData.membershipDetails);
    const documents = parseIfJson(formData.documents || formData.documentDetails);
    const witness = parseIfJson(formData.witness || formData.witnessDetails);
    const declaration = parseIfJson(formData.declaration || formData.declarationDetails);

    // Basic Validation / Fallbacks for empty submission
    const email = address.email || account.email || formData.email || `applicant_${Date.now()}@utkalfinance.com`;
    const mobile = address.mobile || account.mobile || formData.mobile || '9861000000';
    const firstName = personal.firstName || 'Applicant';
    const lastName = personal.lastName || 'Member';

    // Generate safe unique Application ID: NUF-1001, NUF-1002, etc.
    let generatedAppId = '';
    let isUnique = false;
    let attempts = 0;

    const lastApplication = await Application.findOne({ applicationId: /^NUF-\d+$/ })
      .sort({ createdAt: -1 })
      .exec();

    let nextNumber = 1001;
    if (lastApplication && lastApplication.applicationId) {
      const match = lastApplication.applicationId.match(/NUF-(\d+)/);
      if (match) {
        nextNumber = Math.max(1001, parseInt(match[1], 10) + 1);
      }
    }

    while (!isUnique && attempts < 20) {
      generatedAppId = `NUF-${nextNumber}`;
      const existing = await Application.findOne({ applicationId: generatedAppId });
      if (!existing) {
        isUnique = true;
      } else {
        nextNumber++;
        attempts++;
      }
    }

    // Extract uploaded files from req.files or pre-uploaded file URLs in req.body
    const reqFiles = req.files || [];
    const payment = parseIfJson(formData.payment || formData.paymentDetails);

    const getFileUrl = (fieldNames = []) => {
      const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
      if (Array.isArray(reqFiles)) {
        const found = reqFiles.find((f) => f && names.includes(f.fieldname));
        if (found && found.filename) return `/uploads/documents/${found.filename}`;
      } else if (reqFiles && typeof reqFiles === 'object') {
        for (const name of names) {
          if (Array.isArray(reqFiles[name]) && reqFiles[name][0]?.filename) {
            return `/uploads/documents/${reqFiles[name][0].filename}`;
          }
          if (reqFiles[name]?.filename) {
            return `/uploads/documents/${reqFiles[name].filename}`;
          }
        }
      }
      return null;
    };

    const idProofUrl =
      getFileUrl(['idProof', 'doc2_govId', 'idProofFile']) ||
      (typeof documents.idProofUrl === 'string' && documents.idProofUrl) ||
      (typeof documents.idProofFile === 'string' && documents.idProofFile) ||
      (typeof documents.idProof === 'string' && documents.idProof) ||
      (typeof documents.doc2_govId === 'string' && documents.doc2_govId) ||
      (typeof formData.idProofUrl === 'string' && formData.idProofUrl) ||
      (typeof formData.idProofFile === 'string' && formData.idProofFile) ||
      (typeof formData.idProof === 'string' && formData.idProof) ||
      (typeof formData.doc2_govId === 'string' && formData.doc2_govId) ||
      '';

    const addressProofUrl =
      getFileUrl(['addressProof', 'addressProofFile']) ||
      (typeof documents.addressProofUrl === 'string' && documents.addressProofUrl) ||
      (typeof documents.addressProofFile === 'string' && documents.addressProofFile) ||
      (typeof documents.addressProof === 'string' && documents.addressProof) ||
      (typeof formData.addressProofUrl === 'string' && formData.addressProofUrl) ||
      (typeof formData.addressProofFile === 'string' && formData.addressProofFile) ||
      '';

    const photoUrl =
      getFileUrl(['photo', 'doc1_photo', 'photoFile']) ||
      (typeof documents.photoUrl === 'string' && documents.photoUrl) ||
      (typeof documents.photoFile === 'string' && documents.photoFile) ||
      (typeof documents.photo === 'string' && documents.photo) ||
      (typeof formData.photoUrl === 'string' && formData.photoUrl) ||
      (typeof formData.photoFile === 'string' && formData.photoFile) ||
      '';

    const signatureUrl =
      getFileUrl(['signature', 'signatureFile']) ||
      (typeof documents.signatureUrl === 'string' && documents.signatureUrl) ||
      (typeof documents.signatureFile === 'string' && documents.signatureFile) ||
      (typeof documents.signature === 'string' && documents.signature) ||
      (typeof formData.signatureUrl === 'string' && formData.signatureUrl) ||
      (typeof formData.signatureFile === 'string' && formData.signatureFile) ||
      '';

    const paymentReceiptUrl =
      getFileUrl(['paymentReceipt', 'receiptFile']) ||
      (typeof payment.receiptUrl === 'string' && payment.receiptUrl) ||
      (typeof payment.receiptFile === 'string' && payment.receiptFile) ||
      (typeof payment.receiptFile?.previewUrl === 'string' && payment.receiptFile.previewUrl) ||
      documents.paymentReceiptUrl ||
      '';

    const doc3Url =
      getFileUrl(['doc3_eduCert', 'doc3_eduCertFile']) ||
      (typeof documents.doc3_eduCert === 'string' && documents.doc3_eduCert) ||
      (typeof formData.doc3_eduCert === 'string' && formData.doc3_eduCert) ||
      '';

    const doc4Url =
      getFileUrl(['doc4_birthCert', 'doc4_birthCertFile']) ||
      (typeof documents.doc4_birthCert === 'string' && documents.doc4_birthCert) ||
      (typeof formData.doc4_birthCert === 'string' && formData.doc4_birthCert) ||
      '';

    const doc5Url =
      getFileUrl(['doc5_utility', 'doc5_utilityFile']) ||
      (typeof documents.doc5_utility === 'string' && documents.doc5_utility) ||
      (typeof formData.doc5_utility === 'string' && formData.doc5_utility) ||
      '';

    // Process additional documents array (filter out any duplicates of named slots)
    let additionalDocs = (Array.isArray(documents.additionalDocuments)
      ? documents.additionalDocuments
      : []
    ).filter(
      (d) =>
        d &&
        d.documentType !== 'Educational Certificate' &&
        d.documentType !== 'Birth / PAN Certificate' &&
        d.documentType !== 'Financial / Utility Document' &&
        d.documentType !== 'Payment Receipt' &&
        d.documentUrl !== doc3Url &&
        d.documentUrl !== doc4Url &&
        d.documentUrl !== doc5Url &&
        d.documentUrl !== paymentReceiptUrl
    );

    const extraFieldMappings = [
      { field: 'panCard', type: 'PAN Card', name: 'PAN Card' },
      { field: 'incomeCert', type: 'Income Certificate', name: 'Income Certificate' },
    ];

    extraFieldMappings.forEach((mapping) => {
      if (reqFiles[mapping.field]?.[0]) {
        const fileUrl = `/uploads/documents/${reqFiles[mapping.field][0].filename}`;
        if (!additionalDocs.some(d => d.documentUrl === fileUrl)) {
          additionalDocs.push({
            documentType: mapping.type,
            documentName: mapping.name,
            documentUrl: fileUrl,
            uploadedAt: new Date(),
          });
        }
      }
    });

    if (paymentReceiptUrl && !additionalDocs.some(d => d.documentType === 'Payment Receipt' || d.documentUrl === paymentReceiptUrl)) {
      additionalDocs.push({
        documentType: 'Payment Receipt',
        documentName: '₹200 Statutory Membership Payment Screenshot',
        documentUrl: paymentReceiptUrl,
        uploadedAt: new Date(),
      });
    }

    const sanitizedDocuments = {
      idProofType: documents.idProofType || 'Aadhaar Card',
      idProofNumber: (documents.idProofNumber || formData.idProofNumber || '').trim(),
      idProofUrl: idProofUrl,
      idProofFile: idProofUrl,
      idProof: idProofUrl,
      doc2_govId: idProofUrl,
      addressProofType: documents.addressProofType || 'Aadhaar Card',
      addressProofNumber: (documents.addressProofNumber || formData.addressProofNumber || '').trim(),
      addressProofUrl: addressProofUrl,
      addressProofFile: addressProofUrl,
      addressProof: addressProofUrl,
      photoUrl: photoUrl,
      photoFile: photoUrl,
      photo: photoUrl,
      doc1_photo: photoUrl,
      signatureUrl: signatureUrl,
      signatureFile: signatureUrl,
      signature: signatureUrl,
      doc3_eduCert: doc3Url,
      doc4_birthCert: doc4Url,
      doc5_utility: doc5Url,
      paymentReceiptUrl: paymentReceiptUrl,
      additionalDocuments: additionalDocs,
    };

    const applicationData = {
      applicationId: generatedAppId,
      status: 'pending',
      submittedAt: new Date(),
      personalDetails: {
        title: personal.title || '',
        firstName: personal.firstName || '',
        middleName: personal.middleName || '',
        lastName: personal.lastName || '',
        relationshipPrefix: personal.relationshipPrefix || '',
        fatherLegalName: personal.fatherLegalName || '',
        dob: personal.dob || '',
        age: personal.age ? String(personal.age) : '',
        gender: personal.gender || '',
        maritalStatus: personal.maritalStatus || '',
        education: personal.education || '',
        religion: personal.religion || 'Hinduism',
        category: personal.category || '',
        occupation: personal.occupation || '',
      },
      contactDetails: {
        mobile: mobile,
        email: email,
      },
      addressDetails: {
        address1: address.address1 || '',
        address2: address.address2 || '',
        villageTown: address.villageTown || '',
        district: address.district || '',
        state: address.state || 'Odisha',
        pincode: address.pincode || '',
        country: address.country || 'India',
        sameAsResidential: address.sameAsResidential !== false,
        commAddress1: address.commAddress1 || '',
        commAddress2: address.commAddress2 || '',
        commVillageTown: address.commVillageTown || '',
        commDistrict: address.commDistrict || '',
        commState: address.commState || 'Odisha',
        commPincode: address.commPincode || '',
        commCountry: address.commCountry || 'India',
      },
      nomineeDetails: {
        fullName: nominee.fullName || (nominee.firstName ? `${nominee.firstName} ${nominee.lastName || ''}`.trim() : ''),
        relationship: nominee.relationship || '',
        dob: nominee.dob || '',
        mobile: nominee.mobile || '',
        address: nominee.address || '',
        sameAsApplicant: nominee.sameAsApplicant !== false,
        isMinor: nominee.isMinor === true,
        guardianName: nominee.guardianName || '',
        guardianRelationship: nominee.guardianRelationship || '',
      },
      membershipDetails: {
        membershipType: account.membershipType || 'Associate Member',
        membershipAmount: account.membershipAmount || '200',
        preferredCommunication: account.preferredCommunication || 'Both',
        numberOfShares: Number(shares.numberOfShares) || 10,
        shareValue: Number(shares.shareValue) || 10,
        processingFee: Number(shares.processingFee) || 100,
        totalContribution: Number(shares.totalContribution) || 200,
      },
      paymentDetails: {
        method: payment.method || payment.paymentMethod || 'UPI (IndusInd Bank QR)',
        amount: Number(payment.amount) || Number(shares.totalContribution) || 200,
        utrNumber: payment.utrNumber || payment.utr || 'UPI_ATTACHED',
        receiptUrl: paymentReceiptUrl,
        receiptFileName: payment.receiptFileName || payment.receiptFile?.name || 'UPI_Payment_Receipt.png',
        paymentStatus: 'pending',
        paidAt: new Date(),
      },
      documentDetails: sanitizedDocuments,
      witnessDetails: {
        witness1Name: witness.witness1Name || '',
        witness1Mobile: witness.witness1Mobile || '',
        witness1Address: witness.witness1Address || '',
        witness1Occupation: witness.witness1Occupation || '',
        witness1Relationship: witness.witness1Relationship || '',
        witness2Name: witness.witness2Name || '',
        witness2Mobile: witness.witness2Mobile || '',
        witness2Address: witness.witness2Address || '',
        witness2Occupation: witness.witness2Occupation || '',
        witness2Relationship: witness.witness2Relationship || '',
      },
      declarationDetails: {
        confirmInfoTrue: declaration.confirmInfoTrue === true,
        agreeTerms: declaration.agreeTerms === true,
        consentProcessing: declaration.consentProcessing === true,
        signatureName: declaration.signatureName || '',
        declarationDate: declaration.declarationDate || new Date().toISOString().split('T')[0],
      },
    };

    const newApplication = await Application.create(applicationData);
    console.log(`Application saved successfully: ${newApplication.applicationId}`);

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: newApplication,
    });
  } catch (error) {
    console.error('Error creating application:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to submit application',
    });
  }
};

/**
 * @desc    Get all membership applications
 * @route   GET /api/applications
 * @access  Public / Admin
 */
const getApplications = async (req, res) => {
  try {
    const applications = await Application.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch applications',
    });
  }
};

/**
 * @desc    Update application status (Admin approval API)
 * @route   PATCH /api/applications/:id/status
 * @access  Public / Admin
 */
const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['pending', 'approved', 'rejected'];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed statuses are: pending, approved, rejected',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    const application = await Application.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    // APPROVAL FLOW
    if (status === 'approved') {
      // 1. Verify current status is pending
      if (application.status !== 'pending') {
        if (application.status === 'approved') {
          const existingUser = await User.findOne({
            $or: [
              { applicationId: application._id },
              ...(application.memberId ? [{ memberId: application.memberId }] : []),
              ...(application.contactDetails?.email ? [{ email: application.contactDetails.email.toLowerCase() }] : []),
            ],
          });
          return res.status(200).json({
            success: true,
            message: 'Application is already approved',
            applicationId: application.applicationId || application._id.toString(),
            memberId: application.memberId || existingUser?.memberId,
            alreadyApproved: true,
            emailSent: application.credentialsEmailStatus === 'sent',
            application,
            member: existingUser
              ? {
                _id: existingUser._id,
                memberId: existingUser.memberId,
                name: existingUser.name,
                email: existingUser.email,
                mobile: existingUser.mobile,
                role: existingUser.role,
                status: existingUser.status,
                mustChangePassword: existingUser.mustChangePassword ?? false,
                applicationId: existingUser.applicationId,
              }
              : null,
          });
        }
        return res.status(400).json({
          success: false,
          message: `Cannot approve application. Current status is "${application.status}". Only pending applications can be approved.`,
        });
      }

      // Extract applicant details
      const email = application.contactDetails?.email;
      const mobile = application.contactDetails?.mobile || '';

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Application contact email is missing. Cannot create member login account.',
        });
      }

      const p = application.personalDetails || {};
      const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
      const name = nameParts.length > 0 ? nameParts.join(' ') : 'Applicant';

      // Check if application is already approved
      if (application.status === 'approved') {
        const existingMember = await Member.findOne({ applicationId: application._id });
        if (existingMember) {
          return res.status(200).json({
            success: true,
            message: `Application is already approved with Member ID ${existingMember.memberId}.`,
            applicationId: application.applicationId || application._id.toString(),
            memberId: existingMember.memberId,
            alreadyExists: true,
            emailSent: existingMember.credentialsEmailStatus === 'sent',
            credentialsEmailStatus: existingMember.credentialsEmailStatus,
            application,
            member: {
              _id: existingMember._id,
              memberId: existingMember.memberId,
              name: existingMember.name,
              email: existingMember.email,
              mobile: existingMember.mobile,
              role: 'member',
              status: existingMember.status,
              applicationId: existingMember.applicationId,
              createdAt: existingMember.createdAt,
            },
          });
        }
      }

      // 1. Determine Unique Member ID (Format: NUF-M-0001, NUF-M-0002, etc.)
      let memberId = application.memberId;
      if (!memberId || !memberId.startsWith('NUF-M-')) {
        memberId = await generateMemberId();
      }

      // 2. Generate Temporary Password & Hash with bcrypt
      const tempPassword = generateTempPassword(10);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(tempPassword, salt);

      // 3. Create or Link User Account for THIS Application
      let userDoc = await User.findOne({ applicationId: application._id });
      if (userDoc) {
        userDoc.password = hashedPassword;
        userDoc.mustChangePassword = true;
        userDoc.name = name;
        userDoc.mobile = mobile;
        userDoc.memberId = memberId;
        userDoc.status = 'active';
        await userDoc.save();
      } else {
        const userEmail = email.toLowerCase().trim();

        try {
          userDoc = await User.create({
            name,
            email: userEmail,
            mobile,
            password: hashedPassword,
            role: 'member',
            status: 'active',
            memberId,
            applicationId: application._id,
            mustChangePassword: true,
          });
        } catch (userError) {
          console.error('Notice on user creation:', userError.message);
        }
      }

      console.log(`Application approved: ${application.applicationId || application._id}`);
      console.log(`Member created: ${memberId}`);

      // 4. Update Application Document
      application.status = 'approved';
      application.memberId = memberId;
      application.reviewedAt = new Date();
      application.credentialsEmailStatus = 'pending';
      await application.save();

      // 5. Dispatch Credentials Email via Nodemailer
      let emailSent = false;
      let emailError = null;
      try {
        const emailResult = await sendCredentialsEmail({
          email: email.toLowerCase().trim(),
          name,
          applicationId: application.applicationId || application._id.toString(),
          memberId,
          tempPassword,
        });

        emailSent = emailResult.success === true;
        if (!emailSent && emailResult.error) {
          emailError = emailResult.error;
        }
      } catch (mailErr) {
        console.error(`Credentials email failed: ${mailErr.message}`);
        emailError = mailErr.message;
      }

      application.credentialsEmailStatus = emailSent ? 'sent' : 'failed';
      await application.save();

      // 6. Save into dedicated members collection in MongoDB Atlas strictly keyed by applicationId
      let savedMember;
      try {
        savedMember = await Member.findOneAndUpdate(
          { applicationId: application._id },
          {
            $set: {
              memberId,
              applicationId: application._id,
              applicationRefId: application.applicationId || application._id.toString(),
              userId: userDoc ? userDoc._id : undefined,
              name,
              email: email.toLowerCase().trim(),
              mobile,
              membershipType: application.membershipDetails?.membershipType || 'Associate Member',
              membershipAmount: application.membershipDetails?.membershipAmount ? Number(application.membershipDetails.membershipAmount) : 200,
              numberOfShares: application.membershipDetails?.numberOfShares || 10,
              shareValue: application.membershipDetails?.shareValue || 10,
              processingFee: application.membershipDetails?.processingFee || 100,
              totalContribution: application.membershipDetails?.totalContribution || 200,
              status: 'active',
              joiningDate: application.reviewedAt || new Date(),
              credentialsEmailStatus: application.credentialsEmailStatus,
              personalDetails: application.personalDetails || {},
              contactDetails: application.contactDetails || {},
              addressDetails: application.addressDetails || {},
              nomineeDetails: application.nomineeDetails || {},
              membershipDetails: application.membershipDetails || {},
              documentDetails: application.documentDetails || {},
              paymentDetails: application.paymentDetails || {},
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (memberColErr) {
        console.error('Error saving Member collection record:', memberColErr.message);
      }

      // 7. Save into dedicated payments collection in MongoDB Atlas strictly keyed by applicationId
      let savedPayment;
      try {
        const appId = application.applicationId || application._id.toString();
        const cleanDigits = appId.replace(/\D/g, '') || null;
        const paymentId = await generatePaymentId(cleanDigits);

        const amount = Number(application.paymentDetails?.amount || application.membershipDetails?.totalContribution || application.totalPaid || 200);
        const paymentMethod = application.paymentDetails?.method || application.paymentMethod || 'UPI (IndusInd Bank QR)';
        const utrNo = application.paymentDetails?.utrNumber || application.utrNo || 'UPI_VERIFIED';
        const receiptUrl = application.paymentDetails?.receiptUrl || application.documentDetails?.paymentReceiptUrl || '';
        const receiptFileName = application.paymentDetails?.receiptFileName || 'Statutory_Payment_Receipt.png';
        const paymentStatus = (application.paymentDetails?.status || 'paid').toLowerCase();

        savedPayment = await Payment.findOneAndUpdate(
          { applicationId: application._id },
          {
            $set: {
              paymentId,
              applicationId: application._id,
              applicationRefId: appId,
              memberId,
              userId: userDoc ? userDoc._id : undefined,
              memberName: name,
              email: email.toLowerCase().trim(),
              mobile,
              purpose: 'Statutory Membership & Share Capital (10 Shares)',
              amount,
              paymentMethod,
              status: paymentStatus,
              utrNo,
              transactionId: utrNo !== 'UPI_VERIFIED' ? utrNo : `TXN-${cleanDigits || paymentId.replace(/\D/g, '')}`,
              date: application.paymentDetails?.paidAt || application.reviewedAt || new Date(),
              receiptUrl,
              receiptFileName,
              notes: `Statutory membership subscription for ${name}. Application ${appId} approved by Admin.`,
              history: [
                {
                  field: 'Payment Status',
                  oldValue: 'Pending Approval',
                  newValue: paymentStatus === 'paid' ? 'Paid' : 'Pending',
                  changedAt: application.reviewedAt || new Date(),
                  changedBy: 'Admin (Approval)',
                },
              ],
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (payErr) {
        console.error('Error saving Payment collection record:', payErr.message);
      }

      // 8. Sanitized Member & Payment Response
      const memberResponse = {
        _id: savedMember?._id || userDoc?._id,
        memberId,
        name,
        email: email.toLowerCase().trim(),
        mobile,
        role: 'member',
        status: 'active',
        applicationId: application._id,
        createdAt: savedMember?.createdAt || new Date(),
      };

      return res.status(200).json({
        success: true,
        message: emailSent
          ? 'Application approved, member account and payment ledger record created successfully. Credentials emailed to applicant.'
          : 'Application approved, member account and payment ledger record created successfully.',
        applicationId: application.applicationId || application._id.toString(),
        memberId,
        paymentId: savedPayment?.paymentId,
        payment: savedPayment,
        emailSent,
        emailError: emailError || undefined,
        credentialsEmailStatus: application.credentialsEmailStatus,
        application,
        member: memberResponse,
      });
    }

    // For rejection or resetting to pending
    application.status = status;
    if (status === 'rejected') {
      application.reviewedAt = new Date();
    }

    await application.save();

    const actionText = status === 'rejected' ? 'rejected' : 'updated';

    return res.status(200).json({
      success: true,
      message: `Application ${actionText} successfully`,
      application,
    });
  } catch (error) {
    console.error('Error updating application status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update application status',
    });
  }
};

/**
 * @desc    Update/Edit membership application details (Admin edit API)
 * @route   PUT /api/applications/:id
 * @access  Admin
 */
const updateApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body || {};

    let application = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      application = await Application.findById(id);
    }
    if (!application) {
      application = await Application.findOne({ applicationId: id });
    }

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    // Update personal details
    if (updateData.personalDetails) {
      const current = application.personalDetails?.toObject?.() || application.personalDetails || {};
      application.personalDetails = {
        ...current,
        ...updateData.personalDetails,
      };
    }

    // Update contact details
    if (updateData.contactDetails) {
      const current = application.contactDetails?.toObject?.() || application.contactDetails || {};
      application.contactDetails = {
        ...current,
        ...updateData.contactDetails,
      };
    }

    // Update address details
    if (updateData.addressDetails) {
      const current = application.addressDetails?.toObject?.() || application.addressDetails || {};
      application.addressDetails = {
        ...current,
        ...updateData.addressDetails,
      };
    }

    // Update nominee details
    if (updateData.nomineeDetails) {
      const current = application.nomineeDetails?.toObject?.() || application.nomineeDetails || {};
      application.nomineeDetails = {
        ...current,
        ...updateData.nomineeDetails,
      };
    }

    // Update membership details
    if (updateData.membershipDetails) {
      const current = application.membershipDetails?.toObject?.() || application.membershipDetails || {};
      application.membershipDetails = {
        ...current,
        ...updateData.membershipDetails,
      };
    }

    // Update document details
    if (updateData.documentDetails || updateData.documents) {
      const docPayload = updateData.documentDetails || updateData.documents || {};
      const current = application.documentDetails?.toObject?.() || application.documentDetails || {};
      application.documentDetails = {
        ...current,
        ...docPayload,
      };
      // Keep documents field in sync
      application.documents = {
        ...current,
        ...docPayload,
      };
    }

    // Update payment details
    if (updateData.paymentDetails || updateData.payment) {
      const payPayload = updateData.paymentDetails || updateData.payment || {};
      const current = application.paymentDetails?.toObject?.() || application.paymentDetails || {};
      application.paymentDetails = {
        ...current,
        ...payPayload,
      };
      application.payment = {
        ...current,
        ...payPayload,
      };
    }

    // Flat fields convenience
    if (updateData.pan) {
      if (!application.personalDetails) application.personalDetails = {};
      application.personalDetails.pan = updateData.pan;
    }
    if (updateData.branch) {
      if (!application.membershipDetails) application.membershipDetails = {};
      application.membershipDetails.branch = updateData.branch;
    }
    if (updateData.introducer) {
      if (!application.membershipDetails) application.membershipDetails = {};
      application.membershipDetails.introducer = updateData.introducer;
    }
    if (updateData.altMobile) {
      if (!application.contactDetails) application.contactDetails = {};
      application.contactDetails.altMobile = updateData.altMobile;
    }

    // If status is provided and valid
    if (updateData.status && ['pending', 'approved', 'rejected', 'correction_required'].includes(updateData.status.toLowerCase())) {
      application.status = updateData.status.toLowerCase();
    }

    application.reviewedAt = new Date();
    await application.save();

    // Keep linked User account in sync if member exists
    const linkedUser = await User.findOne({ applicationId: application._id });
    if (linkedUser) {
      const p = application.personalDetails || {};
      const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
      if (nameParts.length > 0) linkedUser.name = nameParts.join(' ');
      if (application.contactDetails?.email) linkedUser.email = application.contactDetails.email.toLowerCase();
      if (application.contactDetails?.mobile) linkedUser.mobile = application.contactDetails.mobile;
      await linkedUser.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Application updated successfully',
      application,
    });
  } catch (error) {
    console.error('Error updating application:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update application',
    });
  }
};

/**
 * @desc    Upload documents standalone endpoint
 * @route   POST /api/applications/upload-documents
 * @access  Public
 */
const uploadDocuments = async (req, res) => {
  try {
    const rawFiles = req.files || [];
    const uploadedFiles = {};

    const registerFile = (fieldname, file) => {
      if (!file) return;
      const fileUrl = file.filename
        ? `/uploads/documents/${file.filename}`
        : (file.buffer ? `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}` : '');
      if (fileUrl) {
        uploadedFiles[fieldname] = fileUrl;
        if (fieldname === 'doc1_photo') uploadedFiles['photo'] = fileUrl;
        if (fieldname === 'photo') uploadedFiles['doc1_photo'] = fileUrl;
        if (fieldname === 'doc2_govId') uploadedFiles['idProof'] = fileUrl;
        if (fieldname === 'idProof') uploadedFiles['doc2_govId'] = fileUrl;
        if (fieldname === 'receiptFile') uploadedFiles['paymentReceipt'] = fileUrl;
        if (fieldname === 'paymentReceipt') uploadedFiles['receiptFile'] = fileUrl;
      }
    };

    if (Array.isArray(rawFiles)) {
      rawFiles.forEach((file) => {
        registerFile(file.fieldname, file);
      });
    } else if (rawFiles && typeof rawFiles === 'object') {
      Object.entries(rawFiles).forEach(([fieldname, fileArr]) => {
        const file = Array.isArray(fileArr) ? fileArr[0] : fileArr;
        registerFile(fieldname, file);
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Files uploaded successfully',
      files: uploadedFiles,
    });
  } catch (error) {
    console.error('Error uploading documents:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload files',
    });
  }
};

/**
 * @desc    Get real document details for all applications from MongoDB
 * @route   GET /api/applications/documents
 * @access  Public / Admin
 */
const getApplicationDocuments = async (req, res) => {
  try {
    const applications = await Application.find().sort({ createdAt: -1 });

    const documentsData = applications.map((app) => {
      const p = app.personalDetails || {};
      const c = app.contactDetails || {};
      const rawDoc = app.documentDetails || app.documents || {};
      const doc = typeof rawDoc.toObject === 'function' ? rawDoc.toObject() : rawDoc;

      const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
      const applicantName = nameParts.length > 0 ? nameParts.join(' ') : 'Applicant';

      const resolvedIdUrl =
        doc.idProofUrl ||
        doc.idProofFile ||
        doc.idProof ||
        doc.doc2_govId ||
        app.idProofUrl ||
        app.doc2_govId ||
        app.idProof ||
        (typeof doc.idProofFile === 'string' ? doc.idProofFile : '') ||
        (typeof app.idProofFile === 'string' ? app.idProofFile : '') ||
        '';

      const resolvedAddrUrl =
        doc.addressProofUrl ||
        doc.addressProofFile ||
        doc.addressProof ||
        app.addressProofUrl ||
        app.addressProof ||
        (typeof doc.addressProofFile === 'string' ? doc.addressProofFile : '') ||
        (typeof app.addressProofFile === 'string' ? app.addressProofFile : '') ||
        '';

      const resolvedPhotoUrl =
        doc.photoUrl ||
        doc.photoFile ||
        doc.photo ||
        doc.doc1_photo ||
        app.photoUrl ||
        app.doc1_photo ||
        (typeof doc.photoFile === 'string' ? doc.photoFile : '') ||
        (typeof app.photoFile === 'string' ? app.photoFile : '') ||
        '';

      const resolvedSigUrl =
        doc.signatureUrl ||
        doc.signatureFile ||
        doc.signature ||
        app.signatureUrl ||
        (typeof doc.signatureFile === 'string' ? doc.signatureFile : '') ||
        (typeof app.signatureFile === 'string' ? app.signatureFile : '') ||
        '';

      const resolvedDoc3Url =
        doc.doc3_eduCert ||
        app.doc3_eduCert ||
        (Array.isArray(doc.additionalDocuments)
          ? doc.additionalDocuments.find(d => d.documentType === 'Educational Certificate')?.documentUrl
          : '') ||
        '';

      const resolvedDoc4Url =
        doc.doc4_birthCert ||
        app.doc4_birthCert ||
        (Array.isArray(doc.additionalDocuments)
          ? doc.additionalDocuments.find(d => d.documentType === 'Birth / PAN Certificate' || d.documentType === 'Birth Certificate')?.documentUrl
          : '') ||
        '';

      const resolvedDoc5Url =
        doc.doc5_utility ||
        app.doc5_utility ||
        (Array.isArray(doc.additionalDocuments)
          ? doc.additionalDocuments.find(d => d.documentType === 'Financial / Utility Document' || d.documentType === 'Utility Bill')?.documentUrl
          : '') ||
        '';

      return {
        _id: app._id,
        applicationId: app.applicationId || app._id.toString(),
        memberId: app.memberId || null,
        applicantName,
        email: c.email || '',
        mobile: c.mobile || '',
        status: app.status || 'pending',
        submittedAt: app.submittedAt || app.createdAt,

        // Complete documentDetails object from MongoDB schema
        documentDetails: {
          idProofType: doc.idProofType || app.idProofType || 'Aadhaar Card',
          idProofUrl: resolvedIdUrl,
          idProofFile: resolvedIdUrl,
          idProof: resolvedIdUrl,
          doc2_govId: resolvedIdUrl,
          addressProofType: doc.addressProofType || app.addressProofType || 'Aadhaar Card',
          addressProofUrl: resolvedAddrUrl,
          addressProofFile: resolvedAddrUrl,
          addressProof: resolvedAddrUrl,
          photoUrl: resolvedPhotoUrl,
          photoFile: resolvedPhotoUrl,
          signatureUrl: resolvedSigUrl,
          signatureFile: resolvedSigUrl,
          doc3_eduCert: resolvedDoc3Url,
          doc4_birthCert: resolvedDoc4Url,
          doc5_utility: resolvedDoc5Url,
          additionalDocuments: Array.isArray(doc.additionalDocuments) ? doc.additionalDocuments : [],
        },

        // Pre-extracted list of uploaded documents
        documents: (() => {
          const list = [];
          const defaultVerification = app.status === 'approved' ? 'Verified' : app.status === 'rejected' ? 'Rejected' : 'Pending Verification';

          const idType = (doc.idProofType || app.idProofType || 'Aadhaar Card').trim();
          const addrType = (doc.addressProofType || app.addressProofType || 'Aadhaar Card').trim();
          const isIdAadhaar = idType.toLowerCase().includes('aadhaar');
          const isAddrAadhaar = addrType.toLowerCase().includes('aadhaar');
          const isSameUrl = resolvedIdUrl && resolvedAddrUrl && resolvedIdUrl === resolvedAddrUrl;
          const isCombinedAadhaar = (isIdAadhaar && isAddrAadhaar) || isSameUrl;

          // 1. Primary Government ID Proof / Combined Identity & Address Proof
          if (resolvedIdUrl) {
            list.push({
              id: `${app._id}-idproof`,
              documentType: isCombinedAadhaar ? 'Identity & Address Proof' : 'Primary Government ID Proof',
              documentName: isCombinedAadhaar ? `${idType} (Identity & Address Proof)` : `${idType} (Primary ID Proof)`,
              documentUrl: resolvedIdUrl,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          // 2. Address Proof Document (only if distinct and not duplicate Aadhaar)
          if (resolvedAddrUrl && !isCombinedAadhaar && resolvedAddrUrl !== resolvedIdUrl) {
            list.push({
              id: `${app._id}-addressproof`,
              documentType: 'Address Proof Document',
              documentName: `${addrType} (Address Proof Document)`,
              documentUrl: resolvedAddrUrl,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          // 3. Photograph
          if (resolvedPhotoUrl) {
            list.push({
              id: `${app._id}-photo`,
              documentType: 'Photograph',
              documentName: 'Passport Photograph',
              documentUrl: resolvedPhotoUrl,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          // 4. Signature
          if (resolvedSigUrl) {
            list.push({
              id: `${app._id}-signature`,
              documentType: 'Signature',
              documentName: 'Digital Signature Specimen',
              documentUrl: resolvedSigUrl,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          // 5. Educational Degree / Certificate
          if (resolvedDoc3Url && !list.some(d => d.id === `${app._id}-edu`)) {
            list.push({
              id: `${app._id}-edu`,
              documentType: 'Educational Certificate',
              documentName: 'Educational Degree / Certificate',
              documentUrl: resolvedDoc3Url,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          // 6. Birth / PAN / Identity Certificate
          if (resolvedDoc4Url && !list.some(d => d.id === `${app._id}-birth`)) {
            list.push({
              id: `${app._id}-birth`,
              documentType: 'Birth / PAN Certificate',
              documentName: 'Birth / PAN / Identity Certificate',
              documentUrl: resolvedDoc4Url,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          // 7. Utility Bill / Passbook Document
          if (resolvedDoc5Url && !list.some(d => d.id === `${app._id}-utility`)) {
            list.push({
              id: `${app._id}-utility`,
              documentType: 'Financial / Utility Document',
              documentName: 'Electricity Bill / Bank Passbook',
              documentUrl: resolvedDoc5Url,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          const receiptUrl = doc.paymentReceiptUrl || app.paymentDetails?.receiptUrl;
          if (receiptUrl && !list.some(d => d.id === `${app._id}-paymentreceipt`)) {
            list.push({
              id: `${app._id}-paymentreceipt`,
              documentType: 'Payment Receipt',
              documentName: '₹200 Statutory Membership Payment Screenshot',
              documentUrl: receiptUrl,
              uploadedAt: app.submittedAt || app.createdAt,
              verificationStatus: defaultVerification,
            });
          }

          if (Array.isArray(doc.additionalDocuments)) {
            doc.additionalDocuments.forEach((addDoc, idx) => {
              const addDocId = addDoc._id ? addDoc._id.toString() : `${app._id}-add-${idx}`;
              if (addDoc.documentUrl && !list.some(d => d.id === addDocId || (d.documentType === addDoc.documentType && d.documentUrl === addDoc.documentUrl))) {
                list.push({
                  id: addDocId,
                  documentType: addDoc.documentType || 'Additional Document',
                  documentName: addDoc.documentName || addDoc.documentType || 'Supporting Document',
                  documentUrl: addDoc.documentUrl,
                  uploadedAt: addDoc.uploadedAt || app.submittedAt || app.createdAt,
                  verificationStatus: defaultVerification,
                });
              }
            });
          }

          return list;
        })(),
      };
    });

    // Provide allDocuments alias on each item for frontend backward compatibility
    documentsData.forEach((item) => {
      item.allDocuments = item.documents;
    });

    return res.status(200).json({
      success: true,
      count: documentsData.length,
      documents: documentsData,
    });
  } catch (error) {
    console.error('Error fetching application documents:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch application documents',
    });
  }
};

/**
 * @desc    Resend member credentials email for an approved application
 * @route   POST /api/applications/:id/resend-credentials
 * @access  Public / Admin
 */
const resendMemberCredentials = async (req, res) => {
  try {
    const { id } = req.params;

    let application = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      application = await Application.findById(id);
    }
    if (!application) {
      application = await Application.findOne({ applicationId: id });
    }

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found',
      });
    }

    if (application.status !== 'approved' || !application.memberId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot resend credentials. Application is not approved yet or has no member ID assigned.',
      });
    }

    const email = (application.contactDetails?.email || '').trim();
    if (!email) {
      application.credentialsEmailStatus = 'failed';
      await application.save();
      return res.status(400).json({
        success: false,
        message: 'Application has no registered contact email.',
      });
    }

    const existingUser = await User.findOne({
      $or: [
        { memberId: application.memberId },
        { applicationId: application._id },
        { email: email.toLowerCase() },
      ],
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: `Member account not found for Member ID "${application.memberId}"`,
      });
    }

    // Generate new secure temporary password
    const tempPassword = generateTempPassword(10);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    // Update existing member password
    existingUser.password = hashedPassword;
    existingUser.mustChangePassword = true;
    await existingUser.save();

    const p = application.personalDetails || {};
    const nameParts = [p.title, p.firstName, p.middleName, p.lastName].filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : existingUser.name || 'Member';

    // Safe development log
    console.log(`Resending credentials email for Member: ${application.memberId} (${application.applicationId || application._id})`);

    // Dispatch credentials email
    let emailSent = false;
    let emailError = null;
    try {
      const emailResult = await sendCredentialsEmail({
        email,
        name,
        applicationId: application.applicationId || application._id.toString(),
        memberId: application.memberId,
        tempPassword,
      });

      emailSent = emailResult.success === true;
      if (!emailSent && emailResult.error) {
        emailError = emailResult.error;
      }
    } catch (mailErr) {
      console.error(`Credentials email failed: ${mailErr.message}`);
      emailError = mailErr.message;
    }

    // Update status based on email delivery
    application.credentialsEmailStatus = emailSent ? 'sent' : 'failed';
    await application.save();

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: `Failed to dispatch email: ${emailError || 'SMTP Error'}`,
        applicationId: application.applicationId || application._id.toString(),
        memberId: application.memberId,
        credentialsEmailStatus: 'failed',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Credentials email resent successfully to ${email}`,
      applicationId: application.applicationId || application._id.toString(),
      memberId: application.memberId,
      emailSent: true,
      credentialsEmailStatus: 'sent',
    });
  } catch (error) {
    console.error('Error resending credentials:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to resend credentials',
    });
  }
};

/**
 * @desc    Serve document file directly through API (bypasses web server static rewrite issues)
 * @route   GET /api/applications/files/:filename
 * @access  Public
 */
const serveDocumentFile = (req, res) => {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!filename) {
      return res.status(400).json({ success: false, message: 'Filename is required' });
    }

    const filePath = path.join(__dirname, '../uploads/documents', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Document file not found on server',
      });
    }

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Error streaming document file:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve document file',
    });
  }
};

module.exports = {
  createApplication,
  getApplications,
  updateApplicationStatus,
  updateApplication,
  getApplicationDocuments,
  uploadDocuments,
  resendMemberCredentials,
  serveDocumentFile,
};



