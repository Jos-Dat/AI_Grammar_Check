-- backend/scripts/setup-database.sql
-- Script để tạo database và tables cho AI Grammar Editor

-- Tạo database nếu chưa tồn tại
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'GrammarCheckerDB')
BEGIN
    CREATE DATABASE GrammarCheckerDB;
    PRINT 'Database GrammarCheckerDB created successfully!';
END
ELSE
BEGIN
    PRINT 'Database GrammarCheckerDB already exists.';
END
GO

USE GrammarCheckerDB;
GO

-- 1. Bảng Users
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
BEGIN
    CREATE TABLE Users (
        UserID INT IDENTITY(1,1) PRIMARY KEY,
        Username NVARCHAR(50) NOT NULL UNIQUE,
        Email NVARCHAR(100) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(255) NOT NULL,
        Phone NVARCHAR(20),
        FullName NVARCHAR(100),
        IsActive BIT DEFAULT 1,
        IsPremium BIT DEFAULT 0,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        UpdatedAt DATETIME2 DEFAULT GETDATE(),
        LastLoginAt DATETIME2,
        EmailVerified BIT DEFAULT 0,
        ProfilePicture NVARCHAR(MAX)
    );
    PRINT 'Table Users created successfully!';
END

-- 2. Bảng UserSessions
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserSessions' AND xtype='U')
BEGIN
    CREATE TABLE UserSessions (
        SessionID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT,
        SessionToken NVARCHAR(255) NOT NULL UNIQUE,
        IPAddress NVARCHAR(45),
        UserAgent NVARCHAR(500),
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        ExpiresAt DATETIME2 NOT NULL,
        IsActive BIT DEFAULT 1,
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
    );
    PRINT 'Table UserSessions created successfully!';
END

-- 3. Bảng GrammarChecks
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='GrammarChecks' AND xtype='U')
BEGIN
    CREATE TABLE GrammarChecks (
        CheckID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NULL,
        SessionToken NVARCHAR(255),
        OriginalText NVARCHAR(MAX) NOT NULL,
        CorrectedText NVARCHAR(MAX),
        Language NVARCHAR(10) NOT NULL,
        ErrorCount INT DEFAULT 0,
        ErrorsFound NVARCHAR(MAX),
        ProcessingTime INT,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        IPAddress NVARCHAR(45),
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE SET NULL
    );
    PRINT 'Table GrammarChecks created successfully!';
END

-- 4. Bảng UsageLimits
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UsageLimits' AND xtype='U')
BEGIN
    CREATE TABLE UsageLimits (
        LimitID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NULL,
        SessionToken NVARCHAR(255),
        IPAddress NVARCHAR(45),
        UsageDate DATE DEFAULT CAST(GETDATE() AS DATE),
        ChecksUsed INT DEFAULT 0,
        MaxChecksAllowed INT DEFAULT 3,
        IsBlocked BIT DEFAULT 0,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        UpdatedAt DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
    );
    PRINT 'Table UsageLimits created successfully!';
END

-- 5. Bảng ErrorTypes
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ErrorTypes' AND xtype='U')
BEGIN
    CREATE TABLE ErrorTypes (
        ErrorTypeID INT IDENTITY(1,1) PRIMARY KEY,
        TypeName NVARCHAR(50) NOT NULL UNIQUE,
        Description NVARCHAR(200),
        CreatedAt DATETIME2 DEFAULT GETDATE()
    );
    PRINT 'Table ErrorTypes created successfully!';
END

-- 6. Bảng UserPreferences
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserPreferences' AND xtype='U')
BEGIN
    CREATE TABLE UserPreferences (
        PreferenceID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        DefaultLanguage NVARCHAR(10) DEFAULT 'en-US',
        AutoCorrect BIT DEFAULT 0,
        ShowAdvancedSuggestions BIT DEFAULT 1,
        EmailNotifications BIT DEFAULT 1,
        Theme NVARCHAR(20) DEFAULT 'light',
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        UpdatedAt DATETIME2 DEFAULT GETDATE(),
        FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE,
        UNIQUE (UserID)
    );
    PRINT 'Table UserPreferences created successfully!';
END

-- 7. Bảng SystemSettings
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SystemSettings' AND xtype='U')
BEGIN
    CREATE TABLE SystemSettings (
        SettingID INT IDENTITY(1,1) PRIMARY KEY,
        SettingKey NVARCHAR(100) NOT NULL UNIQUE,
        SettingValue NVARCHAR(MAX),
        Description NVARCHAR(500),
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        UpdatedAt DATETIME2 DEFAULT GETDATE()
    );
    PRINT 'Table SystemSettings created successfully!';
