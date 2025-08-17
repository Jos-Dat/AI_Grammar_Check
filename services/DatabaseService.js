// backend/services/DatabaseService.js - Fixed with proper SQL import and all functions
const sql = require('mssql');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

class DatabaseService {
    constructor() {
        this.pool = null;
        this.config = {
            user: process.env.DB_USER || 'sa',
            password: process.env.DB_PASSWORD || 'YourPassword123',
            server: process.env.DB_SERVER || 'localhost',
            database: process.env.DB_NAME || 'GrammarCheckerDB',
            options: {
                encrypt: process.env.DB_ENCRYPT === 'true',
                trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            },
            connectionTimeout: 60000,
            requestTimeout: 60000
        };
    }

    async connect() {
        try {
            console.log('🔄 Connecting to SQL Server...');
            console.log(`   Server: ${this.config.server}`);
            console.log(`   Database: ${this.config.database}`);
            console.log(`   User: ${this.config.user}`);
            
            this.pool = await sql.connect(this.config);
            console.log('✅ Connected to SQL Server successfully');
            return true;
        } catch (err) {
            console.error('❌ Database connection failed:', err.message);
            throw err;
        }
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.close();
            console.log('🔌 Database connection closed');
        }
    }

    // Find user by username - MISSING FUNCTION ADDED
    async findUserByUsername(username) {
        try {
            const request = this.pool.request();
            request.input('Username', sql.NVarChar(50), username);
            
            const result = await request.query(`
                SELECT UserID, Username, Email, PasswordHash, FullName, 
                       IsPremium, IsActive, IsAdmin, CreatedAt, LastLoginAt
                FROM Users 
                WHERE Username = @Username AND IsActive = 1
            `);
            
            return result.recordset[0] || null;
        } catch (err) {
            console.error('Error finding user by username:', err);
            return null;
        }
    }

    // Find user by email - ADDITIONAL HELPER FUNCTION
    async findUserByEmail(email) {
        try {
            const request = this.pool.request();
            request.input('Email', sql.NVarChar(100), email);
            
            const result = await request.query(`
                SELECT UserID, Username, Email, PasswordHash, FullName, 
                       IsPremium, IsActive, IsAdmin, CreatedAt, LastLoginAt
                FROM Users 
                WHERE Email = @Email AND IsActive = 1
            `);
            
            return result.recordset[0] || null;
        } catch (err) {
            console.error('Error finding user by email:', err);
            return null;
        }
    }

    // Check usage limit
    async checkUsageLimit(userID = null, sessionToken = null, ipAddress = null) {
        try {
            const request = this.pool.request();
            request.input('UserID', sql.Int, userID);
            request.input('SessionToken', sql.NVarChar(255), sessionToken);
            request.input('IPAddress', sql.NVarChar(45), ipAddress);

            const result = await request.execute('CheckUsageLimit');
            return result.recordset[0];
        } catch (err) {
            console.error('Error checking usage limit:', err);
            // Fallback to allow usage if database error
            return { CanUse: 1, CurrentUsage: 0, MaxAllowed: 3, Remaining: 3 };
        }
    }

    // Increment usage count
    async incrementUsageCount(userID = null, sessionToken = null, ipAddress = null) {
        try {
            const request = this.pool.request();
            request.input('UserID', sql.Int, userID);
            request.input('SessionToken', sql.NVarChar(255), sessionToken);
            request.input('IPAddress', sql.NVarChar(45), ipAddress);

            await request.execute('IncrementUsageCount');
            return true;
        } catch (err) {
            console.error('Error incrementing usage count:', err);
            return false;
        }
    }

    // Register user - ENHANCED WITH BETTER ERROR HANDLING
    async registerUser(userData) {
        try {
            console.log('🔄 Registering user:', {
                username: userData.username,
                email: userData.email,
                phone: userData.phone || 'not provided',
                fullName: userData.fullName || 'not provided'
            });

            // Check if username already exists
            const existingUser = await this.findUserByUsername(userData.username);
            if (existingUser) {
                console.log('❌ Username already exists');
                return { Success: 0, Message: 'Username already exists' };
            }

            // Check if email already exists
            const existingEmail = await this.findUserByEmail(userData.email);
            if (existingEmail) {
                console.log('❌ Email already exists');
                return { Success: 0, Message: 'Email already exists' };
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(userData.password, 12);
            console.log('🔐 Password hashed successfully');
            
            const request = this.pool.request();
            request.input('Username', sql.NVarChar(50), userData.username);
            request.input('Email', sql.NVarChar(100), userData.email);
            request.input('PasswordHash', sql.NVarChar(255), hashedPassword);
            request.input('Phone', sql.NVarChar(20), userData.phone || null);
            request.input('FullName', sql.NVarChar(100), userData.fullName || null);

            const result = await request.execute('RegisterUser');
            const response = result.recordset[0];
            
            console.log('📊 Registration result:', response);
            return response;
        } catch (err) {
            console.error('❌ Error registering user:', err);
            
            // Check for specific SQL Server errors
            if (err.number === 2627 || err.number === 2601) { // Unique constraint violation
                return { Success: 0, Message: 'Username or email already exists' };
            }
            
            return { Success: 0, Message: 'Registration failed due to database error: ' + err.message };
        }
    }

    // Verify password - ENHANCED WITH DETAILED LOGGING
    async verifyPassword(username, password) {
        try {
            console.log('🔍 Login attempt details:');
            console.log('   Username:', username);
            console.log('   Password length:', password.length);

            const request = this.pool.request();
            request.input('Username', sql.NVarChar(50), username);
            
            const query = `
                SELECT UserID, Username, PasswordHash, IsActive, IsPremium, IsAdmin, Email, FullName
                FROM Users 
                WHERE Username = @Username AND IsActive = 1
            `;
            
            console.log('📋 Executing SQL query for user verification');
            const result = await request.query(query);
            
            console.log('📊 Query results:');
            console.log('   Records found:', result.recordset.length);
            
            if (result.recordset.length === 0) {
                console.log('❌ No user found with username:', username);
                
                // Check if user exists but inactive
                const inactiveCheck = await this.pool.request()
                    .input('Username', sql.NVarChar(50), username)
                    .query('SELECT Username, IsActive FROM Users WHERE Username = @Username');
                
                if (inactiveCheck.recordset.length > 0) {
                    console.log('⚠️  User exists but IsActive =', inactiveCheck.recordset[0].IsActive);
                } else {
                    console.log('⚠️  User does not exist in database');
                }
                
                return null;
            }

            const user = result.recordset[0];
            
            console.log('👤 User found:');
            console.log('   UserID:', user.UserID);
            console.log('   Username:', user.Username);
            console.log('   Email:', user.Email);
            console.log('   IsActive:', user.IsActive);
            console.log('   IsPremium:', user.IsPremium);
            console.log('   IsAdmin:', user.IsAdmin);

            if (!user) {
                console.log('❌ User object is null');
                return null;
            }
            
            console.log('🔐 Testing password with bcrypt...');
            const isValidPassword = await bcrypt.compare(password, user.PasswordHash);
            console.log('🔐 Password comparison result:', isValidPassword);
            
            if (!isValidPassword) {
                console.log('❌ Password verification failed');
                return null;
            }
            
            // Update last login
            const updateRequest = this.pool.request();
            updateRequest.input('UserID', sql.Int, user.UserID);
            await updateRequest.query(`
                UPDATE Users 
                SET LastLoginAt = GETDATE() 
                WHERE UserID = @UserID
            `);
            
            console.log('✅ Login successful for user:', username);
            return {
                UserID: user.UserID,
                Username: user.Username,
                Email: user.Email,
                FullName: user.FullName,
                IsPremium: user.IsPremium,
                IsActive: user.IsActive,
                IsAdmin: user.IsAdmin || false
            };
            
        } catch (err) {
            console.error('❌ Error in verifyPassword:', err);
            return null;
        }
    }

    // Create session token
    async createSession(userID, ipAddress, userAgent) {
        try {
            const token = jwt.sign(
                { userID, timestamp: Date.now() },
                process.env.JWT_SECRET || 'your-default-secret-key-change-this',
                { expiresIn: '24h' }
            );

            const request = this.pool.request();
            request.input('UserID', sql.Int, userID);
            request.input('SessionToken', sql.NVarChar(255), token);
            request.input('IPAddress', sql.NVarChar(45), ipAddress || 'unknown');
            request.input('UserAgent', sql.NVarChar(500), userAgent || 'unknown');
            
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            request.input('ExpiresAt', sql.DateTime2, expiresAt);

            await request.query(`
                INSERT INTO UserSessions (UserID, SessionToken, IPAddress, UserAgent, ExpiresAt)
                VALUES (@UserID, @SessionToken, @IPAddress, @UserAgent, @ExpiresAt)
            `);

            console.log('✅ Session created for user ID:', userID);
            return token;
        } catch (err) {
            console.error('❌ Error creating session:', err);
            return null;
        }
    }

    // Validate session
    async validateSession(token) {
        try {
            const request = this.pool.request();
            request.input('SessionToken', sql.NVarChar(255), token);

            const result = await request.query(`
                SELECT s.UserID, u.Username, u.Email, u.IsPremium, u.IsActive, u.IsAdmin
                FROM UserSessions s
                INNER JOIN Users u ON s.UserID = u.UserID
                WHERE s.SessionToken = @SessionToken 
                    AND s.IsActive = 1 
                    AND s.ExpiresAt > GETDATE()
                    AND u.IsActive = 1
            `);

            const sessionData = result.recordset[0] || null;
            if (sessionData) {
                console.log('✅ Valid session found for user:', sessionData.Username);
            }
            return sessionData;
        } catch (err) {
            console.error('❌ Error validating session:', err);
            return null;
        }
    }

    // Save grammar check result
    async saveGrammarCheck(data) {
        try {
            const request = this.pool.request();
            request.input('UserID', sql.Int, data.userID || null);
            request.input('SessionToken', sql.NVarChar(255), data.sessionToken || null);
            request.input('OriginalText', sql.NVarChar(sql.MAX), data.originalText);
            request.input('CorrectedText', sql.NVarChar(sql.MAX), data.correctedText || null);
            request.input('Language', sql.NVarChar(10), data.language);
            request.input('ErrorCount', sql.Int, data.errorCount || 0);
            request.input('ErrorsFound', sql.NVarChar(sql.MAX), JSON.stringify(data.errorsFound) || null);
            request.input('ProcessingTime', sql.Int, data.processingTime || null);
            request.input('IPAddress', sql.NVarChar(45), data.ipAddress || null);

            const result = await request.execute('SaveGrammarCheck');
            return result.recordset[0].CheckID;
        } catch (err) {
            console.error('Error saving grammar check:', err);
            return null;
        }
    }

    // Get all users (for admin)
    async getAllUsers() {
        try {
            const request = this.pool.request();
            const result = await request.query(`
                SELECT 
                    UserID, Username, Email, FullName, Phone,
                    IsActive, IsPremium, IsAdmin, CreatedAt, LastLoginAt
                FROM Users 
                ORDER BY CreatedAt DESC
            `);

            return result.recordset;
        } catch (err) {
            console.error('Error getting all users:', err);
            return [];
        }
    }

    // Update user (for admin)
    async updateUser(userID, userData) {
        try {
            const request = this.pool.request();
            request.input('UserID', sql.Int, userID);
            request.input('Username', sql.NVarChar(50), userData.username);
            request.input('Email', sql.NVarChar(100), userData.email);
            request.input('FullName', sql.NVarChar(100), userData.fullName);
            request.input('Phone', sql.NVarChar(20), userData.phone);
            request.input('IsActive', sql.Bit, userData.isActive);
            request.input('IsPremium', sql.Bit, userData.isPremium);
            request.input('IsAdmin', sql.Bit, userData.isAdmin);

            await request.query(`
                UPDATE Users 
                SET Username = @Username,
                    Email = @Email,
                    FullName = @FullName,
                    Phone = @Phone,
                    IsActive = @IsActive,
                    IsPremium = @IsPremium,
                    IsAdmin = @IsAdmin
                WHERE UserID = @UserID
            `);

            return true;
        } catch (err) {
            console.error('Error updating user:', err);
            return false;
        }
    }

    // Delete user (for admin)
    async deleteUser(userID) {
        try {
            const request = this.pool.request();
            request.input('UserID', sql.Int, userID);

            await request.query('DELETE FROM Users WHERE UserID = @UserID');
            return true;
        } catch (err) {
            console.error('Error deleting user:', err);
            return false;
        }
    }

    // Clean expired sessions
    async cleanExpiredSessions() {
        try {
            const request = this.pool.request();
            const result = await request.query(`
                UPDATE UserSessions 
                SET IsActive = 0 
                WHERE ExpiresAt <= GETDATE() AND IsActive = 1
            `);
            
            if (result.rowsAffected[0] > 0) {
                console.log(`🧹 Cleaned ${result.rowsAffected[0]} expired sessions`);
            }
        } catch (err) {
            console.error('Error cleaning expired sessions:', err);
        }
    }

    // Test database connection
    async testConnection() {
        try {
            const request = this.pool.request();
            const result = await request.query('SELECT 1 as test');
            return result.recordset[0].test === 1;
        } catch (err) {
            console.error('Database connection test failed:', err);
            return false;
        }
    }

    // Get user statistics
    async getUserStats() {
        try {
            const request = this.pool.request();
            const result = await request.query(`
                SELECT 
                    COUNT(*) as TotalUsers,
                    SUM(CASE WHEN IsPremium = 1 THEN 1 ELSE 0 END) as PremiumUsers,
                    SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) as ActiveUsers,
                    SUM(CASE WHEN IsAdmin = 1 THEN 1 ELSE 0 END) as AdminUsers
                FROM Users
            `);

            return result.recordset[0];
        } catch (err) {
            console.error('Error getting user stats:', err);
            return { TotalUsers: 0, PremiumUsers: 0, ActiveUsers: 0, AdminUsers: 0 };
        }
    }

    // Get grammar check statistics
    async getGrammarStats() {
        try {
            const request = this.pool.request();
            const result = await request.query(`
                SELECT 
                    COUNT(*) as TotalChecks,
                    COUNT(DISTINCT UserID) as UniqueUsers,
                    AVG(ErrorCount) as AvgErrors,
                    COUNT(CASE WHEN Language = 'en-US' THEN 1 END) as EnglishChecks,
                    COUNT(CASE WHEN Language = 'de-DE' THEN 1 END) as GermanChecks,
                    COUNT(CASE WHEN Language = 'fr' THEN 1 END) as FrenchChecks
                FROM GrammarChecks
                WHERE CreatedAt >= DATEADD(day, -30, GETDATE())
            `);

            return result.recordset[0];
        } catch (err) {
            console.error('Error getting grammar stats:', err);
            return { TotalChecks: 0, UniqueUsers: 0, AvgErrors: 0 };
        }
    }
}

module.exports = DatabaseService;