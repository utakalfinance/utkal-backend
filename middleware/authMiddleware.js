const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const Application = require('../models/Application');

/**
 * Protect routes: Verify JWT token & attach user to req.user
 */
const protect = async (req, res, next) => {
  let token = null;

  if (req.headers.authorization && typeof req.headers.authorization === 'string') {
    const authHeader = req.headers.authorization.trim();
    if (authHeader.startsWith('Bearer ') || authHeader.startsWith('Bearer')) {
      const parts = authHeader.split(/\s+/);
      if (parts.length > 1) {
        token = parts[1].trim();
      }
    }
  }

  // Reject if token is missing, empty, or string literal 'undefined'/'null'
  if (!token || token === 'undefined' || token === 'null' || token === '') {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (decoded.id === 'admin-root' || decoded.role === 'admin' || decoded.role === 'super_admin') {
      req.user = {
        _id: 'admin-root',
        name: 'Administrator',
        email: decoded.email || env.ADMIN_EMAIL || 'admin@newutkalfinance.com',
        role: 'super_admin',
        status: 'active',
      };
      return next();
    }

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized: User account not found',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}. Please contact administrator.`,
      });
    }

    // If member user, check if application has been rejected
    if (user.role === 'member') {
      const application = user.applicationId
        ? await Application.findById(user.applicationId)
        : (user.memberId
            ? await Application.findOne({ memberId: user.memberId })
            : (user.email ? await Application.findOne({ 'contactDetails.email': user.email }) : null));

      if (application && application.status === 'rejected') {
        if (user.status === 'active') {
          user.status = 'inactive';
          await user.save().catch(() => {});
        }
        return res.status(403).json({
          success: false,
          message: 'Your membership application has been rejected by the administrator. Access to the Member Dashboard is not permitted.',
        });
      }
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error('JWT Auth Error:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token invalid or expired',
    });
  }
};

/**
 * Role authorization middleware
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user?.role;
    // Map 'admin' and 'super_admin' interchangeably for backward compatibility
    const hasRole =
      roles.includes(userRole) ||
      ((userRole === 'admin' || userRole === 'super_admin') &&
        (roles.includes('admin') || roles.includes('super_admin')));

    if (!req.user || !hasRole) {
      return res.status(403).json({
        success: false,
        message: `User role '${userRole}' is not authorized to access this resource`,
      });
    }
    next();
  };
};

module.exports = {
  protect,
  authorize,
};
