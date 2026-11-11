const nodemailer = require('nodemailer');
const env = require('../config/env');

/**
 * Creates Nodemailer Transporter based on centralized environment variables
 * Configured specifically for Gmail SMTP on Port 465 (SSL/TLS)
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
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  });
};

/**
 * Send membership approval credentials email to applicant
 * @param {Object} options
 * @param {string} options.email - Applicant email address
 * @param {string} options.name - Applicant full name
 * @param {string} options.applicationId - Application ID (e.g. NUF-1010)
 * @param {string} options.memberId - Unique Member ID (e.g. NUF-M-0004)
 * @param {string} options.tempPassword - Plain temporary password (in-memory only)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendCredentialsEmail = async ({
  email,
  name,
  applicationId,
  memberId,
  tempPassword,
}) => {
  const recipientEmail = (email || '').trim();

  if (!recipientEmail) {
    const errorMsg = 'Recipient email is missing. Cannot dispatch credentials email.';
    console.error(`Credentials email failed: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
    };
  }

  const loginUrl = `${env.FRONTEND_URL}/member-login`;
  const fromAddress = env.EMAIL.FROM;

  const transporter = createTransporter();

  if (!transporter) {
    const errorMsg = 'Email service is not configured. Missing EMAIL_USER or EMAIL_PASSWORD in .env';
    console.error(`Credentials email failed: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
    };
  }

  const emailSubject = 'New Utkal Finance - Membership Approved';

  console.log(`Sending credentials email to: ${recipientEmail}`);

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f4f6f9;
      margin: 0;
      padding: 20px;
      color: #1e293b;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #0B1528 0%, #004085 100%);
      padding: 30px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }
    .header p {
      margin: 6px 0 0 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #93c5fd;
    }
    .content {
      padding: 30px;
    }
    .greeting {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }
    .message {
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
    }
    .credentials-card {
      background-color: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #004085;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .credential-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px dashed #e2e8f0;
      font-size: 13px;
    }
    .credential-row:last-child {
      border-bottom: none;
    }
    .credential-label {
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .credential-value {
      font-weight: 800;
      color: #0f172a;
      font-family: Consolas, Monaco, monospace;
    }
    .password-highlight {
      color: #b91c1c;
      background-color: #fee2e2;
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 800;
      font-size: 14px;
    }
    .btn-container {
      text-align: center;
      margin: 30px 0;
    }
    .btn-login {
      display: inline-block;
      background-color: #004085;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0, 64, 133, 0.25);
    }
    .notice {
      background-color: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      padding: 14px;
      font-size: 12px;
      color: #1e40af;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .footer {
      background-color: #f8fafc;
      padding: 20px 30px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>NEW UTKAL FINANCE LTD.</h1>
      <p>Statutory Membership Notification</p>
    </div>

    <div class="content">
      <div class="greeting">Dear ${name || 'Applicant'},</div>
      
      <p class="message">
        <strong>Congratulations!</strong> Your statutory membership application with <strong>New Utkal Finance Ltd.</strong> has been reviewed and officially <strong>approved</strong> by our administration team.
      </p>

      <div class="credentials-card">
        <div class="credential-row">
          <span class="credential-label">Application ID</span>
          <span class="credential-value">${applicationId}</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Member ID</span>
          <span class="credential-value">${memberId}</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Temporary Password</span>
          <span class="credential-value password-highlight">${tempPassword}</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Member Portal</span>
          <span class="credential-value"><a href="${loginUrl}" style="color: #004085; text-decoration: none;">${loginUrl}</a></span>
        </div>
      </div>

      <div class="btn-container">
        <a href="${loginUrl}" class="btn-login">Log In to Member Portal</a>
      </div>

      <div class="notice">
        <strong>Important Security Notice:</strong> This temporary password has been generated securely for your initial sign in. Please log in and change your temporary password immediately upon your first login.
      </div>

      <p class="message" style="margin-bottom: 0;">
        Regards,<br>
        <strong>New Utkal Finance Ltd.</strong><br>
        <span style="font-size: 12px; color: #64748b;">Member Operations & Compliance Department</span>
      </p>
    </div>

    <div class="footer">
      This is an automated system email from New Utkal Finance Ltd.<br>
      If you did not apply for membership, please contact our support team immediately.
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Dear ${name || 'Applicant'},

Congratulations!

Your membership application with New Utkal Finance Ltd. has been approved.

Application ID:
${applicationId}

Member ID:
${memberId}

Temporary Password:
${tempPassword}

Member Login:
${loginUrl}

Please log in and change your temporary password after your first login.

Regards,
New Utkal Finance Ltd.
  `.trim();

  const fromHeader = fromAddress.includes('<')
    ? fromAddress
    : `"New Utkal Finance Ltd." <${fromAddress}>`;

  try {
    const info = await transporter.sendMail({
      from: fromHeader,
      to: recipientEmail,
      subject: emailSubject,
      text: textContent,
      html: htmlContent,
    });

    console.log(`Credentials email sent successfully to: ${recipientEmail}`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error(`Credentials email failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send welcome & temporary login instructions email to newly registered District Administrator
 * @param {Object} options
 * @param {string} options.email - Admin email address
 * @param {string} options.name - Admin full name
 * @param {string} options.username - Admin username
 * @param {string} options.assignedDistrict - Assigned District circle (e.g. Khurda, Cuttack)
 * @param {string} options.tempPassword - Generated temporary password
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendDistrictAdminWelcomeEmail = async ({
  email,
  name,
  username,
  assignedDistrict,
  tempPassword,
}) => {
  const recipientEmail = (email || '').trim();

  if (!recipientEmail) {
    const errorMsg = 'Recipient email is missing. Cannot dispatch District Admin login instructions.';
    console.error(`District Admin email failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  const transporter = createTransporter();

  if (!transporter) {
    const errorMsg = 'Email service is not configured. Missing EMAIL_USER or EMAIL_PASSWORD in .env';
    console.error(`District Admin email notice: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  const loginUrl = `${env.FRONTEND_URL}/district-admin/login`;
  const fromAddress = env.EMAIL.FROM;
  const emailSubject = `Utkal Finance - District Administrator Access (${assignedDistrict || 'Nodal Circle'})`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
    .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #0B1528 0%, #1e3a8a 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    .header p { margin: 8px 0 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #93c5fd; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    .message { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .credentials-card { background-color: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #2563eb; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .credential-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }
    .credential-row:last-child { border-bottom: none; }
    .credential-label { color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    .credential-value { font-weight: 700; color: #0f172a; font-family: 'Courier New', Courier, monospace; font-size: 14px; }
    .btn-container { text-align: center; margin: 30px 0 24px 0; }
    .btn-login { display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff !important; padding: 14px 32px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 10px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35); }
    .notice { background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px; font-size: 12px; color: #92400e; line-height: 1.5; margin-bottom: 24px; }
    .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>NEW UTKAL FINANCE LIMITED</h1>
      <p>District Administration Portal • Access Provisioning</p>
    </div>
    <div class="content">
      <div class="greeting">Dear ${name || 'District Administrator'},</div>
      <p class="message">
        You have been appointed as the designated <strong>District Administrator</strong> for <strong>${assignedDistrict} Circle</strong> at New Utkal Finance Ltd. Your administrative portal account has been provisioned.
      </p>

      <div class="credentials-card">
        <div class="credential-row">
          <span class="credential-label">Assigned Circle</span>
          <span class="credential-value" style="color: #2563eb;">${assignedDistrict}</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Portal Role</span>
          <span class="credential-value">District Administrator</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Username / Login ID</span>
          <span class="credential-value">${username || recipientEmail}</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Registered Email</span>
          <span class="credential-value" style="font-family: inherit;">${recipientEmail}</span>
        </div>
        <div class="credential-row">
          <span class="credential-label">Temporary Password</span>
          <span class="credential-value" style="color: #b91c1c;">${tempPassword}</span>
        </div>
      </div>

      <div class="btn-container">
        <a href="${loginUrl}" class="btn-login">Log In to District Portal</a>
      </div>

      <div class="notice">
        <strong>Security Advisory:</strong> This temporary password has been issued strictly for your initial administrative login. For data privacy and statutory compliance, you are required to change your temporary password immediately upon first sign-in. Never disclose administrative credentials.
      </div>

      <p class="message" style="margin-bottom: 0;">
        Regards,<br>
        <strong>Executive Administration & Oversight</strong><br>
        <span style="font-size: 12px; color: #64748b;">New Utkal Finance Ltd.</span>
      </p>
    </div>

    <div class="footer">
      This is a secure automated notification from New Utkal Finance Ltd.<br>
      Portal Link: <a href="${loginUrl}" style="color: #2563eb;">${loginUrl}</a>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Dear ${name || 'District Administrator'},

Your District Administrator account for ${assignedDistrict} Circle at New Utkal Finance Ltd. has been provisioned.

Assigned Circle: ${assignedDistrict}
Username: ${username || recipientEmail}
Email: ${recipientEmail}
Temporary Password: ${tempPassword}

District Admin Login Portal:
${loginUrl}

Security Notice: This temporary password is for initial sign-in only. Please change your password upon your first login.

Regards,
New Utkal Finance Ltd.
  `.trim();

  const fromHeader = fromAddress.includes('<')
    ? fromAddress
    : `"New Utkal Finance Ltd." <${fromAddress}>`;

  try {
    const info = await transporter.sendMail({
      from: fromHeader,
      to: recipientEmail,
      subject: emailSubject,
      text: textContent,
      html: htmlContent,
    });

    console.log(`[District Admin Email] Sent successfully to: ${recipientEmail} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[District Admin Email] Dispatch failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendCredentialsEmail,
  sendDistrictAdminWelcomeEmail,
};
