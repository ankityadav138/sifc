const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');

const router = express.Router();

// Office location (should be configured in environment variables)
const OFFICE_LOCATION = {
  latitude: parseFloat(process.env.OFFICE_LATITUDE) || 28.6139,
  longitude: parseFloat(process.env.OFFICE_LONGITUDE) || 77.2090
};
const OFFICE_RADIUS = parseInt(process.env.OFFICE_RADIUS) || 100; // meters

// @route   POST /api/attendance/punch-in
// @desc    Mark punch in attendance
// @access  Private (All roles except super_admin)
router.post('/punch-in', [
  auth,
  roleAuth(['manager', 'tele_caller', 'hr']),
  [
    body('selfie', 'Selfie URL is required').not().isEmpty(),
    body('location.latitude', 'Valid latitude is required').isFloat({ min: -90, max: 90 }),
    body('location.longitude', 'Valid longitude is required').isFloat({ min: -180, max: 180 }),
    body('address', 'Address is required').not().isEmpty().isLength({ max: 200 }),
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

    const { selfie, location, address, deviceInfo } = req.body;

    // Check if already punched in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      userId: req.user.id,
      date: today
    });

    if (existingAttendance && existingAttendance.punchIn.time) {
      return res.status(400).json({
        success: false,
        message: 'Already punched in for today',
        data: {
          punchInTime: existingAttendance.punchIn.time
        }
      });
    }

    // Calculate distance from office
    const distance = calculateDistance(
      location.latitude,
      location.longitude,
      OFFICE_LOCATION.latitude,
      OFFICE_LOCATION.longitude
    );

    const isValidLocation = distance <= OFFICE_RADIUS;

    // Create or update attendance record
    const attendanceData = {
      userId: req.user.id,
      date: today,
      punchIn: {
        time: new Date(),
        location: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude]
        },
        address,
        selfie,
        deviceInfo: deviceInfo || {},
        isValidLocation,
        distance: Math.round(distance)
      }
    };

    let attendance;
    if (existingAttendance) {
      // Update existing record
      attendance = await Attendance.findByIdAndUpdate(
        existingAttendance._id,
        { $set: attendanceData },
        { new: true, runValidators: true }
      );
    } else {
      // Create new record
      attendance = new Attendance(attendanceData);
      await attendance.save();
    }

    res.status(201).json({
      success: true,
      message: isValidLocation ? 
        'Punch-in recorded successfully' : 
        'Punch-in recorded with location warning',
      data: {
        attendance,
        locationWarning: !isValidLocation,
        distanceFromOffice: Math.round(distance),
        allowedRadius: OFFICE_RADIUS
      }
    });

  } catch (error) {
    console.error('Punch-in error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/attendance/punch-out
// @desc    Mark punch out attendance
// @access  Private (All roles except super_admin)
router.post('/punch-out', [
  auth,
  roleAuth(['manager', 'tele_caller', 'hr']),
  [
    body('selfie', 'Selfie URL is required').not().isEmpty(),
    body('location.latitude', 'Valid latitude is required').isFloat({ min: -90, max: 90 }),
    body('location.longitude', 'Valid longitude is required').isFloat({ min: -180, max: 180 }),
    body('address', 'Address is required').not().isEmpty().isLength({ max: 200 }),
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

    const { selfie, location, address, deviceInfo } = req.body;

    // Find today's attendance record
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      userId: req.user.id,
      date: today
    });

    if (!attendance || !attendance.punchIn.time) {
      return res.status(400).json({
        success: false,
        message: 'No punch-in record found for today. Please punch-in first.'
      });
    }

    if (attendance.punchOut && attendance.punchOut.time) {
      return res.status(400).json({
        success: false,
        message: 'Already punched out for today',
        data: {
          punchOutTime: attendance.punchOut.time
        }
      });
    }

    // Calculate distance from office
    const distance = calculateDistance(
      location.latitude,
      location.longitude,
      OFFICE_LOCATION.latitude,
      OFFICE_LOCATION.longitude
    );

    const isValidLocation = distance <= OFFICE_RADIUS;

    // Update punch out data
    attendance.punchOut = {
      time: new Date(),
      location: {
        type: 'Point',
        coordinates: [location.longitude, location.latitude]
      },
      address,
      selfie,
      deviceInfo: deviceInfo || {},
      isValidLocation,
      distance: Math.round(distance)
    };

    await attendance.save();

    res.json({
      success: true,
      message: isValidLocation ? 
        'Punch-out recorded successfully' : 
        'Punch-out recorded with location warning',
      data: {
        attendance,
        locationWarning: !isValidLocation,
        distanceFromOffice: Math.round(distance),
        totalHours: attendance.formattedTotalHours,
        workingHours: attendance.workingHours,
        status: attendance.status
      }
    });

  } catch (error) {
    console.error('Punch-out error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/attendance/today
// @desc    Get today's attendance status
// @access  Private (All roles except super_admin)
router.get('/today', [
  auth,
  roleAuth(['manager', 'tele_caller', 'hr'])
], async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      userId: req.user.id,
      date: today
    });

    res.json({
      success: true,
      data: {
        attendance,
        hasPunchedIn: !!(attendance && attendance.punchIn.time),
        hasPunchedOut: !!(attendance && attendance.punchOut && attendance.punchOut.time),
        canPunchOut: !!(attendance && attendance.punchIn.time && !(attendance.punchOut && attendance.punchOut.time))
      }
    });

  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/attendance/history
// @desc    Get attendance history
// @access  Private (All roles)
router.get('/history', [
  auth,
  [
    query('page', 'Page must be a positive integer').optional().isInt({ min: 1 }),
    query('limit', 'Limit must be between 1 and 50').optional().isInt({ min: 1, max: 50 }),
    query('startDate', 'Start date must be valid').optional().isISO8601(),
    query('endDate', 'End date must be valid').optional().isISO8601(),
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
        // Manager can view their team's attendance
        const user = await User.findById(req.query.userId);
        if (!user || user.managerId?.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
        filter.userId = req.query.userId;
      } else {
        // Tele-caller and HR can only view their own
        if (req.query.userId !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          });
        }
        filter.userId = req.user.id;
      }
    } else {
      // If no userId specified, default to own records for non-admin
      if (req.user.role !== 'super_admin') {
        if (req.user.role === 'manager') {
          // Get team members
          const teamMembers = await User.find({ managerId: req.user.id }).select('_id');
          const teamIds = teamMembers.map(member => member._id);
          teamIds.push(req.user.id); // Include manager's own attendance
          filter.userId = { $in: teamIds };
        } else {
          filter.userId = req.user.id;
        }
      }
    }

    // Date filter
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) {
        filter.date.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.date.$lte = new Date(req.query.endDate);
      }
    }

    const attendanceHistory = await Attendance.find(filter)
      .populate('userId', 'name email role')
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Attendance.countDocuments(filter);

    // Calculate statistics
    const stats = await Attendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalDays: { $sum: 1 },
          presentDays: {
            $sum: {
              $cond: [{ $eq: ['$status', 'present'] }, 1, 0]
            }
          },
          lateDays: {
            $sum: {
              $cond: [{ $eq: ['$status', 'late'] }, 1, 0]
            }
          },
          halfDays: {
            $sum: {
              $cond: [{ $eq: ['$status', 'half_day'] }, 1, 0]
            }
          },
          totalWorkingHours: { $sum: '$workingHours' },
          avgWorkingHours: { $avg: '$workingHours' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        attendanceHistory,
        statistics: stats[0] || {
          totalDays: 0,
          presentDays: 0,
          lateDays: 0,
          halfDays: 0,
          totalWorkingHours: 0,
          avgWorkingHours: 0
        },
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
    console.error('Get attendance history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/attendance/:id/approve
// @desc    Approve attendance (Manager, Super Admin)
// @access  Private (Manager, Super Admin)
router.put('/:id/approve', [
  auth,
  roleAuth(['manager', 'super_admin']),
  [
    body('remarks', 'Remarks cannot exceed 300 characters').optional().isLength({ max: 300 })
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

    const attendance = await Attendance.findById(req.params.id).populate('userId');
    
    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // Check if manager can approve this attendance
    if (req.user.role === 'manager' && attendance.userId.managerId?.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only approve attendance for your team members'
      });
    }

    attendance.isApproved = true;
    attendance.approvedBy = req.user.id;
    attendance.remarks = req.body.remarks || attendance.remarks;

    await attendance.save();

    res.json({
      success: true,
      message: 'Attendance approved successfully',
      data: { attendance }
    });

  } catch (error) {
    console.error('Approve attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/attendance/team/:managerId
// @desc    Get team attendance overview
// @access  Private (Manager, Super Admin)
router.get('/team/:managerId', [
  auth,
  roleAuth(['manager', 'super_admin'])
], async (req, res) => {
  try {
    // Check permission
    if (req.user.role === 'manager' && req.params.managerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get team members
    const teamMembers = await User.find({
      managerId: req.params.managerId,
      isActive: true
    });

    const teamIds = teamMembers.map(member => member._id);

    // Get today's attendance for all team members
    const teamAttendance = await Attendance.find({
      userId: { $in: teamIds },
      date: today
    }).populate('userId', 'name email');

    // Create attendance summary
    const attendanceSummary = teamMembers.map(member => {
      const attendance = teamAttendance.find(att => 
        att.userId._id.toString() === member._id.toString()
      );

      return {
        user: {
          id: member._id,
          name: member.name,
          email: member.email
        },
        attendance: attendance || null,
        status: attendance ? attendance.status : 'absent',
        punchInTime: attendance?.punchIn?.time || null,
        punchOutTime: attendance?.punchOut?.time || null,
        workingHours: attendance?.workingHours || 0
      };
    });

    // Calculate team statistics
    const presentCount = attendanceSummary.filter(a => a.status === 'present').length;
    const lateCount = attendanceSummary.filter(a => a.status === 'late').length;
    const absentCount = attendanceSummary.filter(a => a.status === 'absent').length;

    res.json({
      success: true,
      data: {
        attendanceSummary,
        statistics: {
          total: teamMembers.length,
          present: presentCount,
          late: lateCount,
          absent: absentCount,
          attendanceRate: teamMembers.length > 0 ? 
            ((presentCount + lateCount) / teamMembers.length * 100).toFixed(2) : 0
        }
      }
    });

  } catch (error) {
    console.error('Get team attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2 - lat1) * Math.PI/180;
  const Δλ = (lon2 - lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

module.exports = router;