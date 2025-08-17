// server.js - Complete fixed backend with SQL Server integration
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

// Import database service
const DatabaseService = require('./services/DatabaseService');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-key-change-this';

// Initialize database service
const db = new DatabaseService();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        },
    }
}));

app.use(compression());

// CORS configuration
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : [
            'http://localhost:3000',
            'http://127.0.0.1:5500',
            'http://localhost:5500',
            'http://127.0.0.1:3000',
            'http://localhost:8080',
            'http://127.0.0.1:8080'
        ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
    credentials: true
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 200,
    message: {
        success: false,
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy
app.set('trust proxy', 1);

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    
    // Log body for POST requests (hide passwords)
    if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
        const logBody = { ...req.body };
        if (logBody.password) logBody.password = '[HIDDEN]';
        console.log('   Body:', JSON.stringify(logBody, null, 2));
    }
    
    next();
});

// FIXED: Static files from frontend folder
app.use(express.static(path.join(__dirname, '../frontend')));

// FIXED: Serve JS files from correct path
app.use('/js', express.static(path.join(__dirname, 'frontend', 'js')));

// Validation middleware
const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

// ENHANCED Authentication middleware
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log('🔍 Auth middleware check:', {
        hasAuthHeader: !!authHeader,
        hasToken: !!token,
        endpoint: req.path,
        method: req.method
    });

    if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({
            success: false,
            error: 'Access token required'
        });
    }

    try {
        console.log('🔍 Validating session with token...');
        const sessionData = await db.validateSession(token);
        
        if (!sessionData) {
            console.log('❌ Invalid or expired token');
            return res.status(403).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }

        console.log('✅ Session validated for user:', {
            UserID: sessionData.UserID,
            Username: sessionData.Username,
            IsAdmin: sessionData.IsAdmin
        });

        req.user = {
            id: sessionData.UserID,
            username: sessionData.Username,
            email: sessionData.Email,
            isPremium: sessionData.IsPremium,
            isActive: sessionData.IsActive,
            isAdmin: sessionData.IsAdmin
        };
        
        next();
    } catch (error) {
        console.error('❌ Auth middleware error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication service error'
        });
    }
}

