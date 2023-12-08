const express = require("express");
const mysql = require("mysql2/promise"); // Using 'mysql2/promise' for async/await support
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { stat } = require("fs");
const e = require("express");

// Create an Express application
const app = express();
const secret = "AvretSecret"; // this should be a more complex secret

function hashPassword(password, salt) {
  const hash = crypto.createHmac("sha256", salt);
  hash.update(password);
  const hashedPassword = hash.digest("hex");
  return hashedPassword;
}

function newPersonId() {
  const id = crypto.randomBytes(6).toString("hex");
  return id;
}

function authenticateToken(req, res, next) {
  try {
    const token = req.headers.authorization.split(" ")[1].replace(/['"]+/g, "");
    jwt.verify(token, secret);
    next();
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
}

// Middleware setup
app.use(bodyParser.json());
app.use(cors());

// MySQL database configuration
const dbConfig = {
  host: "localhost",
  user: "avretadmin",
  password: "avretpassword1",
  database: "avret",
};

app.post("/avret/login", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const salt = "avret";
    const { user, password } = req.body;
    const hashedpw = hashPassword(password + user, salt);
    const [rows, fields] = await connection.execute(
      "SELECT * FROM users WHERE username2 = ?",
      [hashedpw]
    );
    connection.end();

    if (rows.length === 0) {
      throw new Error("User not found");
    } else {
      const dbhashedpw = rows[0].username2;
      if (dbhashedpw === hashedpw) {
        const payload = { role: rows[0].role, email: rows[0].email };
        const token = jwt.sign(payload, secret, {
          expiresIn: "1d",
        });
        res.json({ token: token, role: rows[0].role });
      } else {
        throw new Error("Wrong Password");
      }
    }
  } catch (error) {
    console.error("Error executing query:", error);
    if (error.message === "Wrong Password") {
      res.status(401).json({ message: "Wrong User or Password" });
    } else if (error.message === "User not found") {
      res.status(401).json({ message: "Wrong User or Password" });
    } else {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

app.use(authenticateToken);

// Define a route to get all users
app.get("/avret/person", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows, fields] = await connection.execute("SELECT * FROM person");
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/avret/patients", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows, fields] = await connection.execute(
      "SELECT person.* FROM person LEFT JOIN therapist ON person.full_name = therapist.full_name WHERE therapist.full_name IS NULL;"
    );
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/avret/user", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const salt = "avret";
    const { user, password, email } = req.body;
    const hashedpw = hashPassword(password + user, salt);
    const role = "role1";
    const personId = newPersonId();
    const [rows, fields] = await connection.execute(
      `INSERT INTO users (username, username2, email, role, userId) VALUES ('${user}', '${hashedpw}', '${email}', '${role}', '${personId}')`
    );
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/avret/therapists", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows, fields] = await connection.execute("SELECT * FROM therapist");
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/avret/evaluation", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const { person_id } = req.query;
    const [rows, fields] = await connection.execute(
      `SELECT * FROM evaluation where person_id = '${person_id}'`
    );
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/avret/recent-evaluation", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const { person_id } = req.query;
    const [rows, fields] = await connection.execute(
      `SELECT * FROM evaluation where person_id = '${person_id}' && eval_date = (SELECT MAX(eval_date) FROM evaluation);`
    );
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/avret/evaluations", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    const [rows, fields] = await connection.execute(`SELECT * FROM evaluation`);
    connection.end();

    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/avret/patient/record", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const evalIdExists = await connection.execute(
      `SELECT * FROM evaluation WHERE eval_id = (SELECT MAX(eval_id) FROM evaluation);`
    );
    const eval_id = evalIdExists[0][0].eval_id + 1;
    const {
      full_name,
      age,
      phone,
      bpm,
      treatment,
      evalDate,
      therapistRecord,
      notes,
    } = req.body;
    if (
      !full_name ||
      !age ||
      !phone ||
      !bpm ||
      !treatment ||
      !evalDate ||
      !therapistRecord ||
      !notes
    ) {
      throw new Error("Missing required fields");
    } else {
      const [exists] = await connection.execute(
        `SELECT * FROM person WHERE phone = '${phone}'`
      );
      if (exists.length === 0 || full_name !== exists[0].full_name) {
        throw new Error("Person does not exist or name does not match");
      } else {
        const person_id = exists[0].person_id;
        const [rows, fields] = await connection.execute(
          `INSERT INTO evaluation (eval_id, full_name, person_id, age, h_bpm, treatments, eval_date, therapist_name, notes) VALUES ('${eval_id}', '${full_name}','${person_id}', ${age}, ${bpm}, '${treatment}', '${evalDate}', '${therapistRecord}', '${notes}')`
        );
        res.json(rows);
        connection.end();
      }
    }
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// Define a route to create a new user
app.post("/avret/person", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const { name, email, phone, birthdate, address, address2, city, zip } =
      req.body;
    const person_id = newPersonId();
    const [exists] = await connection.execute(
      `SELECT * FROM person WHERE person_id = '${person_id}' AND phone = '${phone}'`
    ); // Check if person already exists
    if (exists.length !== 0) {
      throw new Error("Person already exists");
    } else {
      const [rows, fields] = await connection.execute(
        `INSERT INTO person (full_name, person_id, birthdate, email, phone, Address1, Address2, zipcode, city ) VALUES ('${name}', '${person_id}', '${birthdate}','${email}', '${phone}', '${address}', '${address2}', '${zip}', '${city}' );`
      );
      connection.end();
      if (rows.length === 0) {
        throw new Error("Cannot add person");
      } else {
        res.json({
          message: "Person created successfully",
          userId: rows.insertId,
        });
      }
    }
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/avret/authenticate", (req, res) => {
  try {
    const token = req.headers.authorization.split(" ")[1].replace(/['"]+/g, "");

    const decoded = jwt.verify(token, secret);

    const { currentPage } = req.body;
    if (currentPage) {
      if (currentPage === "role1" && decoded.role === ("role0" || "role1")) {
        res.json({ message: "Authentication successful" });
      } else if (currentPage === "role0" && decoded.role === "role0") {
        res.json({ message: "Authentication successful" });
      } else if (currentPage === "role1" && decoded.role === "role1") {
        res.json({ message: "Authentication successful" });
      } else {
        throw new Error("Unauthorized");
      }
    } else {
      throw new Error("Invalid request body");
    }
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
});

// Start the Express server
const port = process.env.PORT || 3003;
app.listen(port, () => {});
