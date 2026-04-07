import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "postural",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function getUser(email: string, role: string) {
  try {
    const connection = await pool.getConnection();
    const query = "SELECT * FROM users WHERE email = ? AND role = ?";
    const [rows] = await connection.execute(query, [email, role]);
    connection.release();
    
    const users = rows as any[];
    return users.length > 0 ? users[0] : null;
  } catch (error) {
    console.error("Database error:", error);
    throw error;
  }
}

export default pool;
