const express = require('express');
const { body, validationResult } = require('express-validator');
const FoundReport = require('../models/FoundReport');
const MissingReport = require('../models/MissingReport');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Submit found report
router.post('/', authenticate, [
  body('missingId').isMongoId().withMessage('Valid missing report ID required'),
  body('photoUrl').isURL().withMessage('Valid photo URL required'),
  body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be 10-1000 characters'),
  body('locationFound.coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates required [longitude, latitude]'),
  body('locationFound.address').trim().isLength({ min: 5, max: 200 }).withMessage('Address must be 5-200 characters'),
  body('contactNumber').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit contact number required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { missingId, photoUrl, description, locationFound, contactNumber } = req.body;

    // Verify missing report exists and is active
    const missingReport = await MissingReport.findById(missingId)
      .populate('reportedBy', 'name email');

    if (!missingReport) {
      return res.status(404).json({
        success: false,
        message: 'Missing report not found'
      });
    }

    if (missingReport.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'This missing case is no longer active'
      });
    }

    const foundReport = new FoundReport({
      missingId,
      photoUrl,
      description,
      locationFound,
      foundBy: req.user._id,
      contactNumber
    });

    await foundReport.save();

    // Create notification for the family
    const notification = new Notification({
      type: 'found_alert',
      title: `Possible Match Found for ${missingReport.name}`,
      message: `Someone has reported finding a child matching ${missingReport.name}'s description. Please check the found report and verify if this is your child.`,
      targetUsers: [missingReport.reportedBy._id],
      relatedMissingId: missingId,
      relatedFoundId: foundReport._id,
      priority: 'urgent'
    });

    await notification.save();

    res.status(201).json({
      success: true,
      message: 'Found report submitted successfully. The family has been notified.',
      foundId: foundReport._id
    });

  } catch (error) {
    console.error('Create found report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit found report',
      error: error.message
    });
  }
});

// Get all found reports
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const foundReports = await FoundReport.find()
      .populate('missingId', 'name age gender photoUrl')
      .populate('foundBy', 'name phoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await FoundReport.countDocuments();

    res.status(200).json({
      success: true,
      foundReports,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalReports: total
      }
    });

  } catch (error) {
    console.error('Get found reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch found reports',
      error: error.message
    });
  }
});

// Get specific found report
router.get('/:foundId', authenticate, async (req, res) => {
  try {
    const foundReport = await FoundReport.findById(req.params.foundId)
      .populate('missingId', 'name age gender photoUrl description reportedBy')
      .populate('foundBy', 'name email phoneNumber profilePhotoUrl');

    if (!foundReport) {
      return res.status(404).json({
        success: false,
        message: 'Found report not found'
      });
    }

    res.status(200).json({
      success: true,
      foundReport
    });

  } catch (error) {
    console.error('Get found report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch found report',
      error: error.message
    });
  }
});

// Get found reports for specific missing case
router.get('/missing/:missingId', authenticate, async (req, res) => {
  try {
    const foundReports = await FoundReport.find({ missingId: req.params.missingId })
      .populate('foundBy', 'name phoneNumber profilePhotoUrl')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      foundReports
    });

  } catch (error) {
    console.error('Get missing found reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch found reports for this missing case',
      error: error.message
    });
  }
});

// Verify found report by parent
router.patch('/:foundId/verify', authenticate, [
  body('verifiedByParent').isBoolean().withMessage('Verification status must be boolean'),
  body('verificationNotes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const foundReport = await FoundReport.findById(req.params.foundId)
      .populate('missingId');

    if (!foundReport) {
      return res.status(404).json({
        success: false,
        message: 'Found report not found'
      });
    }

    // Check if user is the parent who reported the missing child
    if (foundReport.missingId.reportedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the parent who reported the missing child can verify this.'
      });
    }

    const { verifiedByParent, verificationNotes } = req.body;

    foundReport.verifiedByParent = verifiedByParent;
    foundReport.status = verifiedByParent ? 'verified' : 'rejected';
    if (verificationNotes) {
      foundReport.verificationNotes = verificationNotes;
    }

    await foundReport.save();

    // If verified, update missing report status
    if (verifiedByParent) {
      await MissingReport.findByIdAndUpdate(
        foundReport.missingId._id,
        { status: 'found' }
      );

      // Notify the finder
      const notification = new Notification({
        type: 'found_alert',
        title: 'Your Found Report Verified!',
        message: `Thank you for helping! The family has confirmed that you found their missing child. You've helped reunite a family!`,
        targetUsers: [foundReport.foundBy],
        relatedMissingId: foundReport.missingId._id,
        relatedFoundId: foundReport._id,
        priority: 'high'
      });

      await notification.save();
    }

    res.status(200).json({
      success: true,
      message: verifiedByParent ? 'Found report verified successfully!' : 'Found report marked as incorrect',
      updatedFoundReport: foundReport
    });

  } catch (error) {
    console.error('Verify found report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify found report',
      error: error.message
    });
  }
});

// Delete found report
router.delete('/:foundId', authenticate, async (req, res) => {
  try {
    const foundReport = await FoundReport.findById(req.params.foundId);

    if (!foundReport) {
      return res.status(404).json({
        success: false,
        message: 'Found report not found'
      });
    }

    // Check if user is the one who submitted the found report
    if (foundReport.foundBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own found reports.'
      });
    }

    await FoundReport.findByIdAndDelete(req.params.foundId);

    res.status(200).json({
      success: true,
      message: 'Found report deleted successfully'
    });

  } catch (error) {
    console.error('Delete found report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete found report',
      error: error.message
    });
  }
});

module.exports = router;