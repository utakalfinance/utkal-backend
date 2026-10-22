const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const Application = require('../models/Application');

/**
 * Protect routes: Verify JWT token & attach user to req.user
 */
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, env.JWT_SECRET);

      if (decoded.id === 'admin-root' || decoded.role === 'admin') {
        req.user = {
          _id: 'admin-root',
          name: 'Administrator',
          email: decoded.email || env.ADMIN_EMAIL || 'admin@newutkalfinance.com',
          role: 'admin',
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

      // If non-admin user, check if application has been rejected
      if (user.role !== 'admin') {
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
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided',
    });
  }
};

/**
 * Role authorization middleware
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user?.role}' is not authorized to access this resource`,
      });
    }
    next();
  };
};

module.exports = {
  protect,
  authorize,
};
