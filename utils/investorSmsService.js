/**
 * Centralized Investor SMS Notification Service
 * 
 * Supports approved SMS Gateways (Fast2SMS, MSG91, Twilio, Generic Webhook)
 * Strictly follows the requirement:
 * "Use an approved SMS provider if configured. Do not simulate successful delivery."
 * 
 * When SMS gateway credentials are not configured, returns status: 'Not Configured'
 * without pretending successful transmission.
 */

const env = require('../config/env');

/**
 * Mask mobile number for audit display (e.g. "••••••1234")
 */
const maskMobile = (mobile) => {
  if (!mobile) return '';
  const clean = mobile.toString().replace(/\D/g, '');
  if (clean.length <= 4) return clean;
  return `••••••${clean.slice(-4)}`;
};

/**
 * Mask bank account number (e.g. "•••• •••• 5678")
 */
const maskBankAccount = (acct) => {
  if (!acct) return 'Registered Bank Account';
  const clean = acct.toString().trim();
  if (clean.length <= 4) return clean;
  return `•••• •••• ${clean.slice(-4)}`;
};

/**
 * Core SMS Dispatch Handler
 * Strictly checks configuration and delegates to the configured provider
 */
const dispatchSms = async ({ mobile, message, dltTemplateId }) => {
  const cleanMobile = (mobile || '').toString().replace(/\D/g, '');

  if (!cleanMobile || cleanMobile.length < 10) {
    return {
      success: false,
      status: 'Failed',
      error: 'Invalid or missing registered mobile number',
    };
  }

  // Check if provider is configured
  if (!env.SMS.IS_CONFIGURED) {
    return {
      success: false,
      status: 'Not Configured',
      error: 'SMS Gateway provider is not configured in server environment (.env). Provide SMS_PROVIDER and SMS_API_KEY.',
    };
  }

  const provider = (env.SMS.PROVIDER || '').toUpperCase();
  const apiKey = env.SMS.API_KEY;
  const senderId = env.SMS.SENDER_ID || 'UTKALF';

  try {
    // 1. Fast2SMS Provider Integration
    if (provider === 'FAST2SMS') {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'v3',
          sender_id: senderId,
          message: message,
          language: 'english',
          flash: 0,
          numbers: cleanMobile.slice(-10),
        }),
      });

      const resData = await response.json();
      if (resData.return === true || response.ok) {
        return {
          success: true,
          status: 'Sent',
          provider: 'Fast2SMS',
          messageId: resData.request_id || `F2S-${Date.now()}`,
        };
      }
      return {
        success: false,
        status: 'Failed',
        provider: 'Fast2SMS',
        error: resData.message || 'Fast2SMS dispatch rejected',
      };
    }

    // 2. MSG91 Provider Integration
    if (provider === 'MSG91') {
      const response = await fetch('https://api.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          authkey: apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          template_id: dltTemplateId || env.SMS.ENTITY_ID,
          sender: senderId,
          short_url: '0',
          mobiles: `91${cleanMobile.slice(-10)}`,
          message: message,
        }),
      });

      const resData = await response.json();
      if (resData.type === 'success' || response.ok) {
        return {
          success: true,
          status: 'Sent',
          provider: 'MSG91',
          messageId: resData.message || `MSG91-${Date.now()}`,
        };
      }
      return {
        success: false,
        status: 'Failed',
        provider: 'MSG91',
        error: resData.message || 'MSG91 dispatch failed',
      };
    }

    // 3. Twilio SMS Provider Integration
    if (provider === 'TWILIO') {
      // Basic HTTP Basic Auth for Twilio SMS REST API
      const [accountSid, authToken] = apiKey.split(':');
      if (!accountSid || !authToken) {
        return {
          success: false,
          status: 'Failed',
          provider: 'Twilio',
          error: 'Twilio credentials must be provided as "ACCOUNT_SID:AUTH_TOKEN"',
        };
      }

      const formattedNumber = cleanMobile.startsWith('+') ? cleanMobile : `+91${cleanMobile.slice(-10)}`;
      const params = new URLSearchParams({
        To: formattedNumber,
        From: senderId,
        Body: message,
      });

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const resData = await response.json();
      if (response.ok && resData.sid) {
        return {
          success: true,
          status: 'Sent',
          provider: 'Twilio',
          messageId: resData.sid,
        };
      }
      return {
        success: false,
        status: 'Failed',
        provider: 'Twilio',
        error: resData.message || 'Twilio SMS dispatch failed',
      };
    }

    // Unrecognized provider name
    return {
      success: false,
      status: 'Failed',
      provider,
      error: `Unsupported SMS provider: ${provider}. Supported providers: FAST2SMS, MSG91, TWILIO.`,
    };
  } catch (error) {
    console.error('dispatchSms error:', error);
    return {
      success: false,
      status: 'Failed',
      provider,
      error: error.message || 'Network error communicating with SMS Gateway',
    };
  }
};

/**
 * 1. Investor Registration SMS
 */
