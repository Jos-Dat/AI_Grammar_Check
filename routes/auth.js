// routes/auth.js - Authentication routes
const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const router = express.Router();

// Simple in-memory user storage (replace with database in production)
const users = new Map();
const sessions = new Map();

// Helper function to generate tokens
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Validation rules
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
];

const loginValidation = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
];

// POST /api/auth/register
router.post('/register', registerValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { username, email, password } = req.body;

    // Check if user already exists
    if (users.has(username)) {
      return res.status(409).json({
        success: false,
        error: 'Username already exists'
      });
    }

    // Check if email already exists
    for (const [, user] of users) {
      if (user.email === email) {
        return res.status(409).json({
          success: false,
          error: 'Email already registered'
        });
      }
    }

    // Hash password (use bcrypt in production)
    const hashedPassword = crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');

    // Create user
    const user = {
      username,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };

    // Generate token
    const token = generateToken();

    // Store user
    users.set(username, user);
    
    // Store session
    sessions.set(token, { username, createdAt: Date.now() });

    res.status(201).json({
      success: true,
      data: {
        username,
        email,
        token
      },
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed'
    });
  }
});

// POST /api/auth/login
router.post('/login', loginValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { username, password } = req.body;

    // Get user
    const user = users.get(username);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Verify password
    const hashedPassword = crypto
      .createHash('sha256')
      .update(password)
      .digest('hex');

    if (user.password !== hashedPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate new token
    const token = generateToken();
    
    // Store session
    sessions.set(token, { username, createdAt: Date.now() });

    res.json({
      success: true,
      data: {
        username: user.username,
        email: user.email,
        token
      },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// GET /api/auth/verify
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);
  
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }

  // Check if session expired (24 hours)
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return res.status(401).json({
      success: false,
      error: 'Token expired'
    });
  }

  const user = users.get(session.username);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'User not found'
    });
  }

  res.json({
    success: true,
    data: {
      username: user.username,
      email: user.email
    }
  });
});

module.exports = router;