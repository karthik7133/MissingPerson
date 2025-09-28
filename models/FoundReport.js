const mongoose = require('mongoose');

const foundReportSchema = new mongoose.Schema({
  foundId: {
    type: String,
    unique: true,
    default: function() {
      return new mongoose.Types.ObjectId().toString();
    }
  },
  missingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MissingReport',
    required: [true, 'Missing report reference is required']
  },
  photoUrl: {
    type: String,
    required: [true, 'Photo of found child is required']
  },
  description: {
    type: String,
    required: [true, 'Description of child condition is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  locationFound: {
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
      required: [true, 'Found location address is required']
    }
  },
  foundBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Finder information is required']
  },
  contactNumber: {
    type: String,
    required: [true, 'Finder contact number is required'],
    match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit contact number']
  },
  verifiedByParent: {
    type: Boolean,
    default: false
  },
  verificationNotes: {
    type: String,
    maxlength: [500, 'Verification notes cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
foundReportSchema.index({ locationFound: '2dsphere' });
foundReportSchema.index({ missingId: 1 });
foundReportSchema.index({ foundBy: 1 });
foundReportSchema.index({ verifiedByParent: 1 });
foundReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FoundReport', foundReportSchema);