const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const DSR = require('../models/DSR');
const CallLog = require('../models/CallLog');
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users (with filtering and pagination)
// @access  Private (Super Admin, Manager)
router.get('/', [
  auth,
  roleAuth(['super_admin', 'manager']),
  [
    query('page', 'Page must be a positive integer').optional().isInt({ min: 1 }),
    query('limit', 'Limit must be between 1 and 100').optional().isInt({ min: 1, max: 100 }),
    query('role', 'Invalid role').optional().isIn(['manager', 'tele_caller', 'hr']),
    query('isActive', 'isActive must be a boolean').optional().isBoolean(),
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

    // Build filter object
    let filter = {};
    
    // If user is manager, only show their team members
    if (req.user.role === 'manager') {
      filter.managerId = req.user.id;
    }

    if (req.query.role) filter.role = req.query.role;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
        { phone: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .populate('managerId', 'name email')
      .populate('createdBy', 'name')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: {
        users,
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
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (Super Admin, Manager, or own profile)
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('managerId', 'name email phone')
      .populate('teamMembers', 'name email phone role isActive')
      .populate('createdBy', 'name');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check permissions
    if (req.user.role === 'manager' && 
        user.managerId?.toString() !== req.user.id && 
        user._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    } else if ((req.user.role === 'tele_caller' || req.user.role === 'hr') && 
               user._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private (Super Admin, Manager for their team)
router.put('/:id', [
  auth,
  roleAuth(['super_admin', 'manager']),
  [
    body('name', 'Name is required').optional().not().isEmpty().trim().isLength({ max: 100 }),
    body('email', 'Please include a valid email').optional().isEmail().normalizeEmail(),
    body('phone', 'Please include a valid phone number').optional().isMobilePhone('en-IN'),
    body('isActive', 'isActive must be a boolean').optional().isBoolean(),
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

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check permissions
    if (req.user.role === 'manager' && user.managerId?.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your team members'
      });
    }

    const { name, email, phone, territory, team, isActive, managerId } = req.body;

    // Build update object
    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;
    if (territory !== undefined) updateFields.territory = territory;
    if (team !== undefined) updateFields.team = team;
    if (isActive !== undefined) updateFields.isActive = isActive;
    if (managerId !== undefined && req.user.role === 'super_admin') {
      updateFields.managerId = managerId;
    }

    // Check for duplicate email/phone
    if (email || phone) {
      const duplicateQuery = { _id: { $ne: req.params.id } };
      if (email) duplicateQuery.email = email;
      if (phone) duplicateQuery.$or = [{ phone }];
      
      const existingUser = await User.findOne(duplicateQuery);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email or phone already exists'
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).populate('managerId', 'name email');

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: updatedUser.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user (Soft delete - deactivate)
// @access  Private (Super Admin only)
router.delete('/:id', [
  auth,
  roleAuth(['super_admin'])
], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete - deactivate user
    user.isActive = false;
    await user.save();

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/users/manager/:id/team
// @desc    Get manager's team members with performance stats
// @access  Private (Super Admin, Manager)
router.get('/manager/:id/team', [
  auth,
  roleAuth(['super_admin', 'manager'])
], async (req, res) => {
  try {
    // Check if user can access this manager's data
    if (req.user.role === 'manager' && req.params.id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const teamMembers = await User.find({ 
      managerId: req.params.id, 
      isActive: true 
    }).select('-password');

    // Get today's DSR status for each team member
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const teamWithStats = await Promise.all(
      teamMembers.map(async (member) => {
        const todayDSR = await DSR.findOne({
          userId: member._id,
          date: today
        });

        const memberData = member.toObject();
        memberData.todayDSR = {
          submitted: todayDSR ? todayDSR.isSubmitted : false,
          totalCalls: todayDSR ? todayDSR.totalCalls : 0,
          converted: todayDSR ? todayDSR.converted : 0,
          followups: todayDSR ? todayDSR.totalFollowups : 0,
          lastUpdate: todayDSR ? todayDSR.updatedAt : null
        };

        return memberData;
      })
    );

    res.json({
      success: true,
      data: {
        teamMembers: teamWithStats,
        summary: {
          total: teamMembers.length,
          active: teamMembers.filter(m => m.isActive).length,
          dsrSubmitted: teamWithStats.filter(m => m.todayDSR.submitted).length,
          dsrPending: teamWithStats.filter(m => !m.todayDSR.submitted).length
        }
      }
    });

  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/users/stats/dashboard
// @desc    Get dashboard statistics
// @access  Private (All roles)
router.get('/stats/dashboard', auth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let stats = {};

    if (req.user.role === 'super_admin') {
      // Super Admin Dashboard
      const totalManagers = await User.countDocuments({ role: 'manager', isActive: true });
      const totalTelecallers = await User.countDocuments({ role: 'tele_caller', isActive: true });
      const totalHR = await User.countDocuments({ role: 'hr', isActive: true });
      
      const dsrPending = await DSR.countDocuments({
        date: today,
        isSubmitted: false
      });

      const todayCallLogs = await CallLog.countDocuments({
        callDate: { $gte: today }
      });

      const todayFollowups = await CallLog.countDocuments({
        followupDate: today,
        isFollowupCompleted: false
      });

      stats = {
        totalManagers,
        totalTelecallers,
        totalHR,
        dsrPending,
        todayCallLogs,
        todayFollowups
      };

    } else if (req.user.role === 'manager') {
      // Manager Dashboard
      const teamMembers = await User.find({ 
        managerId: req.user.id, 
        isActive: true 
      });

      const teamIds = teamMembers.map(member => member._id);

      const teamCallsToday = await CallLog.countDocuments({
        userId: { $in: teamIds },
        callDate: { $gte: today }
      });

      const followupsCreated = await CallLog.countDocuments({
        userId: { $in: teamIds },
        callStatus: 'follow_up',
        callDate: { $gte: today }
      });

      const dsrSubmitted = await DSR.countDocuments({
        userId: { $in: teamIds },
        date: today,
        isSubmitted: true
      });

      const dsrPending = teamMembers.length - dsrSubmitted;

      stats = {
        teamMembers: teamMembers.length,
        teamCallsToday,
        followupsCreated,
        dsrSubmitted,
        dsrPending,
        activeTeamMembers: teamMembers.length
      };

    } else {
      // Tele-caller or HR Dashboard
      const todayDSR = await DSR.findOne({
        userId: req.user.id,
        date: today
      });

      stats = {
        callsMade: todayDSR ? todayDSR.totalCalls : 0,
        followups: todayDSR ? todayDSR.totalFollowups : 0,
        notAnswered: todayDSR ? todayDSR.notAnswered : 0,
        conversions: todayDSR ? todayDSR.converted : 0,
        dsrSubmitted: todayDSR ? todayDSR.isSubmitted : false,
        // HR specific
        interviewsScheduled: todayDSR ? todayDSR.interviewsScheduled : 0,
        interviewsConducted: todayDSR ? todayDSR.interviewsConducted : 0,
        joinings: todayDSR ? todayDSR.joinings : 0
      };
    }

    res.json({
      success: true,
      data: {
        stats,
        role: req.user.role,
        date: today
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;