END

-- Insert dữ liệu mặc định cho ErrorTypes
IF NOT EXISTS (SELECT * FROM ErrorTypes WHERE TypeName = 'grammar')
BEGIN
    INSERT INTO ErrorTypes (TypeName, Description) VALUES
    ('grammar', 'Grammatical errors and syntax issues'),
    ('spelling', 'Spelling mistakes and typos'),
    ('style', 'Writing style and clarity suggestions'),
    ('punctuation', 'Punctuation and formatting issues'),
    ('other', 'Other types of errors');
    PRINT 'Default ErrorTypes inserted successfully!';
END

-- Insert system settings mặc định
IF NOT EXISTS (SELECT * FROM SystemSettings WHERE SettingKey = 'FREE_USAGE_LIMIT')
BEGIN
    INSERT INTO SystemSettings (SettingKey, SettingValue, Description) VALUES
    ('FREE_USAGE_LIMIT', '3', 'Maximum free checks per day for non-premium users'),
    ('SESSION_TIMEOUT', '24', 'Session timeout in hours'),
    ('MAX_TEXT_LENGTH', '10000', 'Maximum text length for grammar check'),
    ('SUPPORTED_LANGUAGES', 'en-US,en-GB,de-DE,fr,es,nl', 'Comma-separated list of supported languages'),
    ('RATE_LIMIT_WINDOW', '60', 'Rate limiting window in seconds'),
    ('RATE_LIMIT_MAX_REQUESTS', '10', 'Maximum requests per rate limit window');
    PRINT 'Default SystemSettings inserted successfully!';
END

-- Tạo các indexes để tối ưu performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_Users_Username' AND object_id = OBJECT_ID('Users'))
BEGIN
    CREATE INDEX IX_Users_Username ON Users(Username);
    CREATE INDEX IX_Users_Email ON Users(Email);
    PRINT 'User indexes created successfully!';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_Sessions_Token' AND object_id = OBJECT_ID('UserSessions'))
BEGIN
    CREATE INDEX IX_Sessions_Token ON UserSessions(SessionToken);
    CREATE INDEX IX_Sessions_UserID ON UserSessions(UserID);
    PRINT 'Session indexes created successfully!';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_GrammarChecks_UserID' AND object_id = OBJECT_ID('GrammarChecks'))
BEGIN
    CREATE INDEX IX_GrammarChecks_UserID ON GrammarChecks(UserID);
    CREATE INDEX IX_GrammarChecks_CreatedAt ON GrammarChecks(CreatedAt);
    CREATE INDEX IX_GrammarChecks_Language ON GrammarChecks(Language);
    PRINT 'GrammarChecks indexes created successfully!';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_UsageLimits_UserID_Date' AND object_id = OBJECT_ID('UsageLimits'))
BEGIN
    CREATE INDEX IX_UsageLimits_UserID_Date ON UsageLimits(UserID, UsageDate);
    CREATE INDEX IX_UsageLimits_Session_Date ON UsageLimits(SessionToken, UsageDate);
    CREATE INDEX IX_UsageLimits_IPAddress_Date ON UsageLimits(IPAddress, UsageDate);
    PRINT 'UsageLimits indexes created successfully!';
END

-- Stored Procedures
-- 1. SP để check usage limit
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'CheckUsageLimit')
    DROP PROCEDURE CheckUsageLimit;
GO

CREATE PROCEDURE CheckUsageLimit
    @UserID INT = NULL,
    @SessionToken NVARCHAR(255) = NULL,
    @IPAddress NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);
    DECLARE @MaxChecks INT = 3;
    DECLARE @CurrentUsage INT = 0;
    DECLARE @CanUse BIT = 0;
    
    -- Check if user is premium
    IF @UserID IS NOT NULL
    BEGIN
        SELECT @MaxChecks = CASE WHEN IsPremium = 1 THEN 999999 ELSE 3 END
        FROM Users WHERE UserID = @UserID AND IsActive = 1;
    END
    
    -- Get current usage
    IF @UserID IS NOT NULL
    BEGIN
        SELECT @CurrentUsage = ISNULL(ChecksUsed, 0)
        FROM UsageLimits
        WHERE UserID = @UserID AND UsageDate = @Today;
    END
    ELSE
    BEGIN
        SELECT @CurrentUsage = ISNULL(ChecksUsed, 0)
        FROM UsageLimits
        WHERE SessionToken = @SessionToken AND UsageDate = @Today;
    END
    
    -- Check if can use
    SET @CanUse = CASE WHEN @CurrentUsage < @MaxChecks THEN 1 ELSE 0 END;
    
    SELECT 
        @CanUse AS CanUse,
        @CurrentUsage AS CurrentUsage,
        @MaxChecks AS MaxAllowed,
        (@MaxChecks - @CurrentUsage) AS Remaining;
