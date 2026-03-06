const express = require('express');
const { body, validationResult, query } = require('express-validator');
const GeoTagging = require('../models/GeoTagging');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');

const router = express.Router();

// @route   POST /api/geotagging/visit
// @desc    Add a new client visit
// @access  Private (Manager, Tele-caller, HR)
router.post('/visit', [
  auth,
  roleAuth(['manager', 'tele_caller', 'hr']),
  [
    body('clientName', 'Client name is required').not().isEmpty().trim().isLength({ max: 100 }),
    body('location.latitude', 'Valid latitude is required').isFloat({ min: -90, max: 90 }),
    body('location.longitude', 'Valid longitude is required').isFloat({ min: -180, max: 180 }),
    body('address', 'Address is required').not().isEmpty().isLength({ max: 300 }),
    body('meetingStatus', 'Meeting status is required').isIn(['scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show']),
    body('remarks', 'Remarks are required').not().isEmpty().isLength({ max: 500 }),
    body('photos', 'At least one photo is required').isArray({ min: 1 }),
  ]
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const {
      clientName,
      location,
      address,
      meetingStatus,
      meetingType,
      remarks,
      photos,
      nextAction,
      outcome,
      clientDetails,
      technicalInfo
    } = req.body;

    // Create geo-tagging record
    const geoTagging = new GeoTagging({
      userId: req.user.id,
      clientName,
      location: {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      },
      address,
      meetingStatus,
      meetingType,
      remarks,
      photos: photos.map(photo => ({
        url: photo.url,
        type: photo.type || 'meeting',
        caption: photo.caption || '',
        takenAt: photo.takenAt || new Date()
      })),
      nextAction,
      outcome,
      clientDetails,
      technicalInfo
    });

    await geoTagging.save();

    res.status(201).json({
      success: true,
      message: 'Visit logged successfully',
      data: {
        visit: geoTagging,
        verificationScore: geoTagging.verificationScore,
        status: geoTagging.status
      }
    });

  } catch (error) {
    console.error('Add visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/geotagging/visits
// @desc    Get user's visits with filtering
// @access  Private (All roles)
router.get('/visits', [
  auth,
  [
    query('page', 'Page must be a positive integer').optional().isInt({ min: 1 }),
    query('limit', 'Limit must be between 1 and 50').optional().isInt({ min: 1, max: 50 }),
    query('startDate', 'Start date must be valid').optional().isISO8601(),
    query('endDate', 'End date must be valid').optional().isISO8601(),
    query('meetingStatus', 'Invalid meeting status').optional().isIn(['scheduled', 'completed', 'cancelled', 'rescheduled', 'no_show']),
    query('userId', 'User ID must be valid').optional().isMongoId()
  ]
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter
    let filter = {};

    // Role-based access control
    if (req.query.userId) {
      if (req.user.role === 'super_admin') {
        filter.userId = req.query.userId;
      } else if (req.user.role === 'manager') {
        // Manager can view their team's visits
        const user = await User.findById(req.query.userId);
        if (!user || user.managerId?.toString() !== req.user.id) {
          filter.userId = req.user.id; // Default to own visits
        } else {
          filter.userId = req.query.userId;
        }
      } else {
        filter.userId = req.user.id; // Can only view own visits
      }
    } else {
      if (req.user.role === 'manager') {
        // Get team members including self
        const teamMembers = await User.find({ managerId: req.user.id }).select('_id');
        const teamIds = teamMembers.map(member => member._id);
        teamIds.push(req.user.id);
        filter.userId = { $in: teamIds };
      } else if (req.user.role !== 'super_admin') {
        filter.userId = req.user.id;
      }
    }

    // Date filter
    if (req.query.startDate || req.query.endDate) {
      filter.visitDate = {};
      if (req.query.startDate) {
        filter.visitDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.visitDate.$lte = new Date(req.query.endDate);
      }
    }

    // Status filter
    if (req.query.meetingStatus) {
      filter.meetingStatus = req.query.meetingStatus;
    }

    // Search filter
    if (req.query.search) {
      filter.$or = [
        { clientName: { $regex: req.query.search, $options: 'i' } },
        { 'clientDetails.contactPerson': { $regex: req.query.search, $options: 'i' } },
        { address: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const visits = await GeoTagging.find(filter)
      .populate('userId', 'name email')
      .populate('reviewedBy', 'name')
      .sort({ visitDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await GeoTagging.countDocuments(filter);

    res.json({
      success: true,
      data: {
        visits,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get visits error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/geotagging/visits/:id
// @desc    Get visit details
// @access  Private (All roles)
router.get('/visits/:id', auth, async (req, res) => {
  try {
    const visit = await GeoTagging.findById(req.params.id)
      .populate('userId', 'name email')
      .populate('reviewedBy', 'name');

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found'
      });
    }

    // Check permissions
    if (req.user.role === 'manager') {
      const user = await User.findById(visit.userId);
      if (user.managerId?.toString() !== req.user.id && visit.userId.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    } else if ((req.user.role === 'tele_caller' || req.user.role === 'hr') && 
               visit.userId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { visit }
    });

  } catch (error) {
    console.error('Get visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/geotagging/visits/:id/review
// @desc    Review visit (Manager, Super Admin)
// @access  Private (Manager, Super Admin)
router.put('/visits/:id/review', [
  auth,
  roleAuth(['manager', 'super_admin']),
  [
    body('status', 'Status is required').isIn(['approved', 'rejected', 'flagged']),
    body('reviewComments', 'Review comments cannot exceed 300 characters').optional().isLength({ max: 300 })
  ]
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const visit = await GeoTagging.findById(req.params.id).populate('userId');
    
    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found'
      });
    }

    // Check if manager can review this visit
    if (req.user.role === 'manager' && visit.userId.managerId?.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only review visits from your team members'
      });
    }

    visit.status = req.body.status;
    visit.reviewedBy = req.user.id;
    visit.reviewedAt = new Date();
    visit.reviewComments = req.body.reviewComments;

    await visit.save();

    res.json({
      success: true,
      message: 'Visit reviewed successfully',
      data: { visit }
    });

  } catch (error) {
    console.error('Review visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/geotagging/stats
// @desc    Get geo-tagging statistics
// @access  Private (All roles)
router.get('/stats', auth, async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : 
                     new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    let filter = {
      visitDate: { $gte: startDate, $lte: endDate }
    };

    // Role-based filtering
    if (req.user.role === 'manager') {
      const teamMembers = await User.find({ managerId: req.user.id }).select('_id');
      const teamIds = teamMembers.map(member => member._id);
      teamIds.push(req.user.id);
      filter.userId = { $in: teamIds };
    } else if (req.user.role !== 'super_admin') {
      filter.userId = req.user.id;
    }

    const stats = await GeoTagging.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalVisits: { $sum: 1 },
          completedMeetings: {
            $sum: { $cond: [{ $eq: ['$meetingStatus', 'completed'] }, 1, 0] }
          },
          cancelledMeetings: {
            $sum: { $cond: [{ $eq: ['$meetingStatus', 'cancelled'] }, 1, 0] }
          },
          positiveOutcomes: {
            $sum: { $cond: [{ $eq: ['$outcome', 'positive'] }, 1, 0] }
          },
          averageVerificationScore: { $avg: '$verificationScore' },
          totalPhotos: { $sum: { $size: '$photos' } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        statistics: stats[0] || {
          totalVisits: 0,
          completedMeetings: 0,
          cancelledMeetings: 0,
          positiveOutcomes: 0,
          averageVerificationScore: 0,
          totalPhotos: 0
        },
        dateRange: {
          startDate,
          endDate
        }
      }
    });

  } catch (error) {
    console.error('Get geo-tagging stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;