const nodemailer = require('nodemailer');
const env = require('../config/env');

/**
 * Creates Nodemailer Transporter based on centralized environment variables
 */
const createTransporter = () => {
  if (!env.EMAIL.IS_CONFIGURED) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.EMAIL.HOST,
    port: env.EMAIL.PORT,
    secure: env.EMAIL.SECURE,
    auth: {
      user: env.EMAIL.USER,
      pass: env.EMAIL.PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
};

/**
 * Helper: Mask Email for security display (e.g. "t***v@gmail.com")
 */
const maskEmail = (email) => {
  if (!email) return '';
  const clean = email.trim();
  const parts = clean.split('@');
  if (parts.length !== 2) return clean;
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return `${name.charAt(0)}***@${domain}`;
  return `${name.charAt(0)}***${name.charAt(name.length - 1)}@${domain}`;
};

/**
 * Helper: Mask Bank Account for security display (e.g. "•••• •••• 5678")
 */
const maskBankAccount = (acct) => {
  if (!acct) return 'Registered Bank Account';
  const clean = acct.toString().trim();
  if (clean.length <= 4) return clean;
  return `•••• •••• ${clean.slice(-4)}`;
};

/**
 * Helper: Mask PAN for security display (e.g. "•••••1234•")
 */
const maskPan = (pan) => {
  if (!pan) return '';
  const clean = pan.toString().trim().toUpperCase();
  if (clean.length < 5) return clean;
  return `••••••${clean.slice(clean.length - 4)}`;
};

/**
 * Helper: Mask Aadhaar for security display (e.g. "•••• •••• 1234")
 */
const maskAadhaar = (aadhaar) => {
  if (!aadhaar) return '';
  const clean = aadhaar.toString().replace(/\D/g, '');
  if (clean.length < 4) return clean;
  return `•••• •••• ${clean.slice(-4)}`;
};

const COMPANY_NAME = 'New Utkal Finance Ltd.';

/**
 * Standard branded email shell wrapper
 */
const renderEmailShell = ({ title, badgeText, badgeBg = 'rgba(255,255,255,0.15)', bodyHtml }) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #0A1628 0%, #102244 50%, #1E3A8A 100%); color: #ffffff; padding: 32px 28px; text-align: center; }
    .badge { display: inline-block; background: ${badgeBg}; padding: 6px 14px; border-radius: 9999px; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 12px; }
    .title { font-size: 20px; font-weight: 900; margin: 0; letter-spacing: -0.01em; }
    .body { padding: 32px 28px; }
    .greeting { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    .info-box { background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px dashed #cbd5e1; font-size: 13px; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; font-weight: 600; }
    .info-val { font-weight: 700; color: #0f172a; font-family: monospace; }
    .terms-box { background: #f1f5f9; border-left: 4px solid #2563eb; padding: 14px 16px; border-radius: 4px; font-size: 12px; color: #334155; margin: 18px 0; line-height: 1.5; }
    .footer { background: #f8fafc; padding: 20px 28px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge">${badgeText}</div>
      <h1 class="title">${title}</h1>
    </div>
    <div class="body">
      ${bodyHtml}
      <p style="font-size: 12px; color: #64748b; margin-top: 28px; line-height: 1.5;">
        <strong>Statutory Compliance & Security Note:</strong><br>
        For security, sensitive identity numbers and bank accounts are masked. No login portal or password is required for investors. Your capital and agreements are secured in the central company compliance ledger.
      </p>
      <p style="font-size: 12px; color: #334155; margin-top: 16px;">
        <strong>${COMPANY_NAME} • Compliance Desk</strong><br>
        Support: <a href="mailto:${env.ADMIN_EMAIL || 'support@newutkalfinance.com'}" style="color: #2563eb;">${env.ADMIN_EMAIL || 'support@newutkalfinance.com'}</a>
      </p>
    </div>
    <div class="footer">
      Official Statutory Communication • ${COMPANY_NAME}<br>
      Trust • Growth • Prosperity • Statutory Double-Entry Accounting
    </div>
  </div>
</body>
</html>
`;

/**
 * 1. Send Investor Registration Acknowledgement Email
 */
const sendInvestorRegistrationEmail = async (investor) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server (Missing EMAIL_USER / EMAIL_PASSWORD)' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Welcome to ${COMPANY_NAME} - Investor Registration Acknowledgement [${investor.investorId}]`;

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      Thank you for registering with <strong>${COMPANY_NAME}</strong>. Your investor profile has been successfully recorded in our central compliance registry.
    </p>

    <div class="info-box">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Full Name:</span><span class="info-val" style="font-family: inherit;">${investor.fullName}</span></div>
      <div class="info-row"><span class="info-label">Registered District:</span><span class="info-val" style="font-family: inherit;">${investor.district}, ${investor.state || 'Odisha'}</span></div>
      <div class="info-row"><span class="info-label">Registered Mobile:</span><span class="info-val">${investor.mobile}</span></div>
      <div class="info-row"><span class="info-label">KYC Status:</span><span class="info-val">${investor.kycStatus}</span></div>
      <div class="info-row"><span class="info-label">Masked Aadhaar:</span><span class="info-val">${maskAadhaar(investor.aadhaarNumber)}</span></div>
      <div class="info-row"><span class="info-label">Masked PAN:</span><span class="info-val">${maskPan(investor.panNumber)}</span></div>
    </div>

    <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
      Our compliance team will review your submitted KYC documents and payment records. An official investment confirmation with your approved plan and statutory agreement will be issued following payment verification.
    </p>
  `;

  const html = renderEmailShell({
    title: 'Registration Acknowledgement',
    badgeText: 'Official Investor Registry',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Registration acknowledgement sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendInvestorRegistrationEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 2. Send KYC Status Email (Verified / Correction Requested / Rejected)
 */
const sendKycStatusEmail = async ({ investor, status, reason = '', instructions = '' }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `KYC Compliance Update: ${status} - ${investor.investorId} [${COMPANY_NAME}]`;

  let statusBadgeBg = '#047857';
  let statusBadgeText = 'KYC VERIFIED & APPROVED';
  let statusNote = 'Your KYC documentation has been thoroughly audited and approved by the central compliance committee.';

  if (status === 'Correction Required') {
    statusBadgeBg = '#d97706';
    statusBadgeText = 'KYC CORRECTION REQUIRED';
    statusNote = `Our verification team identified items needing clarification: <strong>${instructions || reason || 'Document re-upload requested'}</strong>. Please connect with the central desk.`;
  } else if (status === 'Rejected') {
    statusBadgeBg = '#dc2626';
    statusBadgeText = 'KYC NOT APPROVED';
    statusNote = `Your KYC documents could not be approved due to: <strong>${reason || 'Non-compliance with verification norms'}</strong>.`;
  }

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      This is an official compliance notice regarding your KYC verification status under Investor ID <strong>${investor.investorId}</strong>.
    </p>

    <div class="info-box">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Investor Name:</span><span class="info-val" style="font-family: inherit;">${investor.fullName}</span></div>
      <div class="info-row"><span class="info-label">KYC Status:</span><span class="info-val" style="color: ${status === 'Verified' ? '#047857' : '#d97706'}; font-weight: 800;">${status}</span></div>
      <div class="info-row"><span class="info-label">Aadhaar (Masked):</span><span class="info-val">${maskAadhaar(investor.aadhaarNumber)}</span></div>
      <div class="info-row"><span class="info-label">PAN (Masked):</span><span class="info-val">${maskPan(investor.panNumber)}</span></div>
      <div class="info-row"><span class="info-label">Audit Timestamp:</span><span class="info-val">${new Date().toLocaleString('en-IN')}</span></div>
    </div>

    <div class="terms-box" style="border-left-color: ${status === 'Verified' ? '#047857' : '#d97706'};">
      <strong>Compliance Audit Finding:</strong><br>
      ${statusNote}
    </div>
  `;

  const html = renderEmailShell({
    title: `KYC Compliance Notice: ${status}`,
    badgeText: statusBadgeText,
    badgeBg: statusBadgeBg,
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `KYC status update (${status}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendKycStatusEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 3. Send Official Investment Confirmation Email
 * Strictly includes all confirmed details required by user:
 * - Investor ID
 * - Investor Name
 * - Verified Investment Amount
 * - Approved Plan Name
 * - Contractual Multiplier
 * - Approved Percentage and its basis
 * - Plan Duration
 * - Investment Start Date
 */
const sendInvestmentConfirmationEmail = async ({ investor, payment, plan }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  // Pre-condition check: payment must be verified
  if (!payment || payment.status !== 'Verified') {
    return { success: false, error: 'Cannot send confirmation email: Payment is not verified' };
  }

  // Pre-condition check: plan must be assigned
  if (!plan || !plan.planName) {
    return { success: false, error: 'Cannot send confirmation email: Approved plan is not assigned' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Official Investment Confirmation & Allotment Certificate - [${investor.investorId}]`;

  const verifiedAmountFormatted = Number(payment.amount || investor.verifiedInvestment || 0).toLocaleString('en-IN');
  const planDurationText = `${plan.durationMonths || 12} Months`;
  const multiplierText = `${plan.multiplier || 2}X`;
  const percentageBasis = plan.percentageBasis || 'Total Contractual Percentage';
  const approvedPercentage = `${plan.contractualPercentage ?? 100}% (${percentageBasis})`;
  const startDateText = plan.assignedDate || investor.investmentDate || new Date();
  const startDateFormatted = new Date(startDateText).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const agreementRef = investor.agreement?.agreementNumber || `UF-AGR-${investor.investorId}`;
  const maskedBank = maskBankAccount(investor.bankDetails?.accountNumber);

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      We are pleased to confirm that your investment payment has been <strong>verified and credited</strong> to your central ledger by the accounts department of <strong>${COMPANY_NAME}</strong>.
    </p>

    <div class="info-box" style="background: #f0fdf4; border-color: #bbf7d0;">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Investor Name:</span><span class="info-val" style="font-family: inherit;">${investor.fullName}</span></div>
      <div class="info-row"><span class="info-label">Verified Investment Amount:</span><span class="info-val" style="color: #064e3b; font-size: 14px;">₹${verifiedAmountFormatted}</span></div>
      <div class="info-row"><span class="info-label">Approved Plan Name:</span><span class="info-val" style="font-family: inherit;">${plan.planName} (v${plan.version || '1.0'})</span></div>
      <div class="info-row"><span class="info-label">Contractual Multiplier:</span><span class="info-val">${multiplierText}</span></div>
      <div class="info-row"><span class="info-label">Approved Percentage & Basis:</span><span class="info-val">${approvedPercentage}</span></div>
      <div class="info-row"><span class="info-label">Plan Duration:</span><span class="info-val">${planDurationText}</span></div>
      <div class="info-row"><span class="info-label">Investment Start Date:</span><span class="info-val">${startDateFormatted}</span></div>
      <div class="info-row"><span class="info-label">Payment UTR / Ref:</span><span class="info-val">${payment.utrNumber || 'VERIFIED-LEDGER'}</span></div>
      <div class="info-row"><span class="info-label">Registered Settlement Bank:</span><span class="info-val">${maskedBank}</span></div>
      <div class="info-row"><span class="info-label">Agreement Reference:</span><span class="info-val">${agreementRef}</span></div>
    </div>

    <div class="terms-box">
      <strong>Statutory Compliance Terms:</strong><br>
      Capital receipts are recorded as investor equity and liabilities in accordance with double-entry accounting standards. Contractual target liabilities are updated upon formal activation.
    </div>
  `;

  const html = renderEmailShell({
    title: 'Investment Confirmation & Plan Allotment',
    badgeText: 'Official Investment Allotment',
    badgeBg: 'rgba(5, 150, 105, 0.25)',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Investment confirmation (₹${verifiedAmountFormatted}, ${plan.planName}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendInvestmentConfirmationEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 4. Send Investment Plan Activation Email
 */
const sendPlanActivationEmail = async ({ investor, plan, tracking2x }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Investment Plan Activated - [${investor.investorId}] ${COMPANY_NAME}`;

  const planName = plan?.planName || plan?.name || 'Utkal Mutual Capital Growth Plan';
  const durationText = `${plan?.durationMonths || tracking2x?.durationMonths || 12} Months`;
  const multiplierText = `${plan?.multiplier || tracking2x?.multiplier || 2}X`;
  const targetFormatted = Number(plan?.contractualTarget || tracking2x?.targetAmount || 0).toLocaleString('en-IN');
  const maturityFormatted = (plan?.maturityDate || tracking2x?.maturityDate)
    ? new Date(plan?.maturityDate || tracking2x?.maturityDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'As per contractual tenure';

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      Your approved investment plan <strong>${planName}</strong> has been formally <strong>ACTIVATED</strong> in the central financial tracking ledger.
    </p>

    <div class="info-box" style="background: #eef2ff; border-color: #c7d2fe;">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Plan Name:</span><span class="info-val" style="font-family: inherit;">${planName}</span></div>
      <div class="info-row"><span class="info-label">Tenure Duration:</span><span class="info-val">${durationText}</span></div>
      <div class="info-row"><span class="info-label">Contractual Multiplier:</span><span class="info-val">${multiplierText}</span></div>
      <div class="info-row"><span class="info-label">Contractual Target Amount:</span><span class="info-val" style="color: #4338ca; font-size: 14px;">₹${targetFormatted}</span></div>
      <div class="info-row"><span class="info-label">Calculated Maturity Date:</span><span class="info-val">${maturityFormatted}</span></div>
      <div class="info-row"><span class="info-label">Ledger Tracking Status:</span><span class="info-val" style="color: #047857; font-weight: 800;">ACTIVE</span></div>
    </div>

    <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
      Your capital tracking is now live under double-entry records. Eligible payouts and returns will be credited automatically to your registered bank account upon maturity or agreed milestone dates.
    </p>
  `;

  const html = renderEmailShell({
    title: 'Investment Plan Activated',
    badgeText: 'Ledger Tracking Active',
    badgeBg: 'rgba(79, 70, 229, 0.25)',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Plan activation notice (${planName}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendPlanActivationEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 5. Send Signed Investment Agreement Delivery Email
 */
const sendAgreementEmail = async ({ investor, agreementUrl, agreementNumber }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Official Investment Agreement Executed - [${investor.investorId}]`;
  const agreementRef = agreementNumber || investor.agreement?.agreementNumber || `UF-AGR-${investor.investorId}`;

  // Build secure agreement document reference (link pointing to asset or support inquiry)
  const fullAgreementUrl = agreementUrl
    ? (agreementUrl.startsWith('http') ? agreementUrl : `${env.FRONTEND_URL}${agreementUrl}`)
    : `${env.FRONTEND_URL}/admin/agreement-view?ref=${agreementRef}`;

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      Your official <strong>Signed Investment Agreement</strong> has been formally verified, executed, and archived in the central compliance repository of <strong>${COMPANY_NAME}</strong>.
    </p>

    <div class="info-box">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Agreement Reference:</span><span class="info-val">${agreementRef}</span></div>
      <div class="info-row"><span class="info-label">Investor Name:</span><span class="info-val" style="font-family: inherit;">${investor.fullName}</span></div>
      <div class="info-row"><span class="info-label">Status:</span><span class="info-val" style="color: #047857; font-weight: 800;">EXECUTED</span></div>
      <div class="info-row"><span class="info-label">Execution Date:</span><span class="info-val">${new Date().toLocaleDateString('en-IN')}</span></div>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${fullAgreementUrl}" style="display: inline-block; background: #0A1628; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 13px;">
        View Secure Agreement Document
      </a>
    </div>

    <p style="font-size: 11px; color: #64748b; text-align: center;">
      This link is for confidential investor record inspection. Do not forward or distribute to unauthorized persons.
    </p>
  `;

  const html = renderEmailShell({
    title: 'Investment Agreement Executed',
    badgeText: 'Legal & Statutory Record',
    badgeBg: 'rgba(30, 58, 138, 0.25)',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Signed agreement notice (${agreementRef}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendAgreementEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 6. Send Maturity Reminder Email
 */
const sendMaturityReminderEmail = async ({ investor, targetAmount, maturityDate, plan }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Advance Notice: Investment Approaching Maturity - [${investor.investorId}]`;

  const targetFormatted = Number(targetAmount || investor.tracking2x?.targetAmount || 0).toLocaleString('en-IN');
  const maturityFormatted = maturityDate
    ? new Date(maturityDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'As scheduled';
  const maskedBank = maskBankAccount(investor.bankDetails?.accountNumber);

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      This is an advance statutory notification that your investment under Investor ID <strong>${investor.investorId}</strong> is approaching its contractual maturity date.
    </p>

    <div class="info-box" style="background: #fffbeb; border-color: #fde68a;">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Plan Name:</span><span class="info-val" style="font-family: inherit;">${plan?.planName || investor.assignedPlan?.planName || 'Utkal Mutual Capital Growth Plan'}</span></div>
      <div class="info-row"><span class="info-label">Contractual Target Payout:</span><span class="info-val" style="color: #b45309; font-size: 14px;">₹${targetFormatted}</span></div>
      <div class="info-row"><span class="info-label">Maturity Date:</span><span class="info-val">${maturityFormatted}</span></div>
      <div class="info-row"><span class="info-label">Designated Settlement Account:</span><span class="info-val">${maskedBank}</span></div>
    </div>

    <div class="terms-box">
      <strong>Maturity Settlement Procedure:</strong><br>
      Upon maturity, settlement amounts will be disbursed directly to your registered bank account via NEFT / RTGS / IMPS. Please verify with our desk if your registered bank details have changed.
    </div>
  `;

  const html = renderEmailShell({
    title: 'Investment Maturity Advance Notice',
    badgeText: 'Maturity Schedule Notice',
    badgeBg: 'rgba(217, 119, 6, 0.25)',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Maturity reminder (Maturity: ${maturityFormatted}, Target: ₹${targetFormatted}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendMaturityReminderEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 7. Send Payout Confirmation Email
 */
const sendPayoutConfirmationEmail = async ({ investor, payout }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Payout Disbursement Advice - [${investor.investorId}] ${COMPANY_NAME}`;

  const amountFormatted = Number(payout.amount || 0).toLocaleString('en-IN');
  const maskedBank = maskBankAccount(investor.bankDetails?.accountNumber);
  const payoutRef = payout.reference || payout.payoutId || 'IMPS-DISBURSED';

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      We confirm that a payout of <strong>₹${amountFormatted}</strong> has been successfully processed and disbursed by <strong>${COMPANY_NAME}</strong>.
    </p>

    <div class="info-box" style="background: #fdf2f8; border-color: #fbcfe8;">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Payout Amount:</span><span class="info-val" style="color: #9d174d; font-size: 14px;">₹${amountFormatted}</span></div>
      <div class="info-row"><span class="info-label">Payment Method:</span><span class="info-val">${payout.paymentMethod || 'Bank Transfer'}</span></div>
      <div class="info-row"><span class="info-label">Transaction Reference:</span><span class="info-val">${payoutRef}</span></div>
      <div class="info-row"><span class="info-label">Disbursement Date:</span><span class="info-val">${new Date().toLocaleString('en-IN')}</span></div>
      <div class="info-row"><span class="info-label">Settlement Bank Account:</span><span class="info-val">${maskedBank}</span></div>
    </div>

    <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
      The transaction has been debited from your investor ledger under double-entry accounting records. Depending on your bank's processing cycle, funds should reflect in your statement within standard banking hours.
    </p>
  `;

  const html = renderEmailShell({
    title: 'Payout Disbursement Advice',
    badgeText: 'Payout Advice Voucher',
    badgeBg: 'rgba(157, 23, 77, 0.25)',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Payout advice (₹${amountFormatted}, Ref: ${payoutRef}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendPayoutConfirmationEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 8. Send Refund Confirmation Email
 */
const sendRefundConfirmationEmail = async ({ investor, refund }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = `Refund Settlement Advice - [${investor.investorId}] ${COMPANY_NAME}`;

  const amountFormatted = Number(refund.amount || 0).toLocaleString('en-IN');
  const refundRef = refund.reference || refund.payoutId || 'REFUND-IMPS';

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <p style="font-size: 13px; line-height: 1.6; color: #334155;">
      This notice confirms that a capital refund of <strong>₹${amountFormatted}</strong> has been processed for your profile under Investor ID <strong>${investor.investorId}</strong>.
    </p>

    <div class="info-box">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Refund Amount:</span><span class="info-val" style="color: #0f172a; font-size: 14px;">₹${amountFormatted}</span></div>
      <div class="info-row"><span class="info-label">Payment Method:</span><span class="info-val">${refund.paymentMethod || 'Bank Transfer'}</span></div>
      <div class="info-row"><span class="info-label">Reference Number:</span><span class="info-val">${refundRef}</span></div>
      <div class="info-row"><span class="info-label">Processing Date:</span><span class="info-val">${new Date().toLocaleString('en-IN')}</span></div>
    </div>

    <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
      The refunded amount has been posted to your central ledger. If you have any inquiries regarding this refund settlement, please contact the central accounts desk.
    </p>
  `;

  const html = renderEmailShell({
    title: 'Refund Settlement Advice',
    badgeText: 'Refund Processed',
    badgeBg: 'rgba(71, 85, 105, 0.25)',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Refund settlement advice (₹${amountFormatted}) sent to ${maskEmail(recipientEmail)}`,
    };
  } catch (error) {
    console.error('sendRefundConfirmationEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 9. Send Custom Official Notice Email
 */
const sendCustomEmail = async ({ investor, subject: customSub, messageBody }) => {
  const recipientEmail = (investor?.email || '').trim();
  if (!recipientEmail) {
    return { success: false, error: 'Recipient email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured on server' };
  }

  const fromAddress = env.EMAIL.FROM || `${COMPANY_NAME} <${env.EMAIL.USER}>`;
  const subject = customSub || `Official Communication from ${COMPANY_NAME} [${investor.investorId}]`;

  const bodyHtml = `
    <div class="greeting">Dear ${investor.fullName},</div>
    <div style="font-size: 13px; line-height: 1.7; color: #334155; margin: 16px 0; white-space: pre-wrap;">
      ${messageBody}
    </div>
    <div class="info-box">
      <div class="info-row"><span class="info-label">Investor ID:</span><span class="info-val">${investor.investorId}</span></div>
      <div class="info-row"><span class="info-label">Registered Name:</span><span class="info-val" style="font-family: inherit;">${investor.fullName}</span></div>
      <div class="info-row"><span class="info-label">Notice Date:</span><span class="info-val">${new Date().toLocaleString('en-IN')}</span></div>
    </div>
  `;

  const html = renderEmailShell({
    title: 'Official Executive Notice',
    badgeText: 'Official Communication',
    bodyHtml,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });
    return {
      success: true,
      messageId: info.messageId,
      subject,
      recipient: maskEmail(recipientEmail),
      messageSummary: `Custom notice sent to ${maskEmail(recipientEmail)}: "${(customSub || '').slice(0, 40)}"`,
    };
  } catch (error) {
    console.error('sendCustomEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  maskEmail,
  maskBankAccount,
  maskPan,
  maskAadhaar,
  sendInvestorRegistrationEmail,
  sendKycStatusEmail,
  sendInvestmentConfirmationEmail,
  sendPlanActivationEmail,
  sendAgreementEmail,
  sendMaturityReminderEmail,
  sendPayoutConfirmationEmail,
  sendRefundConfirmationEmail,
  sendCustomEmail,
};
