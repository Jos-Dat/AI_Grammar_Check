// backend/services/DatabaseService.js
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
                trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
            },
            pool: {
                max: 10,
                min: 0,
                idleTimeoutMillis: 30000
            }
        };
    }

    async connect() {
        try {
            this.pool = await sql.connect(this.config);
            console.log('✅ Connected to SQL Server');
            return true;
        } catch (err) {
            console.error('❌ Database connection failed:', err);
            throw err;
        }
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.close();
            console.log('🔌 Database connection closed');
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

    // Register user
    async registerUser(userData) {
        try {
            const hashedPassword = await bcrypt.hash(userData.password, 10);
            
            const request = this.pool.request();
            request.input('Username', sql.NVarChar(50), userData.username);
            request.input('Email', sql.NVarChar(100), userData.email);
            request.input('PasswordHash', sql.NVarChar(255), hashedPassword);
            request.input('Phone', sql.NVarChar(20), userData.phone || null);
            request.input('FullName', sql.NVarChar(100), userData.fullName || null);

            const result = await request.execute('RegisterUser');
            return result.recordset[0];
        } catch (err) {
            console.error('Error registering user:', err);
            return { Success: 0, Message: 'Registration failed' };
        }
    }

    // Verify password and login
    async verifyPassword(username, password) {
        try {
            const request = this.pool.request();
            request.input('Username', sql.NVarChar(50), username);
            
            const query = `
                SELECT UserID, PasswordHash, IsActive, IsPremium, Email, FullName
                FROM Users 
                WHERE Username = @Username AND IsActive = 1
            `;
            
            const result = await request.query(query);
            const user = result.recordset[0];
            
            if (!user) {
                return null;
            }
            
            const isValidPassword = await bcrypt.compare(password, user.PasswordHash);
            if (!isValidPassword) {
                return null;
            }
            
            // Update last login
            await request.query(`
                UPDATE Users 
                SET LastLoginAt = GETDATE() 
                WHERE UserID = ${user.UserID}
            `);
            
            return {
                UserID: user.UserID,
                Username: username,
                Email: user.Email,
                FullName: user.FullName,
                IsPremium: user.IsPremium,
                IsActive: user.IsActive
            };
        } catch (err) {
            console.error('Error verifying password:', err);
            return null;
        }
    }

    // Create session token
    async createSession(userID, ipAddress, userAgent) {
        try {
            const token = jwt.sign(
                { userID, timestamp: Date.now() },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '24h' }
            );

            const request = this.pool.request();
            request.input('UserID', sql.Int, userID);
            request.input('SessionToken', sql.NVarChar(255), token);
            request.input('IPAddress', sql.NVarChar(45), ipAddress);
            request.input('UserAgent', sql.NVarChar(500), userAgent);
            request.input('ExpiresAt', sql.DateTime2, new Date(Date.now() + 24 * 60 * 60 * 1000));

            await request.query(`
                INSERT INTO UserSessions (UserID, SessionToken, IPAddress, UserAgent, ExpiresAt)
                VALUES (@UserID, @SessionToken, @IPAddress, @UserAgent, @ExpiresAt)
            `);

            return token;
        } catch (err) {
            console.error('Error creating session:', err);
            return null;
        }
    }

    // Validate session
    async validateSession(token) {
        try {
            const request = this.pool.request();
            request.input('SessionToken', sql.NVarChar(255), token);

            const result = await request.query(`
                SELECT s.UserID, u.Username, u.Email, u.IsPremium, u.IsActive
                FROM UserSessions s
                INNER JOIN Users u ON s.UserID = u.UserID
                WHERE s.SessionToken = @SessionToken 
                    AND s.IsActive = 1 
                    AND s.ExpiresAt > GETDATE()
                    AND u.IsActive = 1
            `);

            return result.recordset[0] || null;
        } catch (err) {
            console.error('Error validating session:', err);
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

    // Clean expired sessions
    async cleanExpiredSessions() {
        try {
            const request = this.pool.request();
            await request.query(`
                UPDATE UserSessions 
                SET IsActive = 0 
                WHERE ExpiresAt <= GETDATE() AND IsActive = 1
            `);
        } catch (err) {
            console.error('Error cleaning expired sessions:', err);
        }
    }
}

module.exports = DatabaseService;