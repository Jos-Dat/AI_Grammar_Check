// complete-login-debug.js - Complete debug of login process
require('dotenv').config();
const sql = require('mssql');
const bcrypt = require('bcrypt');

const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourPassword123',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME || 'GrammarCheckerDB',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
    }
};

async function completeLoginDebug() {
    let pool;
    
    try {
        console.log('🚀 Complete Login Debug Started...\n');
        
        // Step 1: Connect to database
        console.log('1️⃣ Connecting to database...');
        pool = await sql.connect(config);
        console.log('✅ Database connected\n');
        
        // Step 2: Check current admin user
        console.log('2️⃣ Checking current admin user...');
        const currentUser = await pool.request()
            .input('Username', sql.NVarChar(50), 'admin')
            .query(`
                SELECT 
                    UserID, 
                    Username, 
                    PasswordHash, 
                    LEN(PasswordHash) as HashLength,
                    IsActive,
                    IsAdmin,
                    IsPremium,
                    CreatedAt
                FROM Users 
                WHERE Username = @Username
            `);
        
        if (currentUser.recordset.length === 0) {
            console.log('❌ No admin user found');
            console.log('Creating new admin user...\n');
        } else {
            const user = currentUser.recordset[0];
            console.log('Current admin user:');
            console.log('   UserID:', user.UserID);
            console.log('   Username:', user.Username);
            console.log('   Hash Length:', user.HashLength);
            console.log('   Hash Preview:', user.PasswordHash.substring(0, 20) + '...');
            console.log('   Is Active:', user.IsActive);
            console.log('   Is Admin:', user.IsAdmin);
            console.log('   Created:', user.CreatedAt);
        }
        
        // Step 3: Generate fresh password hash
        console.log('\n3️⃣ Generating fresh password hash...');
        const password = 'admin123';
        const freshHash = await bcrypt.hash(password, 12);
        console.log('Fresh hash generated:');
        console.log('   Password:', password);
        console.log('   Hash:', freshHash);
        console.log('   Length:', freshHash.length);
        
        // Step 4: Test hash verification
        console.log('\n4️⃣ Testing hash verification...');
        const isValidFresh = await bcrypt.compare(password, freshHash);
        console.log('Fresh hash verification:', isValidFresh ? '✅ PASS' : '❌ FAIL');
        
        // Step 5: Update/Create admin user with fresh hash
        console.log('\n5️⃣ Updating admin user with fresh hash...');
        
        // Delete existing admin
        await pool.request()
            .query('DELETE FROM UserSessions WHERE UserID IN (SELECT UserID FROM Users WHERE Username = \'admin\')');
        await pool.request()
            .query('DELETE FROM Users WHERE Username = \'admin\'');
        
        // Create new admin
        const insertResult = await pool.request()
            .input('Username', sql.NVarChar(50), 'admin')
            .input('Email', sql.NVarChar(100), 'admin@example.com')
            .input('PasswordHash', sql.NVarChar(255), freshHash)
            .input('FullName', sql.NVarChar(100), 'System Administrator')
            .query(`
                INSERT INTO Users (Username, Email, PasswordHash, FullName, IsAdmin, IsPremium, IsActive, CreatedAt)
                VALUES (@Username, @Email, @PasswordHash, @FullName, 1, 1, 1, GETDATE());
                SELECT SCOPE_IDENTITY() as NewUserID;
            `);
        
        const newUserID = insertResult.recordset[0].NewUserID;
        console.log('✅ New admin user created with ID:', newUserID);
        
        // Step 6: Verify new user in database
        console.log('\n6️⃣ Verifying new user in database...');
        const verifyResult = await pool.request()
            .input('Username', sql.NVarChar(50), 'admin')
            .query(`
                SELECT 
                    UserID, 
                    Username, 
                    PasswordHash, 
                    LEN(PasswordHash) as HashLength,
                    IsActive,
                    IsAdmin,
                    IsPremium
                FROM Users 
                WHERE Username = @Username
            `);
        
        if (verifyResult.recordset.length > 0) {
            const verifiedUser = verifyResult.recordset[0];
            console.log('✅ User verified in database:');
            console.log('   UserID:', verifiedUser.UserID);
            console.log('   Hash Length:', verifiedUser.HashLength);
            console.log('   Is Active:', verifiedUser.IsActive);
            console.log('   Is Admin:', verifiedUser.IsAdmin);
            
            // Step 7: Test password verification with database hash
            console.log('\n7️⃣ Testing password with database hash...');
            const dbHashTest = await bcrypt.compare('admin123', verifiedUser.PasswordHash);
            console.log('Database hash verification:', dbHashTest ? '✅ PASS' : '❌ FAIL');
            
            if (dbHashTest) {
                console.log('\n🎉 SUCCESS! Admin login should work now!');
                console.log('   Username: admin');
                console.log('   Password: admin123');
            } else {
                console.log('\n❌ FAILED! Hash still not working');
                console.log('Stored hash:', verifiedUser.PasswordHash);
                console.log('Generated hash:', freshHash);
            }
        } else {
            console.log('❌ User not found after creation');
        }
        
        // Step 8: Test different password variations
        console.log('\n8️⃣ Testing different password variations...');
        const testPasswords = ['admin123', 'Admin123', 'ADMIN123', 'admin', '123456'];
        
        for (const testPwd of testPasswords) {
            const testResult = await bcrypt.compare(testPwd, freshHash);
            console.log(`   "${testPwd}":`, testResult ? '✅ MATCH' : '❌ NO MATCH');
        }
        
        console.log('\n✅ Debug completed! Try logging in now with admin/admin123');
        
    } catch (error) {
        console.error('\n❌ Debug failed:', error.message);
        console.error('Error details:', error);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

completeLoginDebug();