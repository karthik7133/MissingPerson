const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticate, checkOwnership } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

// Update user profile
router.put('/:userId', authenticate, checkOwnership, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('phoneNumber').optional().matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number required'),
  body('profilePhotoUrl').optional().isURL().withMessage('Valid URL required for profile photo'),
  body('location.address').optional().trim().isLength({ min: 3, max: 200 }).withMessage('Address must be 3-200 characters'),
  body('location.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Coordinates must be [longitude, latitude]')
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

    const { name, phoneNumber, profilePhotoUrl, location } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (profilePhotoUrl) updateData.profilePhotoUrl = profilePhotoUrl;
    if (location) updateData.location = location;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      updatedUser
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

// Delete user account
router.delete('/:userId', authenticate, checkOwnership, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.userId);
    
    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message
    });
  }
});

// Get users by location (for finding nearby helpers)
router.post('/nearby', authenticate, [
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be [longitude, latitude]'),
  body('radius').optional().isInt({ min: 1, max: 50 }).withMessage('Radius must be 1-50 km')
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

    const { coordinates, radius = 10 } = req.body; // Default 10km radius
    
    const nearbyUsers = await User.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: coordinates
          },
          $maxDistance: radius * 1000 // Convert km to meters
        }
      },
      _id: { $ne: req.user._id } // Exclude current user
    }).select('name role location profilePhotoUrl').limit(50);

    res.status(200).json({
      success: true,
      nearbyUsers
    });

  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nearby users',
      error: error.message
    });
  }
});

module.exports = router;