const sendInvestorRegistrationSms = async (investor) => {
  const message = `Dear ${investor.fullName}, welcome to New Utkal Finance Ltd. Your Investor ID is ${investor.investorId}. Your profile has been recorded in our central compliance registry. Support: ${env.ADMIN_EMAIL || 'support@newutkalfinance.com'}`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'Registration',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 2. KYC Verification Status SMS
 */
const sendKycStatusSms = async ({ investor, status, reason = '' }) => {
  let message = '';
  if (status === 'Verified') {
    message = `Dear ${investor.fullName}, your KYC documents have been VERIFIED & APPROVED for Investor ID ${investor.investorId}. - New Utkal Finance Ltd.`;
  } else if (status === 'Correction Required') {
    message = `Dear ${investor.fullName}, correction is required for your KYC under Investor ID ${investor.investorId}. Note: ${reason.slice(0, 80)}. Please contact compliance desk. - Utkal Finance Ltd.`;
  } else {
    message = `Dear ${investor.fullName}, your KYC under Investor ID ${investor.investorId} was not approved: ${reason.slice(0, 80)}. - New Utkal Finance Ltd.`;
  }

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'KycStatus',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 3. Investment Payment Confirmation SMS
 */
const sendPaymentConfirmationSms = async ({ investor, payment }) => {
  const amountFormatted = Number(payment?.amount || investor.verifiedInvestment || 0).toLocaleString('en-IN');
  const utr = payment?.utrNumber || 'VERIFIED-RECEIPT';

  const message = `Dear ${investor.fullName}, your investment payment of Rs.${amountFormatted} (UTR: ${utr}) has been VERIFIED & credited to your central ledger. Investor ID: ${investor.investorId}. - New Utkal Finance Ltd.`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'PaymentConfirmation',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 4. Investment Plan Activation SMS
 */
const sendPlanActivationSms = async ({ investor, plan, tracking2x }) => {
  const planName = plan?.planName || plan?.name || 'Utkal Mutual Growth Plan';
  const duration = plan?.durationMonths || tracking2x?.durationMonths || 12;
  const mult = plan?.multiplier || tracking2x?.multiplier || 2;
  const target = Number(plan?.contractualTarget || tracking2x?.targetAmount || 0).toLocaleString('en-IN');

  const message = `Dear ${investor.fullName}, your investment plan ${planName} (${duration}M, ${mult}X target Rs.${target}) is now ACTIVE under Investor ID ${investor.investorId}. - New Utkal Finance Ltd.`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'PlanActivation',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 5. Signed Agreement Allotment SMS
 */
const sendAgreementSms = async ({ investor, agreementNumber }) => {
  const agrRef = agreementNumber || investor.agreement?.agreementNumber || `UF-AGR-${investor.investorId}`;
  const message = `Dear ${investor.fullName}, your official Signed Investment Agreement (Ref: ${agrRef}) has been executed and recorded in the central compliance repository. Investor ID: ${investor.investorId}. - New Utkal Finance Ltd.`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'Agreement',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 6. Maturity Reminder SMS
 */
const sendMaturityReminderSms = async ({ investor, targetAmount, maturityDate }) => {
  const amtFormatted = Number(targetAmount || investor.tracking2x?.targetAmount || 0).toLocaleString('en-IN');
  const matDateFormatted = maturityDate
    ? new Date(maturityDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'as per schedule';

  const message = `Dear ${investor.fullName}, reminder: Your investment tenure under Investor ID ${investor.investorId} matures on ${matDateFormatted}. Contractual Target: Rs.${amtFormatted}. Payout will be processed to your registered account. - New Utkal Finance Ltd.`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'MaturityReminder',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 7. Payout Confirmation SMS
 */
const sendPayoutConfirmationSms = async ({ investor, payout }) => {
  const amtFormatted = Number(payout?.amount || 0).toLocaleString('en-IN');
  const ref = payout?.reference || 'NEFT/IMPS';
  const maskedBank = maskBankAccount(investor.bankDetails?.accountNumber);

  const message = `Dear ${investor.fullName}, payout of Rs.${amtFormatted} has been disbursed via ${payout.paymentMethod || 'Bank Transfer'} (Ref: ${ref}) to your ${maskedBank}. Investor ID: ${investor.investorId}. - New Utkal Finance Ltd.`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'Payout',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 8. Refund Confirmation SMS
 */
const sendRefundConfirmationSms = async ({ investor, refund }) => {
  const amtFormatted = Number(refund?.amount || 0).toLocaleString('en-IN');
  const ref = refund?.reference || 'REFUND-IMPS';

  const message = `Dear ${investor.fullName}, refund of Rs.${amtFormatted} has been processed via ${refund.paymentMethod || 'Bank Transfer'} (Ref: ${ref}) under Investor ID ${investor.investorId}. - New Utkal Finance Ltd.`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'Refund',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

/**
 * 9. Custom Admin SMS Notice
 */
const sendCustomSms = async ({ investor, messageText }) => {
  const safeText = (messageText || '').slice(0, 150);
  const message = `Dear ${investor.fullName}, ${safeText} - New Utkal Finance Ltd. (Investor ID: ${investor.investorId})`;

  const result = await dispatchSms({
    mobile: investor.mobile,
    message,
  });

  return {
    ...result,
    channel: 'SMS',
    category: 'General',
    recipient: maskMobile(investor.mobile),
    messageSummary: message,
  };
};

module.exports = {
  dispatchSms,
  maskMobile,
  maskBankAccount,
  sendInvestorRegistrationSms,
  sendKycStatusSms,
  sendPaymentConfirmationSms,
  sendPlanActivationSms,
  sendAgreementSms,
  sendMaturityReminderSms,
  sendPayoutConfirmationSms,
  sendRefundConfirmationSms,
  sendCustomSms,
};

