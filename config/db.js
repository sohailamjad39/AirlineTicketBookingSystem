// config/db.js
const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME,
    options: {
        encrypt: true, // Use if connecting to Azure or using SSL
        trustServerCertificate: true // Use if self-signed cert
    }
};

let pool;

async function connect() {
    try {
        pool = await sql.connect(config);
        console.log('Connected to SQL Server');
    } catch (err) {
        console.error('Database connection failed:', err);
    }
}

function getPool() {
    return pool;
}

module.exports = { connect, getPool };