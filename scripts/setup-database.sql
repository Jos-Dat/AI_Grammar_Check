-- setup-database.sql - Complete SQL Server database setup
-- Run this script to create the database and all required tables, procedures

USE master;
GO

-- Create database if it doesn't exist
IF NOT EXISTS(SELECT name FROM sys.databases WHERE name = 'GrammarCheckerDB')
BEGIN
    CREATE DATABASE GrammarCheckerDB;
    PRINT '✅ Database GrammarCheckerDB created successfully';
END
ELSE
BEGIN
    PRINT '📁 Database GrammarCheckerDB already exists';
END
GO

USE GrammarCheckerDB;
GO

-- Create Users table
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
BEGIN
    CREATE TABLE Users (
        UserID INT IDENTITY(1,1) PRIMARY KEY,
        Username NVARCHAR(50) NOT NULL UNIQUE,
        Email NVARCHAR(100) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(255) NOT NULL,
        Phone NVARCHAR(20) NULL,
        FullName NVARCHAR(100) NULL,
        IsPremium BIT DEFAULT 0,
        IsActive BIT DEFAULT 1,
        IsAdmin BIT DEFAULT 0,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        LastLoginAt DATETIME2 NULL,
        INDEX IX_Users_Username (Username),
        INDEX IX_Users_Email (Email)
    );
    PRINT '✅ Users table created';
END
ELSE
BEGIN
    PRINT '📋 Users table already exists';
END
GO

-- Create UserSessions table
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'UserSessions')
BEGIN
    CREATE TABLE UserSessions (
        SessionID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        SessionToken NVARCHAR(255) NOT NULL UNIQUE,
        IPAddress NVARCHAR(45) NULL,
        UserAgent NVARCHAR(500) NULL,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        ExpiresAt DATETIME2 NOT NULL,
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE,
        INDEX IX_Sessions_Token (SessionToken),
        INDEX IX_Sessions_UserID (UserID),
        INDEX IX_Sessions_Expires (ExpiresAt)
    );
    PRINT '✅ UserSessions table created';
END
ELSE
BEGIN
    PRINT '📋 UserSessions table already exists';
END
GO

-- Create UsageLimits table
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'UsageLimits')
BEGIN
    CREATE TABLE UsageLimits (
        LimitID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NULL,
        SessionToken NVARCHAR(255) NULL,
        IPAddress NVARCHAR(45) NULL,
        UsageCount INT DEFAULT 0,
        LimitDate DATE DEFAULT CAST(GETDATE() AS DATE),
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        UpdatedAt DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE,
        INDEX IX_Usage_UserID (UserID),
        INDEX IX_Usage_Session (SessionToken),
        INDEX IX_Usage_IP (IPAddress),
        INDEX IX_Usage_Date (LimitDate)
    );
    PRINT '✅ UsageLimits table created';
END
ELSE
BEGIN
    PRINT '📋 UsageLimits table already exists';
END
GO

-- Create GrammarChecks table
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'GrammarChecks')
BEGIN
    CREATE TABLE GrammarChecks (
        CheckID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NULL,
        SessionToken NVARCHAR(255) NULL,
        OriginalText NVARCHAR(MAX) NOT NULL,
        CorrectedText NVARCHAR(MAX) NULL,
        Language NVARCHAR(10) DEFAULT 'en-US',
        ErrorCount INT DEFAULT 0,
        ErrorsFound NVARCHAR(MAX) NULL,
        ProcessingTime INT NULL,
        IPAddress NVARCHAR(45) NULL,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE SET NULL,
        INDEX IX_Grammar_UserID (UserID),
        INDEX IX_Grammar_Date (CreatedAt),
        INDEX IX_Grammar_Language (Language)
    );
    PRINT '✅ GrammarChecks table created';
END
ELSE
BEGIN
    PRINT '📋 GrammarChecks table already exists';
END
GO

-- Insert default admin user
IF NOT EXISTS (SELECT 1 FROM Users WHERE Username = 'admin')
BEGIN
    INSERT INTO Users (Username, Email, PasswordHash, FullName, IsAdmin, IsPremium)
    VALUES (
        'admin',
        'admin@example.com',
        '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeWmJTh.3UFW.Bv6G', -- password: admin123
        'System Administrator',
        1,
        1
    );
    PRINT '✅ Default admin user created (admin/admin123)';
