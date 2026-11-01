require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function setup() {
  let connection;
  try {
    console.log("Connecting to MySQL...");

    // Step 1: Connect WITHOUT database to create it
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
    });

    console.log("✅ MySQL Connected!");

    // Step 2: Create database if not exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'railconnect'}`);
    console.log(`✅ Database '${process.env.DB_NAME || 'railconnect'}' ready`);

    await connection.end();

    // Step 3: Now connect WITH database and create tables
    const pool = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'railconnect',
      multipleStatements: true
    });

    // Read schema.sql if exists
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
      console.log("✅ Tables created from schema.sql");
    } else {
      console.log("⚠️ schema.sql not found, skipping table creation");
    }

    await pool.end();
    console.log("\n🎉 SETUP COMPLETE! Now run: npm start");

  } catch (err) {
    console.error("\n❌ Setup failed:", err.message);
    console.error("Check DB_USER / DB_PASSWORD in your .env file.");
    if (connection) await connection.end().catch(()=>{});
  }
}

setup();