// routes/index.js
const express = require("express");
const router = express.Router();
const sql = require("../config/db");
const { generateToken, verifyToken } = require("../config/auth");

// Signup Page (GET)
router.get("/signup", (req, res) => {
  res.render("signup", {
    successMessage: null,
    errorMessage: null,
  });
});

// Handle Signup Form (POST)
// routes/index.js
router.post("/signup", async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    confirmPassword,
    passportNumber,
    phoneNumber,
  } = req.body;

  try {
    const pool = require("../config/db").getPool();

    // Password match validation
    if (password !== confirmPassword) {
      return res.render("signup", {
        successMessage: null,
        errorMessage: "Passwords do not match!",
      });
    }

    // Check if email or phone already exists
    const existingUser = await pool
      .request()
      .input("Email", email)
      .input("PhoneNumber", phoneNumber).query(`
                SELECT * FROM Users WHERE Email = @Email OR PhoneNumber = @PhoneNumber
            `);

    if (existingUser.recordset.length > 0) {
      return res.render("signup", {
        successMessage: null,
        errorMessage: "A user with that email or phone number already exists.",
      });
    }

    // Insert new user
    await pool
      .request()
      .input("FirstName", firstName)
      .input("LastName", lastName)
      .input("Email", email)
      .input("Password", password)
      .input("PassportNumber", passportNumber)
      .input("PhoneNumber", phoneNumber).query(`
                INSERT INTO Users 
                  (FirstName, LastName, Email, Password, PassportNumber, PhoneNumber)
                VALUES 
                  (@FirstName, @LastName, @Email, @Password, @PassportNumber, @PhoneNumber)
            `);

    res.render("signup", {
      successMessage: "✅ Registration successful! Redirecting to login...",
      errorMessage: null,
    });
  } catch (err) {
    console.error("Error during signup:", err);

    // Handle unique constraint violation manually
    if (
      err.message.includes("UQ_Email") ||
      err.message.includes("UQ_PhoneNumber")
    ) {
      return res.render("signup", {
        successMessage: null,
        errorMessage: "A user with that email or phone number already exists.",
      });
    }

    // General error fallback
    res.render("signup", {
      successMessage: null,
      errorMessage:
        "Passwords do not match! Or, Something went wrong. Please try again.",
    });
  }
});

function ensureAuthenticated(req, res, next) {
  const token = req.cookies.token;

  if (!token) {
    return res.redirect("/login");
  }

  const user = verifyToken(token);

  if (!user) {
    return res.redirect("/login");
  }

  req.user = user;
  next();
}

// Protected Home Route - Dashboard
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const pool = require('../config/db').getPool();

        // Get User Info
        const userResult = await pool.request()
            .input('UserID', req.user.id)
            .query("SELECT * FROM Users WHERE UserID = @UserID");
        const user = userResult.recordset[0];

        // ✅ Get Countries
        const countriesResult = await pool.request().query("SELECT * FROM Countries");
        const countries = countriesResult.recordset;

        // ✅ Get Airlines
        const airlinesResult = await pool.request().query("SELECT * FROM Airlines");
        const airlines = airlinesResult.recordset;

        // ✅ Get Airports + Join with Countries
        const airportsResult = await pool.request().query(`
            SELECT 
                a.AirportID,
                a.Name AS AirportName,
                a.Code AS AirportCode,
                a.City,
                a.CountryID,
                c.Name AS CountryName
            FROM Airports a
            JOIN Countries c ON a.CountryID = c.CountryID
        `);
        const airports = airportsResult.recordset;

        // ✅ Get Recent Bookings
        const bookingResult = await pool.request()
            .input('UserID', req.user.id)
            .query(`
                SELECT 
                    b.BookingID,
                    f.FlightID,
                    f.DepartureDateTime,
                    f.ArrivalDateTime,
                    a1.Name AS DepartureAirport,
                    a2.Name AS ArrivalAirport,
                    s.SeatNumber,
                    p.Amount,
                    b.Status
                FROM Bookings b
                JOIN Flights f ON b.FlightID = f.FlightID
                JOIN Seats s ON b.SeatID = s.SeatID
                JOIN Payments p ON b.BookingID = p.BookingID
                JOIN Airports a1 ON f.DepartureAirportID = a1.AirportID
                JOIN Airports a2 ON f.ArrivalAirportID = a2.AirportID
                WHERE b.UserID = @UserID
                ORDER BY b.BookingDate DESC
            `);
        const bookings = bookingResult.recordset;

        // ✅ Render dashboard with all data
        res.render('index', {
            user,
            bookings,
            flights: [], // Will be populated after search
            airports,
            airlines,
            countries
        });

    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        res.status(500).send('Internal Server Error');
    }
});

