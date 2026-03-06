const express = require('express');
const { body, validationResult, query } = require('express-validator');
const DSR = require('../models/DSR');
const CallLog = require('../models/CallLog');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');

const router = express.Router();

// @route   POST /api/dsr/call
// @desc    Add a call log entry
// @access  Private (Tele-caller, HR)
router.post('/call', [
  auth,
  roleAuth(['tele_caller', 'hr']),
  [
    body('leadId', 'Lead ID is required').not().isEmpty().trim(),
    body('callStatus', 'Call status is required').isIn(['answered', 'not_answered', 'follow_up', 'converted', 'interview_scheduled', 'interview_conducted', 'joined']),
    body('comment', 'Comment is required').not().isEmpty().trim().isLength({ max: 500 }),
    body('followupDate', 'Valid follow-up date is required').optional().isISO8601(),
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

    const { leadId, leadName, phoneNumber, callStatus, followupDate, comment, outcome, nextAction } = req.body;

    // Check if followup date is required for follow_up status
    if (callStatus === 'follow_up' && !followupDate) {
      return res.status(400).json({
        success: false,
        message: 'Follow-up date is required for follow-up calls'
      });
    }

    // Create call log
    const callLog = new CallLog({
      userId: req.user.id,
      leadId,
      leadName,
      phoneNumber,
      callStatus,
      followupDate: followupDate ? new Date(followupDate) : undefined,
      comment,
      outcome,
      nextAction
    });

    await callLog.save();

    // Update or create today's DSR
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dsr = await DSR.findOne({
      userId: req.user.id,
      date: today
    });

    if (!dsr) {
      dsr = new DSR({
        userId: req.user.id,
        date: today
      });
    }

    // Update DSR counters based on call status
    dsr.totalCalls += 1;
    
    switch (callStatus) {
      case 'not_answered':
        dsr.notAnswered += 1;
        break;
      case 'follow_up':
        dsr.totalFollowups += 1;
        break;
      case 'converted':
        dsr.converted += 1;
        break;
      case 'interview_scheduled':
        dsr.interviewsScheduled += 1;
        break;
      case 'interview_conducted':
        dsr.interviewsConducted += 1;
        break;
      case 'joined':
        dsr.joinings += 1;
        break;
    }

    // Add call log reference to DSR
    dsr.callLogs.push(callLog._id);
    callLog.dsrId = dsr._id;

    await Promise.all([dsr.save(), callLog.save()]);

    res.status(201).json({
      success: true,
      message: 'Call logged successfully',
      data: {
        callLog,
        dsrSummary: {
          totalCalls: dsr.totalCalls,
          converted: dsr.converted,
          followups: dsr.totalFollowups,
          notAnswered: dsr.notAnswered,
          interviewsScheduled: dsr.interviewsScheduled,
          interviewsConducted: dsr.interviewsConducted,
          joinings: dsr.joinings
        }
      }
    });

  } catch (error) {
    console.error('Add call log error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dsr/today
// @desc    Get today's DSR summary
// @access  Private (All roles)
router.get('/today', auth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dsr = await DSR.findOne({
      userId: req.user.id,
      date: today
    }).populate('callLogs');

    if (!dsr) {
      dsr = new DSR({
        userId: req.user.id,
        date: today,
        totalCalls: 0,
        totalFollowups: 0,
        notAnswered: 0,
        converted: 0,
        interviewsScheduled: 0,
        interviewsConducted: 0,
        joinings: 0
      });
    }

    // Get pending followups
    const pendingFollowups = await CallLog.find({
      userId: req.user.id,
      callStatus: 'follow_up',
      followupDate: { $lte: new Date() },
      isFollowupCompleted: false
    }).sort({ followupDate: 1 });

    res.json({
      success: true,
      data: {
        dsr,
        pendingFollowups,
        canEdit: dsr.canEdit(),
        conversionRate: dsr.conversionRate,
        answerRate: dsr.answerRate
      }
    });

  } catch (error) {
    console.error('Get today DSR error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/dsr/submit
// @desc    Submit today's DSR
// @access  Private (Tele-caller, HR)
router.put('/submit', [
  auth,
  roleAuth(['tele_caller', 'hr']),
  [
    body('finalRemarks', 'Final remarks cannot exceed 500 characters').optional().isLength({ max: 500 })
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dsr = await DSR.findOne({
      userId: req.user.id,
      date: today
    });

    if (!dsr) {
      return res.status(404).json({
        success: false,
        message: 'No DSR found for today'
      });
    }

    if (dsr.isSubmitted) {
      return res.status(400).json({
        success: false,
        message: 'DSR already submitted for today'
      });
    }

    // Update DSR
    dsr.finalRemarks = req.body.finalRemarks || '';
    dsr.isSubmitted = true;
    dsr.submittedAt = new Date();
    dsr.isLocked = true;

    await dsr.save();

    res.json({
      success: true,
      message: 'DSR submitted successfully',
      data: {
        dsr
      }
    });

  } catch (error) {
    console.error('Submit DSR error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dsr/history
// @desc    Get DSR history
// @access  Private (All roles)
router.get('/history', [
  auth,
  [
    query('page', 'Page must be a positive integer').optional().isInt({ min: 1 }),
    query('limit', 'Limit must be between 1 and 50').optional().isInt({ min: 1, max: 50 }),
    query('startDate', 'Start date must be valid').optional().isISO8601(),
    query('endDate', 'End date must be valid').optional().isISO8601()
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

    // Build date filter
    let dateFilter = {};
    if (req.query.startDate || req.query.endDate) {
      dateFilter.date = {};
      if (req.query.startDate) {
        dateFilter.date.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        dateFilter.date.$lte = new Date(req.query.endDate);
      }
    }

    const filter = {
      userId: req.user.id,
      ...dateFilter
    };

    const dsrHistory = await DSR.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate('callLogs');

    const total = await DSR.countDocuments(filter);

    // Calculate summary statistics
    const stats = await DSR.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalDSRs: { $sum: 1 },
          submittedDSRs: { $sum: { $cond: ['$isSubmitted', 1, 0] } },
          totalCalls: { $sum: '$totalCalls' },
          totalConversions: { $sum: '$converted' },
          totalFollowups: { $sum: '$totalFollowups' },
          avgConversionRate: { $avg: '$performance.conversionRate' },
          avgAnswerRate: { $avg: '$performance.answerRate' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        dsrHistory,
        statistics: stats[0] || {
          totalDSRs: 0,
          submittedDSRs: 0,
          totalCalls: 0,
          totalConversions: 0,
          totalFollowups: 0,
          avgConversionRate: 0,
          avgAnswerRate: 0
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
    console.error('Get DSR history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dsr/team/:managerId
// @desc    Get team DSR overview (Manager access)
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
    }).select('name email phone role');

    const teamIds = teamMembers.map(member => member._id);

    // Get today's DSRs for all team members
    const teamDSRs = await DSR.find({
      userId: { $in: teamIds },
      date: today
    }).populate('userId', 'name email');

    // Get team statistics
    const teamStats = await DSR.aggregate([
      {
        $match: {
          userId: { $in: teamIds },
          date: today
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: '$totalCalls' },
          totalConversions: { $sum: '$converted' },
          totalFollowups: { $sum: '$totalFollowups' },
          submittedDSRs: { $sum: { $cond: ['$isSubmitted', 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        teamMembers,
        teamDSRs,
        teamStats: teamStats[0] || {
          totalCalls: 0,
          totalConversions: 0,
          totalFollowups: 0,
          submittedDSRs: 0
        },
        summary: {
          totalTeamMembers: teamMembers.length,
          dsrSubmitted: teamDSRs.filter(dsr => dsr.isSubmitted).length,
          dsrPending: teamMembers.length - teamDSRs.filter(dsr => dsr.isSubmitted).length
        }
      }
    });

  } catch (error) {
    console.error('Get team DSR error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/dsr/:id/review
// @desc    Review DSR (Manager only)
// @access  Private (Manager, Super Admin)
router.put('/:id/review', [
  auth,
  roleAuth(['manager', 'super_admin']),
  [
    body('managerRemarks', 'Manager remarks cannot exceed 500 characters').optional().isLength({ max: 500 }),
    body('isFlagged', 'isFlagged must be boolean').optional().isBoolean(),
    body('flaggedReason', 'Flagged reason cannot exceed 200 characters').optional().isLength({ max: 200 })
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

    const dsr = await DSR.findById(req.params.id).populate('userId', 'managerId');
    
    if (!dsr) {
      return res.status(404).json({
        success: false,
        message: 'DSR not found'
      });
    }

    // Check if manager can review this DSR
    if (req.user.role === 'manager' && dsr.userId.managerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only review DSRs from your team members'
      });
    }

    const { managerRemarks, isFlagged, flaggedReason } = req.body;

    // Update DSR
    if (managerRemarks !== undefined) dsr.managerRemarks = managerRemarks;
    if (isFlagged !== undefined) {
      dsr.isFlagged = isFlagged;
      dsr.flaggedBy = req.user.id;
      if (isFlagged && flaggedReason) {
        dsr.flaggedReason = flaggedReason;
      }
    }

    await dsr.save();

    res.json({
      success: true,
      message: 'DSR reviewed successfully',
      data: {
        dsr
      }
    });

  } catch (error) {
    console.error('Review DSR error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/dsr/followups/pending
// @desc    Get pending followups
// @access  Private (All roles)
router.get('/followups/pending', auth, async (req, res) => {
  try {
    const pendingFollowups = await CallLog.find({
      userId: req.user.id,
      callStatus: 'follow_up',
      followupDate: { $lte: new Date() },
      isFollowupCompleted: false
    }).sort({ followupDate: 1 });

    res.json({
      success: true,
      data: {
        followups: pendingFollowups,
        count: pendingFollowups.length
      }
    });

  } catch (error) {
    console.error('Get pending followups error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/dsr/followup/:id/complete
// @desc    Mark followup as completed
// @access  Private (Tele-caller, HR)
router.put('/followup/:id/complete', [
  auth,
  roleAuth(['tele_caller', 'hr']),
  [
    body('outcome', 'Outcome is required').not().isEmpty(),
    body('comment', 'Comment is required').not().isEmpty().isLength({ max: 500 })
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

    const callLog = await CallLog.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: 'Followup not found'
      });
    }

    const { outcome, comment, newStatus } = req.body;

    // Update the original call log
    callLog.outcome = outcome;
    callLog.comment += ` | Followup: ${comment}`;
    callLog.isFollowupCompleted = true;
    
    if (newStatus) {
      callLog.callStatus = newStatus;
    }

    await callLog.save();

    res.json({
      success: true,
      message: 'Followup completed successfully',
      data: {
        callLog
      }
    });

  } catch (error) {
    console.error('Complete followup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;