END
ELSE
BEGIN
    PRINT '👤 Admin user already exists';
END
GO

-- Create RegisterUser stored procedure
IF OBJECT_ID('RegisterUser', 'P') IS NOT NULL
    DROP PROCEDURE RegisterUser;
GO

CREATE PROCEDURE RegisterUser
    @Username NVARCHAR(50),
    @Email NVARCHAR(100),
    @PasswordHash NVARCHAR(255),
    @Phone NVARCHAR(20) = NULL,
    @FullName NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- Check if username exists
        IF EXISTS (SELECT 1 FROM Users WHERE Username = @Username)
        BEGIN
            SELECT 0 AS Success, 'Username already exists' AS Message;
            RETURN;
        END
        
        -- Check if email exists
        IF EXISTS (SELECT 1 FROM Users WHERE Email = @Email)
        BEGIN
            SELECT 0 AS Success, 'Email already exists' AS Message;
            RETURN;
        END
        
        -- Insert new user
        INSERT INTO Users (Username, Email, PasswordHash, Phone, FullName)
        VALUES (@Username, @Email, @PasswordHash, @Phone, @FullName);
        
        -- Return success with user ID
        SELECT 
            1 AS Success, 
            'Registration successful' AS Message,
            SCOPE_IDENTITY() AS UserID,
            @Username AS Username,
            @Email AS Email;
            
    END TRY
    BEGIN CATCH
        SELECT 
            0 AS Success, 
            'Registration failed: ' + ERROR_MESSAGE() AS Message;
    END CATCH
END
GO

-- Create CheckUsageLimit stored procedure
IF OBJECT_ID('CheckUsageLimit', 'P') IS NOT NULL
    DROP PROCEDURE CheckUsageLimit;
GO

CREATE PROCEDURE CheckUsageLimit
    @UserID INT = NULL,
    @SessionToken NVARCHAR(255) = NULL,
    @IPAddress NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @CurrentUsage INT = 0;
    DECLARE @MaxAllowed INT = 3; -- Default for free users
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);
    DECLARE @IsPremium BIT = 0;
    
    -- Check if user is premium
    IF @UserID IS NOT NULL
    BEGIN
        SELECT @IsPremium = ISNULL(IsPremium, 0) FROM Users WHERE UserID = @UserID;
        IF @IsPremium = 1
            SET @MaxAllowed = 1000; -- Premium users get 1000/day
    END
    
    -- Get current usage
    SELECT @CurrentUsage = ISNULL(UsageCount, 0)
    FROM UsageLimits 
    WHERE LimitDate = @Today
        AND (
            (@UserID IS NOT NULL AND UserID = @UserID) OR
            (@SessionToken IS NOT NULL AND SessionToken = @SessionToken) OR
            (@IPAddress IS NOT NULL AND IPAddress = @IPAddress)
        );
    
    -- Return usage information
    SELECT 
        CASE WHEN @CurrentUsage < @MaxAllowed THEN 1 ELSE 0 END AS CanUse,
        @CurrentUsage AS CurrentUsage,
        @MaxAllowed AS MaxAllowed,
        @MaxAllowed - @CurrentUsage AS Remaining;
END
GO

-- Create IncrementUsageCount stored procedure
IF OBJECT_ID('IncrementUsageCount', 'P') IS NOT NULL
    DROP PROCEDURE IncrementUsageCount;
GO

CREATE PROCEDURE IncrementUsageCount
    @UserID INT = NULL,
    @SessionToken NVARCHAR(255) = NULL,
    @IPAddress NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);
    
    -- Update or insert usage record
    MERGE UsageLimits AS target
    USING (
        SELECT 
            @UserID AS UserID,
            @SessionToken AS SessionToken,
            @IPAddress AS IPAddress,
            @Today AS LimitDate
    ) AS source ON (
        target.LimitDate = source.LimitDate AND (
            (target.UserID = source.UserID AND source.UserID IS NOT NULL) OR
            (target.SessionToken = source.SessionToken AND source.SessionToken IS NOT NULL) OR
            (target.IPAddress = source.IPAddress AND source.IPAddress IS NOT NULL)
        )
    )
    WHEN MATCHED THEN
        UPDATE SET 
            UsageCount = UsageCount + 1,
            UpdatedAt = GETDATE()
    WHEN NOT MATCHED THEN
        INSERT (UserID, SessionToken, IPAddress, UsageCount, LimitDate)
        VALUES (source.UserID, source.SessionToken, source.IPAddress, 1, source.LimitDate);