// Logout Route
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// Login Page (GET)
router.get("/login", (req, res) => {
  res.render("login", {
    successMessage: null,
    errorMessage: null,
  });
});

router.get('/search', ensureAuthenticated, async (req, res) => {
    const { origin, destination, date, airline, classType } = req.query;
  
    try {
      const pool = require('../config/db').getPool();
  
      let query = `
        SELECT 
          f.FlightID,
          CONCAT(a1.Code, ' - ', a1.Name) AS DepartureCity,
          a1.Code AS DepartureCode,
          CONCAT(a2.Code, ' - ', a2.Name) AS ArrivalCity,
          a2.Code AS ArrivalCode,
          f.DepartureDateTime,
          f.ArrivalDateTime,
          COUNT(s.SeatID) AS AvailableSeats,
          f.BasePrice,
          air.Name AS AirlineName,
          air.Code AS AirlineCode,
          f.FlightID AS FlightNumber
        FROM Flights f
        JOIN Seats s ON f.FlightID = s.FlightID AND s.IsAvailable = 1
        JOIN Airlines air ON f.AirlineID = air.AirlineID
        JOIN Airports a1 ON f.DepartureAirportID = a1.AirportID
        JOIN Airports a2 ON f.ArrivalAirportID = a2.AirportID
        WHERE 1=1
      `;
  
      const params = [];
  
      if (origin) {
        query += ` AND f.DepartureAirportID = @origin`;
        params.push({ name: 'origin', type: sql.Int, value: origin });
      }
  
      if (destination) {
        query += ` AND f.ArrivalAirportID = @destination`;
        params.push({ name: 'destination', type: sql.Int, value: destination });
      }
  
      if (date) {
        const parsedDate = new Date(date);
        query += ` AND CAST(f.DepartureDateTime AS DATE) = @date`;
        params.push({ name: 'date', type: sql.Date, value: parsedDate });
      }
  
      if (airline) {
        query += ` AND f.AirlineID = @airline`;
        params.push({ name: 'airline', type: sql.Int, value: airline });
      }
  
      if (classType) {
        query += ` AND s.ClassType = @classType`;
        params.push({ name: 'classType', value: classType });
      }
  
      query += `
        GROUP BY
          f.FlightID, a1.Name, a1.Code, a2.Name, a2.Code, 
          f.DepartureDateTime, f.ArrivalDateTime, f.BasePrice, air.Name, air.Code, f.FlightID
      `;
  
      const request = pool.request();
      params.forEach(p => request.input(p.name, p.type, p.value));
  
      const result = await request.query(query);
      const flights = result.recordset;
  
      // Also fetch all airports and airlines to populate dropdowns
      const airports = await pool.request().query("SELECT * FROM Airports");
      const airlines = await pool.request().query("SELECT * FROM Airlines");
  
      res.render('index', { user: req.user, flights, airports: airports.recordset, airlines: airlines.recordset });
  
    } catch (err) {
      console.error('Error searching flights:', err);
      res.status(500).send('Internal Server Error');
    }
  });

// Handle Login Form (POST)
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const pool = require("../config/db").getPool();

    const result = await pool.request().input("Email", email).query(`
                SELECT * FROM Users WHERE Email = @Email
            `);

    const user = result.recordset[0];

    if (!user || user.Password !== password) {
      return res.render("login", {
        successMessage: null,
        errorMessage: "Invalid email or password",
      });
    }

    const token = generateToken(user.UserID);

    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60, // 1 hour
    });

    res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = { router, ensureAuthenticated };