END;
GO

-- 2. SP để increment usage count
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'IncrementUsageCount')
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
    DECLARE @MaxChecks INT = 3;
    
    -- Check if user is premium
    IF @UserID IS NOT NULL
    BEGIN
        SELECT @MaxChecks = CASE WHEN IsPremium = 1 THEN 999999 ELSE 3 END
        FROM Users WHERE UserID = @UserID AND IsActive = 1;
    END
    
    -- Insert or update usage
    IF @UserID IS NOT NULL
    BEGIN
        MERGE UsageLimits AS target
        USING (SELECT @UserID AS UserID, @Today AS UsageDate) AS source
        ON target.UserID = source.UserID AND target.UsageDate = source.UsageDate
        WHEN MATCHED THEN
            UPDATE SET ChecksUsed = ChecksUsed + 1, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (UserID, UsageDate, ChecksUsed, MaxChecksAllowed, IPAddress)
            VALUES (@UserID, @Today, 1, @MaxChecks, @IPAddress);
    END
    ELSE
    BEGIN
        MERGE UsageLimits AS target
        USING (SELECT @SessionToken AS SessionToken, @Today AS UsageDate) AS source
        ON target.SessionToken = source.SessionToken AND target.UsageDate = source.UsageDate
        WHEN MATCHED THEN
            UPDATE SET ChecksUsed = ChecksUsed + 1, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (SessionToken, UsageDate, ChecksUsed, MaxChecksAllowed, IPAddress)
            VALUES (@SessionToken, @Today, 1, @MaxChecks, @IPAddress);
    END
END;
GO

-- 3. SP để save grammar check
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'SaveGrammarCheck')
    DROP PROCEDURE SaveGrammarCheck;
GO

CREATE PROCEDURE SaveGrammarCheck
    @UserID INT = NULL,
    @SessionToken NVARCHAR(255) = NULL,
    @OriginalText NVARCHAR(MAX),
    @CorrectedText NVARCHAR(MAX) = NULL,
    @Language NVARCHAR(10),
    @ErrorCount INT = 0,
    @ErrorsFound NVARCHAR(MAX) = NULL,
    @ProcessingTime INT = NULL,
    @IPAddress NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    INSERT INTO GrammarChecks 
    (UserID, SessionToken, OriginalText, CorrectedText, Language, ErrorCount, ErrorsFound, ProcessingTime, IPAddress)
    VALUES 
    (@UserID, @SessionToken, @OriginalText, @CorrectedText, @Language, @ErrorCount, @ErrorsFound, @ProcessingTime, @IPAddress);
    
    SELECT SCOPE_IDENTITY() AS CheckID;
END;
GO

-- 4. SP để register user
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'RegisterUser')
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
        -- Check if username or email already exists
        IF EXISTS (SELECT 1 FROM Users WHERE Username = @Username OR Email = @Email)
        BEGIN
            SELECT 0 AS Success, 'Username or email already exists' AS Message;
            RETURN;
        END
        
        -- Insert new user
        INSERT INTO Users (Username, Email, PasswordHash, Phone, FullName)
        VALUES (@Username, @Email, @PasswordHash, @Phone, @FullName);
        
        DECLARE @NewUserID INT = SCOPE_IDENTITY();
        
        -- Create default preferences
        INSERT INTO UserPreferences (UserID)
        VALUES (@NewUserID);
        
        SELECT 1 AS Success, 'User registered successfully' AS Message, @NewUserID AS UserID;
    END TRY
    BEGIN CATCH
        SELECT 0 AS Success, ERROR_MESSAGE() AS Message;
    END CATCH
END;
GO

PRINT '🎉 Database setup completed successfully!';
PRINT '📊 Created tables: Users, UserSessions, GrammarChecks, UsageLimits, ErrorTypes, UserPreferences, SystemSettings';
PRINT '🔧 Created stored procedures: CheckUsageLimit, IncrementUsageCount, SaveGrammarCheck, RegisterUser';
PRINT '📈 Created indexes for performance optimization';
PRINT '✅ Ready to use!';