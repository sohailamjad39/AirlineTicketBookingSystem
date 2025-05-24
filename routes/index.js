const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { generateToken, verifyToken } = require("../config/auth");

// Middleware
function ensureAuthenticated(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.redirect("/login");

    try {
        const user = verifyToken(token);
        if (!user || !user.id) return res.redirect("/login");
        req.user = user;
        next();
    } catch (err) {
        res.redirect("/login");
    }
}

// Signup Page (GET)
router.get("/signup", (req, res) => {
    res.render("signup", {
        successMessage: null,
        errorMessage: null
    });
});

// Handle Signup Form (POST)
router.post("/signup", async (req, res) => {
    const {
        firstName,
        lastName,
        email,
        password,
        confirmPassword,
        passportNumber,
        phoneNumber
    } = req.body;

    if (password !== confirmPassword) {
        return res.render("signup", {
            successMessage: null,
            errorMessage: "Passwords do not match!"
        });
    }

    try {
        const pool = require("../config/db").getPool();

        // Check if email or phone already exists
        const existingUser = await pool.request()
            .input("Email", email)
            .input("PhoneNumber", phoneNumber)
            .query(`
                SELECT * FROM Users 
                WHERE Email = @Email OR PhoneNumber = @PhoneNumber
            `);

        if (existingUser.recordset.length > 0) {
            return res.render("signup", {
                successMessage: null,
                errorMessage: "A user with that email or phone number already exists.",
            });
        }

        // Insert new user
        await pool.request()
            .input("FirstName", firstName)
            .input("LastName", lastName)
            .input("Email", email)
            .input("Password", password)
            .input("PassportNumber", passportNumber)
            .input("PhoneNumber", phoneNumber)
            .query(`
                INSERT INTO Users 
                  (FirstName, LastName, Email, Password, PassportNumber, PhoneNumber)
                VALUES 
                  (@FirstName, @LastName, @Email, @Password, @PassportNumber, @PhoneNumber)
            `);

        res.render("signup", {
            successMessage: "✅ Registration successful! Redirecting to login...",
            errorMessage: null
        });

        setTimeout(() => {
            res.redirect("/login");
        }, 3000);

    } catch (err) {
        console.error("Error during signup:", err.message);
        res.render("signup", {
            successMessage: null,
            errorMessage: "Something went wrong. Please try again."
        });
    }
});

// Login Page (GET)
router.get("/login", (req, res) => {
  res.render("login", {
      successMessage: null,
      errorMessage: null
  });
});