END
GO

-- Create SaveGrammarCheck stored procedure
IF OBJECT_ID('SaveGrammarCheck', 'P') IS NOT NULL
    DROP PROCEDURE SaveGrammarCheck;
GO

CREATE PROCEDURE SaveGrammarCheck
    @UserID INT = NULL,
    @SessionToken NVARCHAR(255) = NULL,
    @OriginalText NVARCHAR(MAX),
    @CorrectedText NVARCHAR(MAX) = NULL,
    @Language NVARCHAR(10) = 'en-US',
    @ErrorCount INT = 0,
    @ErrorsFound NVARCHAR(MAX) = NULL,
    @ProcessingTime INT = NULL,
    @IPAddress NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    INSERT INTO GrammarChecks (
        UserID, SessionToken, OriginalText, CorrectedText, 
        Language, ErrorCount, ErrorsFound, ProcessingTime, IPAddress
    )
    VALUES (
        @UserID, @SessionToken, @OriginalText, @CorrectedText,
        @Language, @ErrorCount, @ErrorsFound, @ProcessingTime, @IPAddress
    );
    
    SELECT SCOPE_IDENTITY() AS CheckID;
END
GO

-- Create cleanup job for expired sessions
IF OBJECT_ID('CleanupExpiredSessions', 'P') IS NOT NULL
    DROP PROCEDURE CleanupExpiredSessions;
GO

CREATE PROCEDURE CleanupExpiredSessions
AS
BEGIN
    SET NOCOUNT ON;
    
    UPDATE UserSessions 
    SET IsActive = 0 
    WHERE ExpiresAt <= GETDATE() AND IsActive = 1;
    
    SELECT @@ROWCOUNT AS CleanedSessions;
END
GO

-- Create view for user statistics
IF OBJECT_ID('UserStats', 'V') IS NOT NULL
    DROP VIEW UserStats;
GO

CREATE VIEW UserStats AS
SELECT 
    u.UserID,
    u.Username,
    u.Email,
    u.IsPremium,
    u.CreatedAt,
    u.LastLoginAt,
    ISNULL(g.TotalChecks, 0) AS TotalGrammarChecks,
    ISNULL(s.ActiveSessions, 0) AS ActiveSessions
FROM Users u
LEFT JOIN (
    SELECT UserID, COUNT(*) AS TotalChecks
    FROM GrammarChecks
    GROUP BY UserID
) g ON u.UserID = g.UserID
LEFT JOIN (
    SELECT UserID, COUNT(*) AS ActiveSessions
    FROM UserSessions
    WHERE IsActive = 1 AND ExpiresAt > GETDATE()
    GROUP BY UserID
) s ON u.UserID = s.UserID
WHERE u.IsActive = 1;
GO

PRINT '🎉 Database setup completed successfully!';
PRINT '';
PRINT 'Tables created:';
PRINT '  ✅ Users';
PRINT '  ✅ UserSessions';
PRINT '  ✅ UsageLimits';
PRINT '  ✅ GrammarChecks';
PRINT '';
PRINT 'Stored procedures created:';
PRINT '  ✅ RegisterUser';
PRINT '  ✅ CheckUsageLimit';
PRINT '  ✅ IncrementUsageCount';
PRINT '  ✅ SaveGrammarCheck';
PRINT '  ✅ CleanupExpiredSessions';
PRINT '';
PRINT 'Views created:';
PRINT '  ✅ UserStats';
PRINT '';
PRINT 'Default users:';
PRINT '  👤 admin/admin123 (Admin)';
PRINT '';
PRINT '🚀 Ready to start the application!';