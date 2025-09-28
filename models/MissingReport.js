const mongoose = require('mongoose');

const missingReportSchema = new mongoose.Schema({
  missingId: {
    type: String,
    unique: true,
    default: function() {
      return new mongoose.Types.ObjectId().toString();
    }
  },
  name: {
    type: String,
    required: [true, 'Child name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  age: {
    type: Number,
    required: [true, 'Age is required'],
    min: [0, 'Age cannot be negative'],
    max: [18, 'This app is designed for missing children under 18']
  },
  gender: {
    type: String,
    required: [true, 'Gender is required'],
    enum: ['male', 'female', 'other']
  },
  photoUrl: {
    type: String,
    required: [true, 'Child photo is required for identification']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  lastSeenLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    },
    address: {
      type: String,
      required: [true, 'Last seen address is required']
    }
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Reporter information is required']
  },
  contactNumber: {
    type: String,
    required: [true, 'Contact number is required'],
    match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit contact number']
  },
  status: {
    type: String,
    enum: ['active', 'found', 'closed'],
    default: 'active'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'high'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for geospatial queries
missingReportSchema.index({ lastSeenLocation: '2dsphere' });
missingReportSchema.index({ status: 1 });
missingReportSchema.index({ createdAt: -1 });
missingReportSchema.index({ reportedBy: 1 });

// Update the updatedAt field before saving
missingReportSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('MissingReport', missingReportSchema);