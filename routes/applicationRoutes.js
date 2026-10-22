const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const {
  createApplication,
  getApplications,
  updateApplicationStatus,
  updateApplication,
  getApplicationDocuments,
  uploadDocuments,
  resendMemberCredentials,
  serveDocumentFile,
} = require('../controllers/applicationController');

// GET /api/applications/files/:filename - Stream document directly through API (bypasses static web server rewrite bugs)
router.get('/files/:filename', serveDocumentFile);

// GET /api/applications/documents - Get all real document records from MongoDB
router.get('/documents', getApplicationDocuments);

// POST /api/applications/upload-documents - Upload application documents
router.post('/upload-documents', upload.any(), uploadDocuments);

// GET /api/applications - Get all membership applications
router.get('/', getApplications);

// POST /api/applications - Submit new membership application
router.post('/', upload.any(), createApplication);

// PUT & PATCH /api/applications/:id - Update/Edit application details
router.put('/:id', upload.any(), updateApplication);
router.patch('/:id', upload.any(), updateApplication);

// PATCH /api/applications/:id/status - Update application status (Admin approval)
router.patch('/:id/status', updateApplicationStatus);

// POST /api/applications/:id/resend-credentials - Resend member credentials email
router.post('/:id/resend-credentials', resendMemberCredentials);

module.exports = router;