// Handle Login Form (POST)
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
      const pool = require("../config/db").getPool();
      const result = await pool.request()
          .input("Email", email)
          .query("SELECT * FROM Users WHERE Email = @Email");

      const user = result.recordset[0];

      if (!user || user.Password !== password) {
          return res.render("login", {
              successMessage: null,
              errorMessage: "Invalid email or password"
          });
      }

      const token = generateToken(user.UserID);
      res.cookie("token", token, {
          httpOnly: true,
          maxAge: 1000 * 60 * 60 // 1 hour
      });

      res.redirect("/");
  } catch (err) {
      console.error("Login error:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// Logout Route
router.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// ✅ / route - Dashboard Home
router.get("/", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();

      // Ensure user is authenticated
      if (!req.user || !req.user.id) {
          return res.status(500).send("User not authenticated or missing ID");
      }

      // Get User Info
      const userResult = await pool.request()
          .input("UserID", sql.Int, req.user.id)
          .query("SELECT * FROM Users WHERE UserID = @UserID");
      const user = userResult.recordset[0];

      // ✈️ Get Countries
      const countriesResult = await pool.request().query("SELECT * FROM Countries");
      const countries = countriesResult.recordset;

      // ✈️ Get Airlines
      const airlinesResult = await pool.request().query("SELECT * FROM Airlines");
      const airlines = airlinesResult.recordset;

      // ✈️ Get Airports + Join with Countries
      const airportsResult = await pool.request().query(`
          SELECT 
              a.AirportID,
              a.Name AS AirportName,
              a.Code AS AirportCode,
              a.City,
              c.CountryID
          FROM Airports a
          JOIN Countries c ON a.CountryID = c.CountryID
      `);
      const airports = airportsResult.recordset;

      // 🎫 Get Recent Bookings
      const bookingResult = await pool.request()
          .input("UserID", sql.Int, req.user.id)
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

      // ✅ Pass empty strings for form fields
      res.render("dashboard", {
          user,
          bookings,
          flights: [],
          airports,
          airlines,
          countries,
          toastMessage: null,

          // ✅ Initialize all form values as empty
          originCountry: "",
          origin: "",
          destinationCountry: "",
          destination: "",
          date: "",
          airline: "",
          classType: ""
      });

  } catch (err) {
      console.error("Error fetching dashboard data:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ /search route - Flight Search
router.get("/search", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();
      const {
          origin,
          destination,
          date,
          airline,
          classType,
          originCountry,
          destinationCountry
      } = req.query;

      let toastMessage = null;

      // Initialize request
      const request = pool.request();

      // Build query dynamically
      let query = `
          SELECT 
              f.FlightID,
              f.DepartureDateTime,
              f.ArrivalDateTime,
              air.Name AS AirlineName,
              air.Code AS AirlineCode,
              a1.Name AS DepartureAirport,
              a2.Name AS ArrivalAirport,
              a1.City AS DepartureCity,
              a2.City AS ArrivalCity,
              COUNT(s.SeatID) AS AvailableSeats,
              f.BasePrice
          FROM Flights f
          JOIN Seats s ON f.FlightID = s.FlightID AND s.IsAvailable = 1
          JOIN Airlines air ON f.AirlineID = air.AirlineID
          JOIN Airports a1 ON f.DepartureAirportID = a1.AirportID
          JOIN Airports a2 ON f.ArrivalAirportID = a2.AirportID
          WHERE 1=1
      `;

      // Safely add filters
      if (origin && !isNaN(parseInt(origin))) {
          query += ` AND f.DepartureAirportID = @origin`;
          request.input("origin", sql.Int, parseInt(origin));
      }

      if (destination && !isNaN(parseInt(destination))) {
          query += ` AND f.ArrivalAirportID = @destination`;
          request.input("destination", sql.Int, parseInt(destination));
      }

      if (date) {
          request.input("date", sql.Date, date);
          query += ` AND CAST(f.DepartureDateTime AS DATE) = @date`;
      }

      if (airline && !isNaN(parseInt(airline))) {
          request.input("airline", sql.Int, parseInt(airline));
          query += ` AND f.AirlineID = @airline`;
      }

      if (classType && ["Economy", "Business", "First"].includes(classType)) {
          request.input("classType", sql.NVarChar, classType);
          query += ` AND s.ClassType = @classType`;
      }

      query += `
          GROUP BY
              f.FlightID,
              f.DepartureDateTime,
              f.ArrivalDateTime,
              air.Name,
              air.Code,
              a1.Name,
              a2.Name,
              a1.City,
              a2.City,
              f.BasePrice
          HAVING COUNT(s.SeatID) > 0
          ORDER BY f.DepartureDateTime ASC
      `;

      const result = await request.query(query);
      const flights = result.recordset;

      if (!flights || flights.length === 0) {
          toastMessage = "No flights found matching your criteria.";
      }

      // Re-fetch dropdown data
      const airportsResult = await pool.request().query(`
          SELECT 
              a.AirportID,
              a.Name AS AirportName,
              a.Code AS AirportCode,
              a.City,
              c.CountryID
          FROM Airports a
          JOIN Countries c ON a.CountryID = c.CountryID
      `);
      const airports = airportsResult.recordset;

      const airlinesResult = await pool.request().query("SELECT * FROM Airlines");
      const airlines = airlinesResult.recordset;

      const countriesResult = await pool.request().query("SELECT * FROM Countries");
      const countries = countriesResult.recordset;

      // ✅ Render dashboard with all input values preserved
      res.render("dashboard", {
          user: req.user,
          flights,
          toastMessage,
          airports,
          airlines,
          countries,

          // ✅ Pass back all input values
          originCountry: originCountry || "",
          origin: origin || "",
          destinationCountry: destinationCountry || "",
          destination: destination || "",
          date: date || "",
          airline: airline || "",
          classType: classType || ""
      });

  } catch (err) {
      console.error("Error searching flights:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ /book route - Book Flight
router.get("/book", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();
      const { flightId, classType } = req.query;

      if (!flightId || isNaN(parseInt(flightId))) {
          return res.render("book", {
              user: req.user,
              toastMessage: "No valid flight selected.",
              flight: null,
              seats: [],
              classType: null
          });
      }

      if (!classType || !["Economy", "Business", "First"].includes(classType)) {
          return res.status(400).send("Invalid class type");
      }

      // Get Flight Info
      const flightResult = await pool.request()
          .input("FlightID", sql.Int, parseInt(flightId))
          .query(`
              SELECT 
                  f.FlightID,
                  f.DepartureDateTime,
                  f.ArrivalDateTime,
                  air.Name AS AirlineName,
                  air.Code AS AirlineCode,
                  dep.Name AS DepartureAirport,
                  arr.Name AS ArrivalAirport,
                  dep.City AS DepartureCity,
                  arr.City AS ArrivalCity,
                  f.BasePrice
              FROM Flights f
              JOIN Airlines air ON f.AirlineID = air.AirlineID
              JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
              JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
              WHERE f.FlightID = @FlightID
          `);
      const flight = flightResult.recordset[0];

      if (!flight) {
          return res.render("book", {
              user: req.user,
              toastMessage: "Invalid flight ID.",
              flight: null,
              seats: [],
              classType
          });
      }

      // Get Available Seats (of selected class)
      const seatsResult = await pool.request()
          .input("FlightID", sql.Int, parseInt(flightId))
          .input("ClassType", sql.NVarChar, classType)
          .query(`
              SELECT * FROM Seats 
              WHERE FlightID = @FlightID AND ClassType = @ClassType AND IsAvailable = 1
          `);
      const seats = seatsResult.recordset;

      // Enhance seats with total price
      let additionalPrice = 0;
      switch (classType) {
          case "Business":
              additionalPrice = 5000;
              break;
          case "First":
              additionalPrice = 10000;
              break;
          default:
              additionalPrice = 0;
      }

      const enhancedSeats = seats.map(seat => ({
          ...seat,
          TotalPrice: flight.BasePrice + additionalPrice
      }));

      res.render("book", {
          user: req.user,
          toastMessage: null,
          flight,
          seats: enhancedSeats,
          classType
      });

  } catch (err) {
      console.error("Error fetching flight:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ /confirm-booking - Confirm selected seat booking
router.post('/confirm-booking', ensureAuthenticated, async (req, res) => {
  const { flightId, seatId, classType } = req.body;

  if (!flightId || !seatId || !classType) {
      return res.render('book', {
          user: req.user,
          toastMessage: 'Please select a valid flight and seat.',
          flight: null,
          seats: [],
          classType: ''
      });
  }

  try {
      const pool = require('../config/db').getPool();

      // Insert into Bookings
      await pool.request()
          .input('UserID', sql.Int, req.user.id)
          .input('FlightID', sql.Int, parseInt(flightId))
          .input('SeatID', sql.Int, parseInt(seatId))
          .query(`
              INSERT INTO Bookings (UserID, FlightID, SeatID, Status)
              VALUES (@UserID, @FlightID, @SeatID, 'Confirmed')
          `);

      // Update seat availability
      await pool.request()
          .input('SeatID', sql.Int, parseInt(seatId))
          .query("UPDATE Seats SET IsAvailable = 0 WHERE SeatID = @SeatID");

      // ✅ Set success message and redirect via client-side JS
      return res.render('book', {
          user: req.user,
          toastMessage: '✅ Booking confirmed!',
          flight: null,
          seats: [],
          classType,
          autoRedirect: true // Add flag for EJS
      });

  } catch (err) {
      console.error('Booking failed:', err.message);
      return res.status(500).render('book', {
          user: req.user,
          toastMessage: '❌ Error confirming booking',
          flight: null,
          seats: [],
          classType
      });
  }
});

module.exports = router;