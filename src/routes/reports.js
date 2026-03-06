const express = require('express');
const { query, validationResult } = require('express-validator');
const DSR = require('../models/DSR');
const CallLog = require('../models/CallLog');
const Attendance = require('../models/Attendance');
const GeoTagging = require('../models/GeoTagging');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');

const router = express.Router();

// @route   GET /api/reports/dsr
// @desc    Get DSR reports with filters
// @access  Private (Manager, Super Admin)
router.get('/dsr', [
  auth,
  roleAuth(['manager', 'super_admin']),
  [
    query('startDate', 'Start date must be valid').optional().isISO8601(),
    query('endDate', 'End date must be valid').optional().isISO8601(),
    query('userId', 'User ID must be valid').optional().isMongoId(),
    query('format', 'Format must be json or csv').optional().isIn(['json', 'csv'])
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

    // Build filter
    let filter = {};
    
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) filter.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.date.$lte = new Date(req.query.endDate);
    }

    // Role-based access control
    if (req.user.role === 'manager') {
      const teamMembers = await User.find({ managerId: req.user.id }).select('_id');
      const teamIds = teamMembers.map(member => member._id);
      filter.userId = { $in: teamIds };
    }

    if (req.query.userId) {
      if (req.user.role === 'manager') {
        const user = await User.findById(req.query.userId);
        if (user && user.managerId?.toString() === req.user.id) {
          filter.userId = req.query.userId;
        }
      } else if (req.user.role === 'super_admin') {
        filter.userId = req.query.userId;
      }
    }

    const dsrReports = await DSR.find(filter)
      .populate('userId', 'name email role')
      .sort({ date: -1 });

    // Generate summary statistics
    const summary = {
      totalDSRs: dsrReports.length,
      submittedDSRs: dsrReports.filter(dsr => dsr.isSubmitted).length,
      totalCalls: dsrReports.reduce((sum, dsr) => sum + dsr.totalCalls, 0),
      totalConversions: dsrReports.reduce((sum, dsr) => sum + dsr.converted, 0),
      avgConversionRate: dsrReports.length > 0 ? 
        dsrReports.reduce((sum, dsr) => sum + parseFloat(dsr.conversionRate), 0) / dsrReports.length : 0
    };

    res.json({
      success: true,
      data: {
        reports: dsrReports,
        summary
      }
    });

  } catch (error) {
    console.error('Get DSR reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/reports/attendance
// @desc    Get attendance reports
// @access  Private (Manager, Super Admin)
router.get('/attendance', [
  auth,
  roleAuth(['manager', 'super_admin']),
  [
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

    let filter = {};
    
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) filter.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.date.$lte = new Date(req.query.endDate);
    }

    // Role-based access control
    if (req.user.role === 'manager') {
      const teamMembers = await User.find({ managerId: req.user.id }).select('_id');
      const teamIds = teamMembers.map(member => member._id);
      filter.userId = { $in: teamIds };
    }

    if (req.query.userId) {
      if (req.user.role === 'manager') {
        const user = await User.findById(req.query.userId);
        if (user && user.managerId?.toString() === req.user.id) {
          filter.userId = req.query.userId;
        }
      } else if (req.user.role === 'super_admin') {
        filter.userId = req.query.userId;
      }
    }

    const attendanceReports = await Attendance.find(filter)
      .populate('userId', 'name email role')
      .sort({ date: -1 });

    const summary = {
      totalRecords: attendanceReports.length,
      presentDays: attendanceReports.filter(att => att.status === 'present').length,
      lateDays: attendanceReports.filter(att => att.status === 'late').length,
      absentDays: attendanceReports.filter(att => att.status === 'absent').length,
      totalWorkingHours: attendanceReports.reduce((sum, att) => sum + (att.workingHours || 0), 0)
    };

    res.json({
      success: true,
      data: {
        reports: attendanceReports,
        summary
      }
    });

  } catch (error) {
    console.error('Get attendance reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/reports/performance
// @desc    Get performance reports
// @access  Private (Manager, Super Admin)
router.get('/performance', [
  auth,
  roleAuth(['manager', 'super_admin']),
  [
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

    const startDate = req.query.startDate ? new Date(req.query.startDate) : 
                     new Date(new Date().setDate(new Date().getDate() - 30));
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    let userFilter = {};
    
    // Role-based access control
    if (req.user.role === 'manager') {
      const teamMembers = await User.find({ managerId: req.user.id }).select('_id name email');
      const teamIds = teamMembers.map(member => member._id);
      userFilter._id = { $in: teamIds };
    }

    if (req.query.userId) {
      if (req.user.role === 'manager') {
        const user = await User.findById(req.query.userId);
        if (user && user.managerId?.toString() === req.user.id) {
          userFilter._id = req.query.userId;
        }
      } else if (req.user.role === 'super_admin') {
        userFilter._id = req.query.userId;
      }
    }

    const users = await User.find(userFilter);
    
    const performanceData = await Promise.all(
      users.map(async (user) => {
        // DSR Performance
        const dsrStats = await DSR.aggregate([
          {
            $match: {
              userId: user._id,
              date: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalDSRs: { $sum: 1 },
              submittedDSRs: { $sum: { $cond: ['$isSubmitted', 1, 0] } },
              totalCalls: { $sum: '$totalCalls' },
              totalConversions: { $sum: '$converted' },
              avgConversionRate: { $avg: '$performance.conversionRate' }
            }
          }
        ]);

        // Attendance Performance
        const attendanceStats = await Attendance.aggregate([
          {
            $match: {
              userId: user._id,
              date: { $gte: startDate, $lte: endDate }
            }
          },
          {
            $group: {
              _id: null,
              totalDays: { $sum: 1 },
              presentDays: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
              avgWorkingHours: { $avg: '$workingHours' }
            }
          }
        ]);

        return {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
          },
          dsr: dsrStats[0] || {
            totalDSRs: 0,
            submittedDSRs: 0,
            totalCalls: 0,
            totalConversions: 0,
            avgConversionRate: 0
          },
          attendance: attendanceStats[0] || {
            totalDays: 0,
            presentDays: 0,
            avgWorkingHours: 0
          }
        };
      })
    );

    res.json({
      success: true,
      data: {
        performance: performanceData,
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('Get performance reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;