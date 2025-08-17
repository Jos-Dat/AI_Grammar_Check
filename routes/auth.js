// routes/auth.js - Fixed Authentication routes
const express = require('express');
const { body, validationResult } = require('express-validator');
const DatabaseService = require('../services/DatabaseService');
const router = express.Router();

// Initialize database service
const dbService = new DatabaseService();

// Validation rules
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username must be 3-20 characters, letters, numbers, underscore only'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('fullName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Full name must be less than 100 characters'),
  body('phone')
    .optional()
    .trim()
    .matches(/^[\d\s\+\-\(\)]+$/)
    .withMessage('Invalid phone number format')
];

const loginValidation = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
];

// Initialize database connection
(async () => {
  try {
    await dbService.connect();
    console.log('✅ Database service connected for auth routes');
  } catch (error) {
    console.error('❌ Failed to connect to database in auth routes:', error);
  }
})();

// POST /api/auth/register
router.post('/register', registerValidation, async (req, res) => {
  try {
    console.log('🔄 Registration request received:', {
      username: req.body.username,
      email: req.body.email,
      hasPassword: !!req.body.password,
      phone: req.body.phone || 'not provided'
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { username, email, password, fullName, phone } = req.body;

    // Register user using database service
    const result = await dbService.registerUser({
      username,
      email,
      password,
      fullName,
      phone
    });

    console.log('📊 Registration result from database:', result);

    if (!result.Success) {
      console.log('❌ Registration failed:', result.Message);
      return res.status(409).json({
        success: false,
        error: result.Message
      });
    }

    // Create session token
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    const token = await dbService.createSession(result.UserID, ipAddress, userAgent);

    if (!token) {
      console.log('❌ Failed to create session');
      return res.status(500).json({
        success: false,
        error: 'Failed to create session'
      });
    }

    console.log('✅ Registration successful for user:', username);

    res.status(201).json({
      success: true,
      data: {
        username,
        email,
        fullName,
        token,
        userID: result.UserID,
        isPremium: false,
        isAdmin: false
      },
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed: ' + error.message
    });
  }
});

// POST /api/auth/login
router.post('/login', loginValidation, async (req, res) => {
  try {
    console.log('🔄 Login request received:', {
      username: req.body.username,
      hasPassword: !!req.body.password,
      passwordLength: req.body.password ? req.body.password.length : 0
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Login validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { username, password } = req.body;

    // Verify password using database service
    const user = await dbService.verifyPassword(username, password);
    
    if (!user) {
      console.log('❌ Login failed: Invalid credentials for username:', username);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    console.log('✅ User verified:', {
      UserID: user.UserID,
      Username: user.Username,
      IsPremium: user.IsPremium,
      IsAdmin: user.IsAdmin
    });

    // Create session token
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    const token = await dbService.createSession(user.UserID, ipAddress, userAgent);

    if (!token) {
      console.log('❌ Failed to create session for user:', username);
      return res.status(500).json({
        success: false,
        error: 'Failed to create session'
      });
    }

    console.log('✅ Login successful for user:', username);

    res.json({
      success: true,
      data: {
        username: user.Username,
        email: user.Email,
        fullName: user.FullName,
        isPremium: user.IsPremium,
        isAdmin: user.IsAdmin,
        token,
        userID: user.UserID
      },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed: ' + error.message
    });
  }
});

// GET /api/auth/verify
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Validate session using database service
    const sessionData = await dbService.validateSession(token);
    
    if (!sessionData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    res.json({
      success: true,
      data: {
        username: sessionData.Username,
        email: sessionData.Email,
        isPremium: sessionData.IsPremium,
        isAdmin: sessionData.IsAdmin,
        userID: sessionData.UserID
      }
    });

  } catch (error) {
    console.error('❌ Token verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Token verification failed'
    });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      // Deactivate session in database
      try {
        const request = dbService.pool.request();
        request.input('SessionToken', token);
        await request.query('UPDATE UserSessions SET IsActive = 0 WHERE SessionToken = @SessionToken');
        console.log('✅ Session deactivated for logout');
      } catch (error) {
        console.error('❌ Error deactivating session:', error);
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// GET /api/auth/users - Admin endpoint to get all users
router.get('/users', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied'
      });
    }

    const token = authHeader.split(' ')[1];
    const sessionData = await dbService.validateSession(token);
    
    if (!sessionData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    // Check if user is admin
    if (!sessionData.IsAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Get all users
    const users = await dbService.getAllUsers();

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// PUT /api/auth/users/:id - Update user (Admin)
router.put('/users/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied'
      });
    }

    const token = authHeader.split(' ')[1];
    const sessionData = await dbService.validateSession(token);
    
    if (!sessionData || !sessionData.IsAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { id } = req.params;
    const { username, email, fullName, phone, isActive, isPremium, isAdmin } = req.body;

    const success = await dbService.updateUser(id, {
      username,
      email,
      fullName,
      phone,
      isActive,
      isPremium,
      isAdmin
    });

    if (success) {
      res.json({
        success: true,
        message: 'User updated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update user'
      });
    }

  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

// DELETE /api/auth/users/:id - Delete user (Admin)
router.delete('/users/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied'
      });
    }

    const token = authHeader.split(' ')[1];
    const sessionData = await dbService.validateSession(token);
    
    if (!sessionData || !sessionData.IsAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { id } = req.params;

    const success = await dbService.deleteUser(id);

    if (success) {
      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to delete user'
      });
    }

  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

// GET /api/auth/stats - Get user and system statistics (Admin)
router.get('/stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied'
      });
    }

    const token = authHeader.split(' ')[1];
    const sessionData = await dbService.validateSession(token);
    
    if (!sessionData || !sessionData.IsAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    // Get user statistics
    const userStats = await dbService.getUserStats();
    const grammarStats = await dbService.getGrammarStats();

    res.json({
      success: true,
      data: {
        users: userStats,
        grammar: grammarStats,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

// POST /api/auth/change-password - Change user password
router.post('/change-password', [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied'
      });
    }

    const token = authHeader.split(' ')[1];
    const sessionData = await dbService.validateSession(token);
    
    if (!sessionData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Verify current password
    const user = await dbService.verifyPassword(sessionData.Username, currentPassword);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password in database
    const request = dbService.pool.request();
    request.input('UserID', sessionData.UserID);
    request.input('PasswordHash', hashedPassword);
    
    await request.query(`
      UPDATE Users 
      SET PasswordHash = @PasswordHash
      WHERE UserID = @UserID
    `);

    console.log('✅ Password changed successfully for user:', sessionData.Username);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('❌ Error changing password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

// POST /api/auth/reset-password - Password reset (simplified version)
router.post('/reset-password', [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email } = req.body;

    // Check if user exists
    const user = await dbService.findUserByEmail(email);
    
    // Always return success for security reasons (don't reveal if email exists)
    res.json({
      success: true,
      message: 'If the email exists, password reset instructions have been sent'
    });

    if (user) {
      console.log('🔄 Password reset requested for user:', user.Username);
      // In a real application, you would send an email here
      // For now, just log that a reset was requested
    }

  } catch (error) {
    console.error('❌ Error in password reset:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed'
    });
  }
});

module.exports = router;