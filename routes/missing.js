const express = require('express');
const { body, validationResult } = require('express-validator');
const MissingReport = require('../models/MissingReport');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Create missing report
router.post('/', authenticate, [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('age').isInt({ min: 0, max: 18 }).withMessage('Age must be 0-18 years'),
  body('gender').isIn(['male', 'female', 'other']).withMessage('Invalid gender'),
  body('photoUrl').isURL().withMessage('Valid photo URL required'),
  body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be 10-1000 characters'),
  body('lastSeenLocation.coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates required [longitude, latitude]'),
  body('lastSeenLocation.address').trim().isLength({ min: 5, max: 200 }).withMessage('Address must be 5-200 characters'),
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

    const { name, age, gender, photoUrl, description, lastSeenLocation, contactNumber } = req.body;

    const missingReport = new MissingReport({
      name,
      age,
      gender,
      photoUrl,
      description,
      lastSeenLocation,
      reportedBy: req.user._id,
      contactNumber
    });

    await missingReport.save();

    // Find nearby users to notify (within 20km radius)
    const nearbyUsers = await User.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: lastSeenLocation.coordinates
          },
          $maxDistance: 20000 // 20km in meters
        }
      },
      _id: { $ne: req.user._id }
    }).select('_id');

    // Create notification for nearby users
    if (nearbyUsers.length > 0) {
      const notification = new Notification({
        type: 'missing_alert',
        title: `Missing Child Alert: ${name}`,
        message: `A ${age}-year-old ${gender} child named ${name} has gone missing near ${lastSeenLocation.address}. Please keep an eye out and help if you can.`,
        targetUsers: nearbyUsers.map(user => user._id),
        relatedMissingId: missingReport._id,
        priority: 'high'
      });

      await notification.save();
    }

    res.status(201).json({
      success: true,
      message: 'Missing report created successfully',
      missingId: missingReport._id,
      notifiedUsers: nearbyUsers.length
    });

  } catch (error) {
    console.error('Create missing report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create missing report',
      error: error.message
    });
  }
});

// Get all missing reports (with pagination and filters)
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || 'active';
    const skip = (page - 1) * limit;

    let query = { status };

    // Location-based filtering if coordinates provided
    if (req.query.lat && req.query.lng && req.query.radius) {
      const coordinates = [parseFloat(req.query.lng), parseFloat(req.query.lat)];
      const radius = parseInt(req.query.radius) * 1000; // Convert km to meters

      query.lastSeenLocation = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: coordinates
          },
          $maxDistance: radius
        }
      };
    }

    const missingReports = await MissingReport.find(query)
      .populate('reportedBy', 'name phoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await MissingReport.countDocuments(query);

    res.status(200).json({
      success: true,
      missingReports,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalReports: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get missing reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch missing reports',
      error: error.message
    });
  }
});

// Get specific missing report
router.get('/:missingId', authenticate, async (req, res) => {
  try {
    const missingReport = await MissingReport.findById(req.params.missingId)
      .populate('reportedBy', 'name email phoneNumber profilePhotoUrl');

    if (!missingReport) {
      return res.status(404).json({
        success: false,
        message: 'Missing report not found'
      });
    }

    res.status(200).json({
      success: true,
      missingReport
    });

  } catch (error) {
    console.error('Get missing report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch missing report',
      error: error.message
    });
  }
});

// Get missing reports by user
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const missingReports = await MissingReport.find({ reportedBy: req.params.userId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      missingReports
    });

  } catch (error) {
    console.error('Get user missing reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user missing reports',
      error: error.message
    });
  }
});

// Update missing report
router.put('/:missingId', authenticate, [
  body('description').optional().trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be 10-1000 characters'),
  body('contactNumber').optional().matches(/^[0-9]{10}$/).withMessage('Valid 10-digit contact number required'),
  body('status').optional().isIn(['active', 'found', 'closed']).withMessage('Invalid status')
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

    const missingReport = await MissingReport.findById(req.params.missingId);

    if (!missingReport) {
      return res.status(404).json({
        success: false,
        message: 'Missing report not found'
      });
    }

    // Check if user is the owner of the report
    if (missingReport.reportedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own reports.'
      });
    }

    const { description, contactNumber, status } = req.body;
    const updateData = {};

    if (description) updateData.description = description;
    if (contactNumber) updateData.contactNumber = contactNumber;
    if (status) updateData.status = status;

    const updatedReport = await MissingReport.findByIdAndUpdate(
      req.params.missingId,
      updateData,
      { new: true, runValidators: true }
    ).populate('reportedBy', 'name email phoneNumber');

    res.status(200).json({
      success: true,
      message: 'Missing report updated successfully',
      updatedReport
    });

  } catch (error) {
    console.error('Update missing report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update missing report',
      error: error.message
    });
  }
});

// Delete missing report
router.delete('/:missingId', authenticate, async (req, res) => {
  try {
    const missingReport = await MissingReport.findById(req.params.missingId);

    if (!missingReport) {
      return res.status(404).json({
        success: false,
        message: 'Missing report not found'
      });
    }

    // Check if user is the owner of the report
    if (missingReport.reportedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own reports.'
      });
    }

    await MissingReport.findByIdAndDelete(req.params.missingId);

    res.status(200).json({
      success: true,
      message: 'Missing report deleted successfully'
    });

  } catch (error) {
    console.error('Delete missing report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete missing report',
      error: error.message
    });
  }
});

module.exports = router;