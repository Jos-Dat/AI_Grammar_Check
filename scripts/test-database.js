// scripts/test-database.js - Test database connection and setup
require('dotenv').config();
const sql = require('mssql');

const config = {
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

async function testDatabase() {
    let pool;
    
    try {
        console.log('🔧 Testing database connection...');
        console.log(`📍 Server: ${config.server}`);
        console.log(`📁 Database: ${config.database}`);
        console.log(`👤 User: ${config.user}`);
        console.log('');

        // Test connection
        pool = await sql.connect(config);
        console.log('✅ Database connection successful!');

        // Test basic query
        const result = await pool.request().query('SELECT @@VERSION as Version');
        console.log('✅ SQL Server Version:', result.recordset[0].Version.split('\n')[0]);

        // Check if database exists
        const dbCheck = await pool.request().query(`
            SELECT name FROM sys.databases WHERE name = '${config.database}'
        `);
        
        if (dbCheck.recordset.length === 0) {
            console.log('⚠️  Database does not exist. Please run setup script first:');
            console.log('   sqlcmd -S localhost -U sa -P YourPassword123 -i setup-database.sql');
            return;
        }
        
        console.log('✅ Database exists');

        // Test tables
        const tablesResult = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            ORDER BY TABLE_NAME
        `);

        const expectedTables = ['Users', 'UserSessions', 'UsageLimits', 'GrammarChecks'];
        const existingTables = tablesResult.recordset.map(r => r.TABLE_NAME);

        console.log('\n📋 Tables check:');
        expectedTables.forEach(table => {
            if (existingTables.includes(table)) {
                console.log(`✅ ${table} - exists`);
            } else {
                console.log(`❌ ${table} - missing`);
            }
        });

        // Test stored procedures
        const proceduresResult = await pool.request().query(`
            SELECT ROUTINE_NAME 
            FROM INFORMATION_SCHEMA.ROUTINES 
            WHERE ROUTINE_TYPE = 'PROCEDURE' 
            ORDER BY ROUTINE_NAME
        `);

        const expectedProcedures = [
            'RegisterUser', 
            'CheckUsageLimit', 
            'IncrementUsageCount', 
            'SaveGrammarCheck', 
            'CleanupExpiredSessions'
        ];
        const existingProcedures = proceduresResult.recordset.map(r => r.ROUTINE_NAME);

        console.log('\n⚙️  Stored procedures check:');
        expectedProcedures.forEach(proc => {
            if (existingProcedures.includes(proc)) {
                console.log(`✅ ${proc} - exists`);
            } else {
                console.log(`❌ ${proc} - missing`);
            }
        });

        // Test users count
        const userCount = await pool.request().query('SELECT COUNT(*) as Count FROM Users');
        console.log(`\n👥 Users in database: ${userCount.recordset[0].Count}`);

        // Test admin user
        const adminUser = await pool.request().query(`
            SELECT Username, IsAdmin, IsPremium 
            FROM Users 
            WHERE Username = 'admin'
        `);

        if (adminUser.recordset.length > 0) {
            console.log('✅ Admin user exists:');
            console.log(`   Username: ${adminUser.recordset[0].Username}`);
            console.log(`   Is Admin: ${adminUser.recordset[0].IsAdmin}`);
            console.log(`   Is Premium: ${adminUser.recordset[0].IsPremium}`);
        } else {
            console.log('⚠️  Admin user not found');
        }

        // Test stored procedure
        console.log('\n🧪 Testing stored procedure...');
        const usageTest = await pool.request()
            .input('UserID', sql.Int, null)
            .input('SessionToken', sql.NVarChar(255), 'test-session')
            .input('IPAddress', sql.NVarChar(45), '127.0.0.1')
            .execute('CheckUsageLimit');

        console.log('✅ CheckUsageLimit procedure works:', usageTest.recordset[0]);

        console.log('\n🎉 All database tests passed!');
        console.log('\n🚀 You can now start the server with: npm start');

    } catch (error) {
        console.error('\n❌ Database test failed:', error.message);
        console.log('\n🔧 Troubleshooting steps:');
        console.log('1. Make sure SQL Server is running');
        console.log('2. Check your connection credentials in .env file');
        console.log('3. Verify SQL Server allows SQL Server Authentication');
        console.log('4. Run the database setup script:');
        console.log('   sqlcmd -S localhost -U sa -P YourPassword123 -i setup-database.sql');
        console.log('5. Check firewall settings allow connections to SQL Server');
        
        process.exit(1);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

// Run test
testDatabase();