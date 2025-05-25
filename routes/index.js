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

// Helper Functions...
async function getAirlines(pool) {
  const result = await pool.request().query("SELECT * FROM Airlines");
  return result.recordset;
}

async function getAirports(pool) {
  const result = await pool
    .request()
    .query(
      "SELECT AirportID, Name AS AirportName, Code AS AirportCode, City, CountryID FROM Airports"
    );
  return result.recordset;
}

async function getAllUsers(pool) {
  const result = await pool.request().query(`
      SELECT 
          u.UserID,
          u.FirstName,
          u.LastName,
          u.Email,
          u.PassportNumber,
          u.PhoneNumber,
          u.RegistrationDate,
          ISNULL(b.BookingCount, 0) AS BookingCount
      FROM Users u
      LEFT JOIN (
          SELECT UserID, COUNT(*) AS BookingCount
          FROM Bookings GROUP BY UserID
      ) b ON u.UserID = b.UserID
      ORDER BY u.UserID ASC
  `);
  return result.recordset;
}

// ✅ GET /signup - Show signup form
router.get("/signup", (req, res) => {
  // ✅ If user is already logged in, redirect to dashboard
  const token = req.cookies.token;
  if (token) {
      try {
          const user = verifyToken(token);
          if (user && user.id) {
              return res.redirect("/");
          }
      } catch (err) {
          // Token invalid or expired – allow access to signup
      }
  }

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
    phoneNumber,
  } = req.body;

  if (password !== confirmPassword) {
    return res.render("signup", {
      successMessage: null,
      errorMessage: "Passwords do not match!",
    });
  }

  try {
    const pool = require("../config/db").getPool();

    // Check if email or phone already exists
    const existingUser = await pool
      .request()
      .input("Email", email)
      .input("PhoneNumber", phoneNumber).query(`
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

    setTimeout(() => {
      res.redirect("/login");
    }, 3000);
  } catch (err) {
    console.error("Error during signup:", err.message);
    res.render("signup", {
      successMessage: null,
      errorMessage: "Something went wrong. Please try again.",
    });
  }
});

// ✅ GET /login - Show login form
router.get("/login", (req, res) => {
  // Check if user is already logged in
  const token = req.cookies.token;
  if (token) {
      try {
          const user = verifyToken(token);
          if (user && user.id) {
              return res.redirect("/");
          }
      } catch (err) {
          // Token invalid or expired – allow access to login page
      }
  }

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
    const result = await pool
      .request()
      .input("Email", email)
      .query("SELECT * FROM Users WHERE Email = @Email");

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
    const userResult = await pool
      .request()
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
    const bookingResult = await pool
      .request()
      .input("UserID", sql.Int, req.user.id).query(`
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

    // ✅ Pass all data to dashboard
    res.render("dashboard", {
      user: user, // ✅ This ensures user is available in EJS
      bookings,
      flights: [],
      airports,
      airlines,
      countries,
      toastMessage: null,

      // ✅ Initialize form values
      originCountry: "",
      origin: "",
      destinationCountry: "",
      destination: "",
      date: "",
      airline: "",
      classType: "",
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
      destinationCountry,
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

    const countriesResult = await pool
      .request()
      .query("SELECT * FROM Countries");
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
      classType: classType || "",
    });
  } catch (err) {
    console.error("Error searching flights:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ GET /book - Show available seats for booking
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
              classType: null,
          });
      }

      if (!classType || !["Economy", "Business", "First"].includes(classType)) {
          return res.status(400).send("Invalid class type");
      }

      // Get Flight Info
      const flightResult = await pool
          .request()
          .input("FlightID", sql.Int, parseInt(flightId))
          .query(`
              SELECT 
                  f.FlightID,
                  f.DepartureDateTime,
                  f.ArrivalDateTime,
                  air.Name AS AirlineName,
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
              classType,
          });
      }

      // ✅ Check if flight has already departed
      const now = new Date();
      const departureTime = new Date(flight.DepartureDateTime);

      if (departureTime < now) {
          return res.render("book", {
              user: req.user,
              toastMessage: "❌ You cannot book a flight that has already departed.",
              flight: null,
              seats: [],
              classType,
          });
      }

      // ✅ Get Available Seats of Selected Class
      const seatsResult = await pool
          .request()
          .input("FlightID", sql.Int, parseInt(flightId))
          .input("ClassType", sql.NVarChar, classType)
          .query(`
              SELECT * FROM Seats 
              WHERE FlightID = @FlightID AND ClassType = @ClassType AND IsAvailable = 1
          `);
      const seats = seatsResult.recordset;

      res.render("book", {
          user: req.user,
          toastMessage: null,
          flight,
          seats,
          classType,
      });

  } catch (err) {
      console.error("Error fetching flight:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /confirm-booking - Confirm selected seat booking
router.post("/confirm-booking", ensureAuthenticated, async (req, res) => {
  const { flightId, seatId, classType } = req.body;

  if (!flightId || !seatId || !classType) {
      return res.render("book", {
          user: req.user,
          toastMessage: "Please select a valid flight and seat.",
          flight: null,
          seats: [],
          classType
      });
  }

  try {
      const pool = require("../config/db").getPool();

      // ✅ Check if flight exists and get departure time
      const flightCheck = await pool
          .request()
          .input("FlightID", sql.Int, parseInt(flightId))
          .query(`
              SELECT DepartureDateTime FROM Flights WHERE FlightID = @FlightID
          `);

      const flightData = flightCheck.recordset[0];
      if (!flightData) {
          return res.render("book", {
              user: req.user,
              toastMessage: "❌ Invalid flight ID.",
              flight: null,
              seats: [],
              classType
          });
      }

      const departureTime = new Date(flightData.DepartureDateTime);
      const now = new Date();

      if (departureTime < now) {
          return res.render("book", {
              user: req.user,
              toastMessage: "❌ This flight has already departed.",
              flight: null,
              seats: [],
              classType
          });
      }

      // ✅ Insert into Bookings
      await pool
          .request()
          .input("UserID", sql.Int, req.user.id)
          .input("FlightID", sql.Int, parseInt(flightId))
          .input("SeatID", sql.Int, parseInt(seatId))
          .query(`
              INSERT INTO Bookings (UserID, FlightID, SeatID, Status)
              VALUES (@UserID, @FlightID, @SeatID, 'Confirmed')
          `);

      // ✅ Update seat availability
      await pool
          .request()
          .input("SeatID", sql.Int, parseInt(seatId))
          .query("UPDATE Seats SET IsAvailable = 0 WHERE SeatID = @SeatID");

      // ✅ Render success message with autoRedirect flag
      return res.render("book", {
          user: req.user,
          toastMessage: "✅ Booking confirmed!",
          flight: null,
          seats: [],
          classType,
          autoRedirect: true
      });

  } catch (err) {
      console.error("Booking failed:", err.message);
      return res.status(500).render("book", {
          user: req.user,
          toastMessage: "❌ Error confirming booking",
          flight: null,
          seats: [],
          classType
      });
  }
});

// Admin-style flight scheduling page
// ✅ GET /schedule - Show flight scheduling form
router.get("/schedule", ensureAuthenticated, async (req, res) => {
  try {
    const pool = require("../config/db").getPool();

    // Simulate admin access
    if (req.user.id !== 19) {
      return res.status(403).send("Access Denied");
    }

    // Fetch data for dropdowns
    const airlinesResult = await pool.request().query("SELECT * FROM Airlines");
    const airportsResult = await pool
      .request()
      .query("SELECT AirportID, Name AS AirportName, Code, City FROM Airports");

    res.render("schedule", {
      user: req.user,
      toastMessage: null,
      airlines: airlinesResult.recordset,
      airports: airportsResult.recordset,
    });
  } catch (err) {
    console.error("Error loading schedule page:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /schedule - Add new flight
router.post("/schedule", ensureAuthenticated, async (req, res) => {
  try {
    const pool = require("../config/db").getPool();

    // Simulate admin check
    if (req.user.id !== 19) {
      return res.status(403).send("Access Denied");
    }

    const {
      airlineId,
      departureAirportId,
      arrivalAirportId,
      departureDateTime,
      arrivalDateTime,
      basePrice,
    } = req.body;

    if (
      !airlineId ||
      !departureAirportId ||
      !arrivalAirportId ||
      !departureDateTime ||
      !arrivalDateTime ||
      !basePrice
    ) {
      return res.render("schedule", {
        user: req.user,
        toastMessage: "❌ All fields are required.",
        airlines: await getAirlines(pool),
        airports: await getAirports(pool),
      });
    }

    // Insert new flight
    const flightRequest = pool
      .request()
      .input("AirlineID", sql.Int, parseInt(airlineId))
      .input("DepartureAirportID", sql.Int, parseInt(departureAirportId))
      .input("ArrivalAirportID", sql.Int, parseInt(arrivalAirportId))
      .input("DepartureDateTime", sql.DateTime, new Date(departureDateTime))
      .input("ArrivalDateTime", sql.DateTime, new Date(arrivalDateTime))
      .input("BasePrice", sql.Decimal(10, 2), parseFloat(basePrice));

    await flightRequest.query(`
          INSERT INTO Flights (
              AirlineID, DepartureAirportID, ArrivalAirportID,
              DepartureDateTime, ArrivalDateTime, BasePrice
          ) VALUES (
              @AirlineID, @DepartureAirportID, @ArrivalAirportID,
              @DepartureDateTime, @ArrivalDateTime, @BasePrice
          )
      `);

    // Get last inserted FlightID
    const result = await pool.request().query("SELECT @@IDENTITY AS FlightID");
    const flightId = result.recordset[0].FlightID;

    // ✅ Define seat data (Economy/Business/First)
    const seatData = [
      { seatNumber: "1A", classType: "Economy" },
      { seatNumber: "1B", classType: "Economy" },
      { seatNumber: "1C", classType: "Economy" },
      { seatNumber: "2A", classType: "Business" },
      { seatNumber: "2B", classType: "Business" },
      { seatNumber: "3A", classType: "First" },
      { seatNumber: "3B", classType: "First" },
    ];

    // ✅ Insert seats dynamically with unique parameter names
    let seatQuery = `
          INSERT INTO Seats (FlightID, SeatNumber, ClassType, IsAvailable)
          VALUES 
      `;

    const seatRequest = pool.request();
    seatRequest.input("FlightID", sql.Int, flightId);

    const paramNames = [];

    seatData.forEach((seat, index) => {
      const seatNumParam = `@SeatNumber${index}`;
      const classTypeParam = `@ClassType${index}`;

      seatRequest
        .input(seatNumParam.replace("@", ""), sql.NVarChar, seat.seatNumber)
        .input(classTypeParam.replace("@", ""), sql.NVarChar, seat.classType);

      paramNames.push(`(${flightId}, ${seatNumParam}, ${classTypeParam}, 1)`);
    });

    seatQuery += paramNames.join(", ");

    await seatRequest.query(seatQuery);

    // ✅ Show success message
    res.render("schedule", {
      user: req.user,
      toastMessage: "✅ Flight scheduled successfully!",
      airlines: await getAirlines(pool),
      airports: await getAirports(pool),
    });
  } catch (err) {
    console.error("Error scheduling flight:", err.message);
    res.status(500).render("schedule", {
      user: req.user,
      toastMessage: "❌ Error scheduling flight",
      airlines: [],
      airports: [],
    });
  }
});

// ✅ GET /profile/edit - Show edit profile form
router.get("/profile/edit", ensureAuthenticated, async (req, res) => {
  try {
    const pool = require("../config/db").getPool();

    // Get user data
    const result = await pool
      .request()
      .input("UserID", sql.Int, req.user.id)
      .query("SELECT * FROM Users WHERE UserID = @UserID");
    const user = result.recordset[0];

    if (!user) {
      return res.status(404).send("User not found");
    }

    res.render("edit-profile", {
      user,
      toastMessage: null,
    });
  } catch (err) {
    console.error("Error fetching user:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /profile/edit - Update profile
router.post("/profile/edit", ensureAuthenticated, async (req, res) => {
  const { firstName, lastName, email, passportNumber, phoneNumber } = req.body;

  try {
    const pool = require("../config/db").getPool();

    // Validate input
    if (!firstName || !lastName || !email || !passportNumber || !phoneNumber) {
      return res.render("edit-profile", {
        user: req.user,
        toastMessage: "❌ All fields are required",
      });
    }

    // Update user in DB
    await pool
      .request()
      .input("UserID", sql.Int, req.user.id)
      .input("FirstName", sql.NVarChar, firstName)
      .input("LastName", sql.NVarChar, lastName)
      .input("Email", sql.NVarChar, email)
      .input("PassportNumber", sql.NVarChar, passportNumber)
      .input("PhoneNumber", sql.NVarChar, phoneNumber).query(`
              UPDATE Users SET
                FirstName = @FirstName,
                LastName = @LastName,
                Email = @Email,
                PassportNumber = @PassportNumber,
                PhoneNumber = @PhoneNumber
              WHERE UserID = @UserID
          `);

    // Re-fetch updated user
    const result = await pool
      .request()
      .input("UserID", sql.Int, req.user.id)
      .query("SELECT * FROM Users WHERE UserID = @UserID");
    const updatedUser = result.recordset[0];

    res.render("edit-profile", {
      user: updatedUser,
      toastMessage: "✅ Profile updated successfully!",
    });
  } catch (err) {
    console.error("Profile update failed:", err.message);
    res.render("edit-profile", {
      user: req.user,
      toastMessage: "❌ Failed to update profile",
    });
  }
});

// ✅ GET /bookings - Show all user bookings
router.get("/bookings", ensureAuthenticated, async (req, res) => {
  try {
    const pool = require("../config/db").getPool();
    const { period } = req.query;
    let toastMessage = null;

    // Build date filter based on period
    let dateFilter = "";
    const now = new Date();

    switch (period) {
      case "this-week":
        dateFilter = `AND b.BookingDate >= DATEADD(DAY, -7, GETDATE())`;
        break;
      case "one-month":
        dateFilter = `AND b.BookingDate >= DATEADD(MONTH, -1, GETDATE())`;
        break;
      case "six-months":
        dateFilter = `AND b.BookingDate >= DATEADD(MONTH, -6, GETDATE())`;
        break;
      case "one-year":
        dateFilter = `AND b.BookingDate >= DATEADD(YEAR, -1, GETDATE())`;
        break;
      default:
        dateFilter = ""; // Show all bookings
    }

    // Query user's active bookings with flight & airport data
    const query = `
          SELECT 
              b.BookingID,
              b.BookingDate,
              b.Status AS BookingStatus,
              f.FlightID,
              f.DepartureDateTime,
              f.ArrivalDateTime,
              air.Name AS AirlineName,
              air.Code AS AirlineCode,
              dep.Name AS DepartureAirport,
              arr.Name AS ArrivalAirport,
              dep.City AS DepartureCity,
              arr.City AS ArrivalCity,
              s.SeatNumber,
              p.Amount
          FROM Bookings b
          JOIN Flights f ON b.FlightID = f.FlightID
          JOIN Airlines air ON f.AirlineID = air.AirlineID
          JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
          JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
          JOIN Seats s ON b.SeatID = s.SeatID
          LEFT JOIN Payments p ON b.BookingID = p.BookingID
          WHERE b.UserID = @UserID ${dateFilter}
          ORDER BY b.BookingDate DESC
      `;

    const result = await pool
      .request()
      .input("UserID", sql.Int, req.user.id)
      .query(query);

    const bookings = result.recordset;

    if (!bookings || bookings.length === 0) {
      toastMessage = "No bookings found.";
    }

    res.render("bookings", {
      user: req.user,
      bookings,
      toastMessage,
      selectedPeriod: period || "all",
    });
  } catch (err) {
    console.error("Error fetching bookings:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /cancel-booking - Cancel booking if allowed
router.post("/cancel-booking", ensureAuthenticated, async (req, res) => {
  const { bookingId } = req.body;

  try {
    const pool = require("../config/db").getPool();

    // Get booking info
    const bookingResult = await pool
      .request()
      .input("BookingID", sql.Int, parseInt(bookingId))
      .input("UserID", sql.Int, req.user.id).query(`
              SELECT b.BookingID, f.DepartureDateTime
              FROM Bookings b
              JOIN Flights f ON b.FlightID = f.FlightID
              WHERE b.BookingID = @BookingID AND b.UserID = @UserID
          `);

    const booking = bookingResult.recordset[0];
    if (!booking) {
      return res.redirect("/bookings?toastMessage=Invalid+booking+ID.");
    }

    const departureTime = new Date(booking.DepartureDateTime);
    const now = new Date();
    const twentyFourHoursBefore = new Date(
      departureTime.getTime() - 24 * 60 * 60 * 1000
    );

    // Check if within 24 hours
    if (now > twentyFourHoursBefore) {
      return res.redirect(
        "/bookings?toastMessage=Cannot+cancel+within+24h+of+departure."
      );
    }

    // Cancel booking
    await pool
      .request()
      .input("BookingID", sql.Int, parseInt(bookingId))
      .query(
        "UPDATE Bookings SET Status = 'Cancelled' WHERE BookingID = @BookingID"
      );

    // Make seat available again
    await pool.request().input("BookingID", sql.Int, parseInt(bookingId))
      .query(`
              UPDATE Seats
              SET IsAvailable = 1
              FROM Bookings b
              JOIN Seats s ON b.SeatID = s.SeatID
              WHERE b.BookingID = @BookingID;
          `);

    res.redirect("/bookings");
  } catch (err) {
    console.error("Cancellation failed:", err.message);
    res.redirect("/bookings?toastMessage=Failed+to+cancel+booking");
  }
});

// ✅ GET /change-password - Show change password form
router.get("/change-password", ensureAuthenticated, (req, res) => {
  res.render("change-password", {
    user: req.user,
    toastMessage: null,
  });
});

// ✅ GET /change-password - Show change password form
router.get("/change-password", ensureAuthenticated, (req, res) => {
  res.render("change-password", {
    user: req.user,
    toastMessage: null,
  });
});

// ✅ POST /change-password - Handle password change
router.post("/change-password", ensureAuthenticated, async (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;

  // Validate inputs
  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return res.render("change-password", {
      user: req.user,
      toastMessage: "❌ All fields are required.",
    });
  }

  if (newPassword !== confirmNewPassword) {
    return res.render("change-password", {
      user: req.user,
      toastMessage: "❌ New passwords do not match.",
    });
  }

  try {
    const pool = require("../config/db").getPool();

    // Get current user
    const result = await pool
      .request()
      .input("UserID", sql.Int, req.user.id)
      .query("SELECT * FROM Users WHERE UserID = @UserID");
    const user = result.recordset[0];

    // Check current password
    if (user.Password !== currentPassword) {
      return res.render("change-password", {
        user: req.user,
        toastMessage: "❌ Current password is incorrect.",
      });
    }

    // Update password
    await pool
      .request()
      .input("UserID", sql.Int, req.user.id)
      .input("NewPassword", sql.NVarChar, newPassword)
      .query("UPDATE Users SET Password = @NewPassword WHERE UserID = @UserID");

    // Success message
    res.render("change-password", {
      user: req.user,
      toastMessage: "✅ Password changed successfully!",
    });
  } catch (err) {
    console.error("Change password failed:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ GET /payments - Show user's payment history and cancellations
router.get("/payments", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();

      // Get user's bookings with flight info
      const result = await pool.request()
          .input("UserID", sql.Int, req.user.id)
          .query(`
              SELECT 
                  b.BookingID,
                  f.FlightID,
                  f.DepartureDateTime,
                  f.ArrivalDateTime,
                  air.Name AS AirlineName,
                  air.Code AS AirlineCode,
                  dep.City AS DepartureCity,
                  arr.City AS ArrivalCity,
                  dep.Name AS DepartureAirport,
                  arr.Name AS ArrivalAirport,
                  s.SeatNumber,
                  s.ClassType,
                  b.Status AS BookingStatus,
                  f.BasePrice,
                  CASE s.ClassType
                      WHEN 'Economy' THEN f.BasePrice
                      WHEN 'Business' THEN f.BasePrice + 5000
                      WHEN 'First' THEN f.BasePrice + 10000
                      ELSE f.BasePrice
                  END AS TotalPrice
              FROM Bookings b
              JOIN Flights f ON b.FlightID = f.FlightID
              JOIN Airlines air ON f.AirlineID = air.AirlineID
              JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
              JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
              JOIN Seats s ON b.SeatID = s.SeatID
              WHERE b.UserID = @UserID
              ORDER BY b.BookingDate DESC
          `);

      const payments = result.recordset;

      if (!payments || payments.length === 0) {
          return res.render("payments", {
              user: req.user,
              payments: [],
              toastMessage: "No payment records found.",
          });
      }

      res.render("payments", {
          user: req.user,
          payments,
          toastMessage: null,
      });

  } catch (err) {
      console.error("Error fetching user payments:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /cancel-payment-booking - Cancel booking if allowed
router.post(
  "/cancel-payment-booking",
  ensureAuthenticated,
  async (req, res) => {
    const { bookingId } = req.body;

    try {
      const pool = require("../config/db").getPool();

      // Get booking with departure time
      const bookingResult = await pool
        .request()
        .input("BookingID", sql.Int, parseInt(bookingId))
        .input("UserID", sql.Int, req.user.id).query(`
              SELECT 
                  b.BookingID,
                  f.DepartureDateTime
              FROM Bookings b
              JOIN Flights f ON b.FlightID = f.FlightID
              WHERE b.BookingID = @BookingID AND b.UserID = @UserID
          `);

      const booking = bookingResult.recordset[0];
      if (!booking) {
        return res.redirect("/payments?toastMessage=Invalid+booking+ID.");
      }

      const departureTime = new Date(booking.DepartureDateTime);
      const twentyFourHoursBefore = new Date(
        departureTime.getTime() - 24 * 60 * 60 * 1000
      );
      const now = new Date();

      if (now > twentyFourHoursBefore) {
        return res.redirect(
          "/payments?toastMessage=Cannot+cancel+within+24h+of+departure."
        );
      }

      // Update booking status
      await pool
        .request()
        .input("BookingID", sql.Int, parseInt(bookingId))
        .query(
          "UPDATE Bookings SET Status = 'Cancelled' WHERE BookingID = @BookingID"
        );

      // Make seat available again
      await pool.request().input("BookingID", sql.Int, parseInt(bookingId))
        .query(`
              UPDATE Seats
              SET IsAvailable = 1
              FROM Bookings b
              JOIN Seats s ON b.SeatID = s.SeatID
              WHERE b.BookingID = @BookingID;
          `);

      res.redirect("/payments");
    } catch (err) {
      console.error("Cancellation failed:", err.message);
      res.redirect("/payments?toastMessage=Failed+to+cancel+booking");
    }
  }
);

// ✅ GET /seat-management - Admin-style seat management
router.get("/seat-management", ensureAuthenticated, async (req, res) => {
  try {
    const pool = require("../config/db").getPool();

    // Simulate admin check
    if (req.user.id !== 19) {
      return res.status(403).send("Access Denied");
    }

    const { flightId } = req.query;
    let toastMessage = null;

    // ✅ Get flights with airline & airport names
    const flightsResult = await pool.request().query(`
          SELECT 
              f.FlightID,
              air.Name AS AirlineName,
              dep.Name AS DepartureAirport,
              arr.Name AS ArrivalAirport,
              f.DepartureDateTime
          FROM Flights f
          JOIN Airlines air ON f.AirlineID = air.AirlineID
          JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
          JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
          ORDER BY f.DepartureDateTime ASC
      `);
    const flights = flightsResult.recordset;

    let selectedFlight = null;
    let seats = [];

    // If flightId provided, get its seats + flight info
    if (flightId && !isNaN(parseInt(flightId))) {
      const flightResult = await pool
        .request()
        .input("FlightID", sql.Int, parseInt(flightId)).query(`
                  SELECT 
                      f.FlightID,
                      air.Name AS AirlineName,
                      dep.Name AS DepartureAirport,
                      arr.Name AS ArrivalAirport,
                      f.DepartureDateTime,
                      f.ArrivalDateTime
                  FROM Flights f
                  JOIN Airlines air ON f.AirlineID = air.AirlineID
                  JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
                  JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
                  WHERE f.FlightID = @FlightID
              `);

      selectedFlight = flightResult.recordset[0];

      if (!selectedFlight) {
        toastMessage = "❌ Invalid flight ID.";
      } else {
        // Get seats for this flight
        const seatsResult = await pool
          .request()
          .input("FlightID", sql.Int, parseInt(flightId))
          .query("SELECT * FROM Seats WHERE FlightID = @FlightID");
        seats = seatsResult.recordset;
      }
    }

    // ✅ Render template with correct variables
    res.render("seat-management", {
      user: req.user,
      flights,
      seats,
      toastMessage,
      flightId: flightId || "",
      flightData: selectedFlight || null,
    });
  } catch (err) {
    console.error("Error fetching seat data:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /update-seat - Update seat availability
router.post("/update-seat", ensureAuthenticated, async (req, res) => {
  const { seatId, isAvailable } = req.body;

  if (
    !seatId ||
    isNaN(parseInt(seatId)) ||
    ![0, 1].includes(parseInt(isAvailable))
  ) {
    return res.redirect("/seat-management");
  }

  try {
    const pool = require("../config/db").getPool();

    // Update seat availability
    await pool
      .request()
      .input("SeatID", sql.Int, parseInt(seatId))
      .input("IsAvailable", sql.Bit, parseInt(isAvailable))
      .query(
        "UPDATE Seats SET IsAvailable = @IsAvailable WHERE SeatID = @SeatID"
      );

    const seatResult = await pool
      .request()
      .input("SeatID", sql.Int, parseInt(seatId))
      .query("SELECT FlightID FROM Seats WHERE SeatID = @SeatID");
    const flightId = seatResult.recordset[0]?.FlightID || "";

    res.redirect(`/seat-management?flightId=${flightId}`);
  } catch (err) {
    console.error("Error updating seat:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ GET /reporting - Reporting & Analytics Page
router.get("/reporting", ensureAuthenticated, async (req, res) => {
  try {
    const pool = require("../config/db").getPool();

    // Simulate admin check
    if (req.user.id !== 19) {
      // Assume user ID 1 is admin
      return res.status(403).send("Access Denied");
    }

    // 📊 Report 1: Top Routes by Number of Bookings
    const topRoutesResult = await pool.request().query(`
          SELECT TOP 5
              dep.Name AS DepartureAirport,
              arr.Name AS ArrivalAirport,
              COUNT(b.BookingID) AS BookingCount
          FROM Bookings b
          JOIN Flights f ON b.FlightID = f.FlightID
          JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
          JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
          GROUP BY dep.Name, arr.Name
          ORDER BY BookingCount DESC
      `);
    const topRoutes = topRoutesResult.recordset;

    // 💵 Report 2: Revenue by Airline
    const revenueByAirlineResult = await pool.request().query(`
          SELECT 
              air.Name AS AirlineName,
              SUM(p.Amount) AS TotalRevenue
          FROM Payments p
          JOIN Bookings b ON p.BookingID = b.BookingID
          JOIN Flights f ON b.FlightID = f.FlightID
          JOIN Airlines air ON f.AirlineID = air.AirlineID
          WHERE p.Status = 'Paid'
          GROUP BY air.Name
          ORDER BY TotalRevenue DESC
      `);
    const revenueByAirline = revenueByAirlineResult.recordset;

    // 📅 Report 3: Flights Per Month
    const flightsPerMonthResult = await pool.request().query(`
          SELECT 
              FORMAT(DepartureDateTime, 'yyyy-MM') AS Month,
              COUNT(*) AS FlightCount
          FROM Flights
          GROUP BY FORMAT(DepartureDateTime, 'yyyy-MM')
          ORDER BY Month ASC
      `);
    const flightsPerMonth = flightsPerMonthResult.recordset;

    // 🚫 Report 4: Total Cancellations
    const cancellationsResult = await pool.request().query(`
          SELECT 
              COUNT(*) AS TotalCancellations
          FROM Cancellations
      `);
    const totalCancellations =
      cancellationsResult.recordset[0]?.TotalCancellations || 0;

    // ✅ Render reporting page
    res.render("reporting", {
      user: req.user,
      topRoutes,
      revenueByAirline,
      flightsPerMonth,
      totalCancellations,
      toastMessage: null,
    });
  } catch (err) {
    console.error("Error fetching report data:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ GET /admin/users - Show all users (Admin Only)
router.get("/admin/users", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();

      // Ensure user is admin
      if (req.user.id !== 19) {
          return res.status(403).send("Access Denied");
      }

      // Get all users with booking count
      const result = await pool.request().query(`
          SELECT 
              u.UserID,
              u.FirstName,
              u.LastName,
              u.Email,
              u.PassportNumber,
              u.PhoneNumber,
              ISNULL(b.BookingCount, 0) AS BookingCount
          FROM Users u
          LEFT JOIN (
              SELECT UserID, COUNT(*) AS BookingCount
              FROM Bookings GROUP BY UserID
          ) b ON u.UserID = b.UserID
          ORDER BY u.UserID ASC
      `);

      const users = result.recordset;

      // ✅ Pass req.user as adminUser to EJS template
      res.render("admin-users", {
          adminUser: req.user, // ✅ This fixes the ReferenceError
          users,
          toastMessage: null
      });

  } catch (err) {
      console.error("Error fetching users:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ POST /admin/users/cancel-bookings - Cancel all bookings of a user
router.post("/admin/users/cancel-bookings", ensureAuthenticated, async (req, res) => {
  const { userId } = req.body;

  try {
      const pool = require("../config/db").getPool();

      if (req.user.id !== 19 || !userId || isNaN(parseInt(userId))) {
          return res.redirect("/admin/users");
      }

      // Get user's confirmed bookings
      const bookingResult = await pool
          .request()
          .input("UserID", sql.Int, parseInt(userId))
          .query(`
              SELECT b.BookingID, s.SeatID
              FROM Bookings b
              JOIN Seats s ON b.SeatID = s.SeatID
              WHERE b.UserID = @UserID AND b.Status = 'Confirmed'
          `);

      const bookings = bookingResult.recordset;

      if (!bookings.length) {
          return res.render("admin-users", {
              user: req.user,
              users: [],
              toastMessage: "No active bookings found for this user."
          });
      }

      // Update seat availability
      for (const booking of bookings) {
          await pool.request()
              .input("SeatID", sql.Int, booking.SeatID)
              .query("UPDATE Seats SET IsAvailable = 1 WHERE SeatID = @SeatID");

          // Mark booking as cancelled
          await pool.request()
              .input("BookingID", sql.Int, booking.BookingID)
              .query("UPDATE Bookings SET Status = 'Cancelled' WHERE BookingID = @BookingID");
      }

      // Success message
      res.render("admin-users", {
          user: req.user,
          users: await getAllUsers(pool),
          toastMessage: "✅ All confirmed bookings cancelled for user ID " + userId
      });

  } catch (err) {
      console.error("Cancellation failed:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ GET /admin/user/:id/details - View user details (Admin-only)
router.get("/admin/user/:id/details", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();

      // Ensure user is admin
      if (req.user.id !== 19) {
          return res.status(403).send("Access Denied");
      }

      const userId = parseInt(req.params.id);

      // Get user info
      const userResult = await pool
          .request()
          .input("UserID", sql.Int, userId)
          .query("SELECT * FROM Users WHERE UserID = @UserID");

      const userDetails = userResult.recordset[0];

      if (!userDetails) {
          return res.render("admin-user-details", {
              adminUser: req.user,
              userDetails: null,
              bookings: [],
              toastMessage: "❌ User not found."
          });
      }

      // Get user's bookings
      const bookingResult = await pool
          .request()
          .input("UserID", sql.Int, userId)
          .query(`
              SELECT 
                  b.BookingID,
                  f.FlightID,
                  air.Code AS AirlineCode,
                  dep.Name AS DepartureAirport,
                  arr.Name AS ArrivalAirport,
                  f.DepartureDateTime,
                  f.ArrivalDateTime,
                  s.SeatNumber,
                  b.Status AS BookingStatus
              FROM Bookings b
              JOIN Flights f ON b.FlightID = f.FlightID
              JOIN Airlines air ON f.AirlineID = air.AirlineID
              JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
              JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
              JOIN Seats s ON b.SeatID = s.SeatID
              WHERE b.UserID = @UserID
              ORDER BY f.DepartureDateTime DESC
          `);

      const bookings = bookingResult.recordset;

      // Render page
      res.render("admin-user-details", {
          adminUser: req.user,
          userDetails,
          bookings,
          toastMessage: null
      });

  } catch (err) {
      console.error("Error fetching user details:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

// ✅ GET /admin/payments - View all payments (Admin Only)
router.get("/admin/payments", ensureAuthenticated, async (req, res) => {
  try {
      const pool = require("../config/db").getPool();

      // Simulate admin check – change 1 to match your actual admin ID
      if (req.user.id !== 19) {
          return res.status(403).send("Access Denied");
      }

      // Get all payments with user and flight info
      const result = await pool.request().query(`
          SELECT 
              p.PaymentID,
              u.FirstName AS UserName,
              u.LastName,
              f.FlightID,
              air.Code AS AirlineCode,
              dep.Name AS DepartureAirport,
              arr.Name AS ArrivalAirport,
              f.DepartureDateTime,
              f.ArrivalDateTime,
              p.Amount,
              p.Status AS PaymentStatus,
              b.Status AS BookingStatus
          FROM Payments p
          JOIN Bookings b ON p.BookingID = b.BookingID
          JOIN Users u ON b.UserID = u.UserID
          JOIN Flights f ON b.FlightID = f.FlightID
          JOIN Airlines air ON f.AirlineID = air.AirlineID
          JOIN Airports dep ON f.DepartureAirportID = dep.AirportID
          JOIN Airports arr ON f.ArrivalAirportID = arr.AirportID
          ORDER BY p.PaymentDate DESC
      `);

      const payments = result.recordset;

      res.render("admin-payments", {
          user: req.user,
          payments,
          toastMessage: null
      });

  } catch (err) {
      console.error("Error fetching admin payments:", err.message);
      res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
