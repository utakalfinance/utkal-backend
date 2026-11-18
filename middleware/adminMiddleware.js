const { protect, authorize } = require('./authMiddleware');

const adminOnly = [protect, authorize('admin')];
const adminOrAssociate = [protect, authorize('admin', 'associate')];

module.exports = {
  adminOnly,
  adminOrAssociate,
};