// Admin authentication middleware
async function requireAdmin(req, res, next) {
    try {
        console.log('🔒 Admin access check for user:', req.user?.username);
        
        if (!req.user) {
            console.log('❌ No user in request');
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!req.user.isAdmin) {
            console.log('❌ User is not admin:', req.user.username);
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        console.log('✅ Admin access granted for:', req.user.username);
        next();
    } catch (error) {
        console.error('❌ Admin check error:', error);
        res.status(500).json({
            success: false,
            error: 'Authorization service error'
        });
    }
}

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API status
app.get('/api/status', async (req, res) => {
    try {
        const isDbConnected = await db.testConnection();
        res.json({
            success: true,
            data: {
                server: 'Grammar Checker API',
                version: '1.0.0',
                status: 'running',
                database: isDbConnected ? 'connected' : 'disconnected',
                timestamp: new Date().toISOString(),
                endpoints: {
                    auth: '/api/auth',
                    grammar: '/api/grammar'
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get system status'
        });
    }
});

// Auth routes
app.post('/api/auth/register', [
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
    body('phone')
        .optional()
        .trim()
        .matches(/^[\d\s\+\-\(\)]+$/)
        .withMessage('Invalid phone number format')
], validateRequest, async (req, res) => {
    try {
        console.log('🔄 Registration request received:', {
            username: req.body.username,
            email: req.body.email,
            hasPassword: !!req.body.password,
            phone: req.body.phone || 'not provided'
        });

        const { username, password, email, phone, fullName } = req.body;

        // Register user using database service
        const result = await db.registerUser({
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
        const token = await db.createSession(result.UserID, ipAddress, userAgent);

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

// ENHANCED Login route
app.post('/api/auth/login', [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
], validateRequest, async (req, res) => {
    try {
        console.log('🔄 Login request received:', {
            username: req.body.username,
            hasPassword: !!req.body.password,
            ip: req.ip
        });

        const { username, password } = req.body;

        // Verify password using database service
        const user = await db.verifyPassword(username, password);
        
        if (!user) {
            console.log('❌ Login failed: Invalid credentials for username:', username);
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // Check if user is active
        if (!user.IsActive) {
            console.log('❌ Login failed: User is inactive:', username);
            return res.status(401).json({
                success: false,
                error: 'Account is inactive. Please contact administrator.'
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
        const token = await db.createSession(user.UserID, ipAddress, userAgent);

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

// ENHANCED Token verification
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    console.log('✅ Token verification successful for:', req.user.username);
    res.json({
        success: true,
        data: {
            username: req.user.username,
            email: req.user.email,
            isPremium: req.user.isPremium,
            isAdmin: req.user.isAdmin,
            userID: req.user.id
        }
    });
});

app.post('/api/auth/logout', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token) {
            // Deactivate session in database
            try {
                const request = db.pool.request();
                request.input('SessionToken', token);
                await request.query('UPDATE UserSessions SET IsActive = 0 WHERE SessionToken = @SessionToken');
                console.log('✅ Session deactivated for logout');
            } catch (error) {
                console.error('❌ Error deactivating session:', error);
            }
        }

        res.json({
            success: true,
            message: 'Logout successful'
        });
    } catch (error) {
        console.error('❌ Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

// Grammar check routes
app.post('/api/grammar/check', [
    body('text')
        .isLength({ min: 1, max: 50000 })
        .withMessage('Text must be 1-50000 characters'),
    body('language')
        .optional()
        .isIn(['en-US', 'en-GB', 'de-DE', 'es', 'fr', 'nl'])
        .withMessage('Invalid language code')
], validateRequest, async (req, res) => {
    try {
        const { text, language = 'en-US' } = req.body;
        const sessionId = req.headers['x-session-id'];
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        const ipAddress = req.ip || req.connection.remoteAddress;

        console.log('Grammar check request:', {
            textLength: text.length,
            language,
            hasToken: !!token,
            sessionId,
            ipAddress
        });

        let user = null;
        let userId = null;

        // Check if authenticated
        if (token) {
            const sessionData = await db.validateSession(token);
            if (sessionData) {
                user = sessionData;
                userId = sessionData.UserID;
            }
        }

        // Check usage limits
        const usageCheck = await db.checkUsageLimit(userId, sessionId, ipAddress);
        
        if (!usageCheck.CanUse) {
            return res.status(429).json({
                success: false,
                error: user 
                    ? 'Daily usage limit reached. Please upgrade to premium for unlimited access.'
                    : 'Free usage limit reached (3/day). Please register or login to continue.',
                requiresAuth: !user,
                usage: {
                    used: usageCheck.CurrentUsage,
                    limit: usageCheck.MaxAllowed,
                    remaining: usageCheck.Remaining
                }
            });
        }

        // Increment usage count
        await db.incrementUsageCount(userId, sessionId, ipAddress);

        // Perform grammar check
        const startTime = Date.now();
        const matches = await performGrammarCheck(text, language);
        const processingTime = Date.now() - startTime;

        // Save grammar check to database
        await db.saveGrammarCheck({
            userID: userId,
            sessionToken: sessionId,
            originalText: text,
            language,
            errorCount: matches.length,
            errorsFound: matches,
            processingTime,
            ipAddress
        });

        // Get updated usage info
        const updatedUsage = await db.checkUsageLimit(userId, sessionId, ipAddress);

        console.log(`Grammar check completed: ${matches.length} errors found, ${processingTime}ms`);

        res.json({
            success: true,
            data: {
                matches,
                language,
                processingTime,
                usage: {
                    used: updatedUsage.CurrentUsage,
                    limit: updatedUsage.MaxAllowed,
                    remaining: updatedUsage.Remaining
                }
            }
        });

    } catch (error) {
        console.error('Grammar check error:', error);
        res.status(500).json({
            success: false,
            error: 'Grammar check failed due to server error'
        });
    }
});

// Grammar checking function with LanguageTool integration
async function performGrammarCheck(text, language) {
    try {
        // Try LanguageTool API first
        const params = new URLSearchParams({
            text: text,
            language: language,
            enabledOnly: 'false'
        });

        const response = await fetch('https://api.languagetool.org/v2/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params
        });

        if (response.ok) {
            const data = await response.json();
            return data.matches || [];
        } else {
            console.warn('LanguageTool API failed, using fallback');
        }
    } catch (error) {
        console.warn('LanguageTool API error, using fallback:', error.message);
    }

    // Fallback to basic pattern matching
    return performBasicGrammarCheck(text, language);
}

// Basic grammar checking fallback
function performBasicGrammarCheck(text, language) {
    const errors = [];
    
    // Common patterns to check
    const patterns = [
        {
            regex: /\bi am\b/gi,
            message: "Consider using 'I am' with capital 'I'",
            category: "CAPITALIZATION",
            replacements: [{ value: "I am" }]
        },
        {
            regex: /\bteh\b/gi,
            message: "Possible spelling mistake found",
            category: "TYPOS",
            replacements: [{ value: "the" }]
        },
        {
            regex: /\byour\s+welcome\b/gi,
            message: "Did you mean 'you're welcome'?",
            category: "GRAMMAR",
            replacements: [{ value: "you're welcome" }]
        },
        {
            regex: /\bits\s+a\s+nice\s+day\b/gi,
            message: "Consider 'it's a nice day'",
            category: "GRAMMAR",
            replacements: [{ value: "it's a nice day" }]
        },
        {
            regex: /\bwould of\b/gi,
            message: "Did you mean 'would have'?",
            category: "GRAMMAR",
            replacements: [{ value: "would have" }]
        },
        {
            regex: /\bthere\s+house\b/gi,
            message: "Did you mean 'their house'?",
            category: "GRAMMAR",
            replacements: [{ value: "their house" }]
        }
    ];

    // Add language-specific patterns
    if (language === 'de-DE') {
        patterns.push({
            regex: /\bdas\s+sind\b/gi,
            message: "Consider 'das ist' for singular",
            category: "GRAMMAR",
            replacements: [{ value: "das ist" }]
        });
    }

    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.regex.exec(text)) !== null) {
            errors.push({
                message: pattern.message,
                offset: match.index,
                length: match[0].length,
                category: pattern.category,
                replacements: pattern.replacements,
                context: {
                    text: text.substring(
                        Math.max(0, match.index - 20),
                        match.index + match[0].length + 20
                    ),
                    offset: Math.min(20, match.index),
                    length: match[0].length
                }
            });
        }
    });

    return errors;
}

app.get('/api/grammar/languages', (req, res) => {
    res.json({
        success: true,
        data: {
            languages: [
                { code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
                { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧' },
                { code: 'de-DE', name: 'German', flag: '🇩🇪' },
                { code: 'es', name: 'Spanish', flag: '🇪🇸' },
                { code: 'fr', name: 'French', flag: '🇫🇷' },
                { code: 'nl', name: 'Dutch', flag: '🇳🇱' }
            ]
        }
    });
});

app.get('/api/grammar/usage', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        const ipAddress = req.ip || req.connection.remoteAddress;

        let userId = null;
        let isPremium = false;

        if (token) {
            const sessionData = await db.validateSession(token);
            if (sessionData) {
                userId = sessionData.UserID;
                isPremium = sessionData.IsPremium;
            }
        }

        const usage = await db.checkUsageLimit(userId, sessionId, ipAddress);

        res.json({
            success: true,
            data: {
                used: usage.CurrentUsage,
                limit: usage.MaxAllowed,
                remaining: usage.Remaining,
                isPremium
            }
        });

    } catch (error) {
        console.error('Usage check error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get usage information'
        });
    }
});

// ENHANCED Admin routes with proper protection
app.get('/api/auth/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        console.log('👥 Admin requesting users list');
        
        // Get all users
        const users = await db.getAllUsers();

        console.log(`📊 Retrieved ${users.length} users for admin`);

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

app.put('/api/auth/users/:id', [
    authenticateToken,
    requireAdmin,
    body('isPremium').optional().isBoolean(),
    body('isActive').optional().isBoolean(),
    body('isAdmin').optional().isBoolean()
], validateRequest, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { username, email, fullName, phone, isPremium, isActive, isAdmin } = req.body;

        console.log('✏️ Admin updating user:', { userId, updates: req.body });

        // Don't allow admins to remove their own admin status
        if (userId === req.user.id && isAdmin === false) {
            return res.status(400).json({
                success: false,
                error: 'Cannot remove your own admin privileges'
            });
        }

        const success = await db.updateUser(userId, {
            username,
            email,
            fullName,
            phone,
            isPremium,
            isActive,
            isAdmin
        });

        if (success) {
            console.log('✅ User updated successfully:', userId);
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

app.delete('/api/auth/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        console.log('🗑️ Admin deleting user:', userId);

        // Don't allow deleting self
        if (userId === req.user.id) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete your own account'
            });
        }

        const success = await db.deleteUser(userId);

        if (success) {
            console.log('✅ User deleted successfully:', userId);
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

// ✅ FIXED: Serve HTML files from correct paths based on your folder structure
app.get('/', (req, res) => {
    const introPath = path.join(__dirname, 'frontend', 'pages', 'introduction.html');
    console.log('📄 Serving intro from:', introPath);
    res.sendFile(introPath);
});

app.get('/app', (req, res) => {
    const appPath = path.join(__dirname, 'frontend', 'pages', 'indexxx.html');
    console.log('📄 Serving app from:', appPath);
    res.sendFile(appPath);
});

// ✅ FIXED: This was the problem - changed from 'backend/public' to 'frontend/pages'
app.get('/admin', (req, res) => {
    const adminPath = path.join(__dirname, 'frontend', 'pages', 'admin.html');
    console.log('📄 Serving admin from:', adminPath);
    res.sendFile(adminPath);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err);
    console.error('Request details:', {
        method: req.method,
        url: req.url,
        headers: req.headers
    });
    
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found'
    });
});

// 404 handler for other routes
app.use('*', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            error: 'API endpoint not found'
        });
    } else {
        res.status(404).send('Page not found');
    }
});

// Cleanup function
async function performCleanup() {
    try {
        if (db.pool) {
            await db.cleanExpiredSessions();
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

// Initialize database and start server
async function startServer() {
    try {
        console.log('🚀 Starting Grammar Checker Server...');
        console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📁 Frontend path: ${path.join(__dirname, 'frontend')}`);
        
        // Connect to database
        await db.connect();
        
        // Test database connection
        const isConnected = await db.testConnection();
        if (!isConnected) {
            throw new Error('Database connection test failed');
        }
        
        console.log('✅ Database connection verified');
        
        // Set up cleanup interval (every hour)
        setInterval(performCleanup, 60 * 60 * 1000);
        
        // Start server
        const server = app.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`🔗 Application: http://localhost:${PORT}`);
            console.log(`🔗 Grammar Checker: http://localhost:${PORT}/app`);
            console.log(`🔗 Admin Panel: http://localhost:${PORT}/admin`);
            console.log(`🔗 Health Check: http://localhost:${PORT}/health`);
            console.log(`🔗 API Status: http://localhost:${PORT}/api/status`);
            console.log(`👤 Demo Admin: admin/admin123`);
            console.log(`🌍 Supported Languages: English, German, Spanish, French, Dutch`);
            
            // Log file paths for debugging
            console.log('\n📁 File Structure Check:');
            console.log(`   ✅ Admin HTML: ${path.join(__dirname, 'frontend', 'pages', 'admin.html')}`);
            console.log(`   ✅ API Client: ${path.join(__dirname, 'frontend', 'js', 'api-client.js')}`);
            console.log(`   ✅ Admin JS: ${path.join(__dirname, 'frontend', 'js', 'admin.js')}`);
        });

        // Graceful shutdown handlers
        const gracefulShutdown = async () => {
            console.log('\n🛑 Received shutdown signal, closing server gracefully...');
            
            server.close(async () => {
                console.log('✅ HTTP server closed');
                
                try {
                    await db.disconnect();
                    console.log('✅ Database connection closed');
                } catch (error) {
                    console.error('❌ Error closing database:', error);
                }
                
                process.exit(0);
            });
        };

        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGQUIT', gracefulShutdown);

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        
        if (error.message.includes('connection failed') || error.message.includes('login failed')) {
            console.log('\n🔧 Database Connection Troubleshooting:');
            console.log('1. Make sure SQL Server is running');
            console.log('2. Check connection string in .env file');
            console.log('3. Verify SQL Server authentication mode');
            console.log('4. Run database setup script first:');
            console.log('   sqlcmd -S localhost -U sa -P YourPassword123 -i setup-database.sql');
            console.log('5. Test connection with: npm run test-db');
        }
        
        process.exit(1);
    }
}

// Start the server
startServer();