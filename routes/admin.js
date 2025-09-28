const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Admin = require('../models/Admin');
const User = require('../models/User');
const MissingReport = require('../models/MissingReport');
const FoundReport = require('../models/FoundReport');
const Notification = require('../models/Notification');
const { authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin login
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required')
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

    const { email, password } = req.body;

    const admin = await Admin.findOne({ email, isActive: true });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials or account inactive'
      });
    }

    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    const token = jwt.sign(
      { adminId: admin._id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// View all users
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

    // Get user statistics
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      users,
      stats: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

// View all missing cases
router.get('/missing', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const missingReports = await MissingReport.find()
      .populate('reportedBy', 'name email phoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await MissingReport.countDocuments();

    // Get missing report statistics
    const stats = await MissingReport.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      missingReports,
      stats: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalReports: total
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

// View all found reports
router.get('/found', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const foundReports = await FoundReport.find()
      .populate('missingId', 'name age gender')
      .populate('foundBy', 'name email phoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await FoundReport.countDocuments();

    // Get found report statistics
    const stats = await FoundReport.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      foundReports,
      stats: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
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

// Dashboard statistics
router.get('/dashboard/stats', authenticateAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMissingReports = await MissingReport.countDocuments();
    const activeMissingReports = await MissingReport.countDocuments({ status: 'active' });
    const foundReports = await FoundReport.countDocuments();
    const verifiedFound = await FoundReport.countDocuments({ verifiedByParent: true });

    // Recent activity (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentUsers = await User.countDocuments({ createdAt: { $gte: weekAgo } });
    const recentMissingReports = await MissingReport.countDocuments({ createdAt: { $gte: weekAgo } });
    const recentFoundReports = await FoundReport.countDocuments({ createdAt: { $gte: weekAgo } });

    res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalMissingReports,
        activeMissingReports,
        foundReports,
        verifiedFound,
        successRate: totalMissingReports > 0 ? (verifiedFound / totalMissingReports * 100).toFixed(1) : 0,
        recentActivity: {
          newUsers: recentUsers,
          newMissingReports: recentMissingReports,
          newFoundReports: recentFoundReports
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
});

// Approve or flag content
router.patch('/:entity/:id/approve', authenticateAdmin, [
  body('status').isIn(['approved', 'flagged', 'removed']).withMessage('Invalid status'),
  body('reason').optional().trim().isLength({ max: 200 }).withMessage('Reason cannot exceed 200 characters')
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

    const { entity, id } = req.params;
    const { status, reason } = req.body;

    let Model;
    switch (entity) {
      case 'missing':
        Model = MissingReport;
        break;
      case 'found':
        Model = FoundReport;
        break;
      case 'user':
        Model = User;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid entity type'
        });
    }

    const document = await Model.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: `${entity} not found`
      });
    }

    // Update document with moderation status
    document.moderationStatus = status;
    document.moderationReason = reason;
    document.moderatedBy = req.admin._id;
    document.moderatedAt = new Date();

    await document.save();

    res.status(200).json({
      success: true,
      message: `${entity} ${status} successfully`,
      updatedEntity: document
    });

  } catch (error) {
    console.error('Approve/flag content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to moderate content',
      error: error.message
    });
  }
});

// Send system notification
router.post('/notifications/broadcast', authenticateAdmin, [
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Title must be 5-100 characters'),
  body('message').trim().isLength({ min: 10, max: 500 }).withMessage('Message must be 10-500 characters'),
  body('targetUsers').optional().isArray().withMessage('Target users must be an array'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority')
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

    const { title, message, targetUsers, priority } = req.body;

    let recipients = targetUsers;
    
    // If no specific users, send to all users
    if (!targetUsers || targetUsers.length === 0) {
      const allUsers = await User.find().select('_id');
      recipients = allUsers.map(user => user._id);
    }

    const notification = new Notification({
      type: 'system_update',
      title,
      message,
      targetUsers: recipients,
      priority: priority || 'medium'
    });

    await notification.save();

    res.status(201).json({
      success: true,
      message: `System notification sent to ${recipients.length} users`,
      notificationId: notification._id
    });

  } catch (error) {
    console.error('Broadcast notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification',
      error: error.message
    });
  }
});

module.exports = router;