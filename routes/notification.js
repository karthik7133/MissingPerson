const express = require('express');
const { body, validationResult } = require('express-validator');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get notifications for logged-in user
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({
      targetUsers: req.user._id,
      expiresAt: { $gt: new Date() } // Only non-expired notifications
    })
      .populate('relatedMissingId', 'name age gender photoUrl')
      .populate('relatedFoundId', 'photoUrl verifiedByParent')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    // Mark as read for this user
    const readNotifications = notifications.map(notification => {
      const isRead = notification.isRead.some(read => 
        read.userId.toString() === req.user._id.toString()
      );
      
      if (!isRead) {
        notification.isRead.push({
          userId: req.user._id,
          readAt: new Date()
        });
        notification.save();
      }

      return {
        ...notification.toObject(),
        isRead
      };
    });

    const total = await Notification.countDocuments({
      targetUsers: req.user._id,
      expiresAt: { $gt: new Date() }
    });

    res.status(200).json({
      success: true,
      notifications: readNotifications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotifications: total
      }
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

// Get specific notification
router.get('/:notificationId', authenticate, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.notificationId)
      .populate('relatedMissingId')
      .populate('relatedFoundId');

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user is in target users
    const isTargetUser = notification.targetUsers.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isTargetUser) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This notification is not for you.'
      });
    }

    res.status(200).json({
      success: true,
      notification
    });

  } catch (error) {
    console.error('Get notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification',
      error: error.message
    });
  }
});

// Create notification (for system/admin use)
router.post('/', authenticate, [
  body('type').isIn(['missing_alert', 'found_alert', 'verification_request', 'system_update']).withMessage('Invalid notification type'),
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Title must be 5-100 characters'),
  body('message').trim().isLength({ min: 10, max: 500 }).withMessage('Message must be 10-500 characters'),
  body('targetUsers').isArray({ min: 1 }).withMessage('At least one target user required'),
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

    const { type, title, message, targetUsers, relatedMissingId, relatedFoundId, priority } = req.body;

    // Verify target users exist
    const existingUsers = await User.find({ _id: { $in: targetUsers } });
    if (existingUsers.length !== targetUsers.length) {
      return res.status(400).json({
        success: false,
        message: 'Some target users do not exist'
      });
    }

    const notification = new Notification({
      type,
      title,
      message,
      targetUsers,
      relatedMissingId,
      relatedFoundId,
      priority: priority || 'medium'
    });

    await notification.save();

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      notificationId: notification._id
    });

  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification',
      error: error.message
    });
  }
});

// Delete notification
router.delete('/:notificationId', authenticate, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.notificationId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user is in target users
    const isTargetUser = notification.targetUsers.some(userId => 
      userId.toString() === req.user._id.toString()
    );

    if (!isTargetUser) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own notifications.'
      });
    }

    // Remove user from target users instead of deleting the entire notification
    notification.targetUsers = notification.targetUsers.filter(userId => 
      userId.toString() !== req.user._id.toString()
    );

    if (notification.targetUsers.length === 0) {
      await Notification.findByIdAndDelete(req.params.notificationId);
    } else {
      await notification.save();
    }

    res.status(200).json({
      success: true,
      message: 'Notification removed successfully'
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
});

// Get unread notification count
router.get('/count/unread', authenticate, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      targetUsers: req.user._id,
      expiresAt: { $gt: new Date() },
      'isRead.userId': { $ne: req.user._id }
    });

    res.status(200).json({
      success: true,
      unreadCount
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: error.message
    });
  }
});

module.exports = router;