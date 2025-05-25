
# ✈️ Airline Ticket Booking System

A simple **Airline Ticket Booking System** built using **Node.js**, **Express.js**, **EJS**, and **Microsoft SQL Server**. This project enables users to book airline tickets, manage bookings, handle payments, and perform admin-level user management.

---

## 📁 Project Structure

```
AirlineTicketBookingSystem/
│
├── config/
│   ├── db.js            # SQL Server connection
│   └── auth.js          # Token-based authentication
│
├── routes/
│   └── index.js         # All route definitions
│
├── public/
│   └── stylesheets/     # CSS files for views
│
├── views/
│   ├── dashboard.ejs
│   ├── book.ejs
│   ├── payments.ejs
│   ├── signup.ejs
│   ├── login.ejs
│   ├── admin-users.ejs
│   └── admin-user-details.ejs
│
├── README.md            # Project documentation
└── package.json         # Project metadata and dependencies
```

---

## 🚀 Features

- ✅ User Signup/Login with token-based authentication
- ✅ Book airline tickets
- ✅ View bookings and make payments
- ✅ Admin dashboard to manage users
- ✅ Clean and responsive UI using EJS templates and CSS

---

## 🛠️ Technologies Used

- **Backend**: Node.js, Express.js
- **Frontend**: EJS, HTML, CSS
- **Database**: Microsoft SQL Server
- **Authentication**: Token-based (likely using JWT)

---

## 📦 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sohailamjad39/AirlineTicketBookingSystem.git
   cd AirlineTicketBookingSystem
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up the database:**
   - Make sure SQL Server is running.
   - Configure the connection in `config/db.js`.

4. **Run the server:**
   ```bash
   node app.js or npx nodemon app.js
   ```

5. **Open in browser:**
   ```
   http://localhost:"Your Port Number"
   ```

---

## 🔐 Authentication

- Token-based authentication is implemented in `config/auth.js`.
- Login credentials generate a token used for accessing secure routes.

---


## 📂 Future Improvements

- Add flight search filters
- Implement real-time seat availability
- Email confirmations and booking receipts
- Enhanced UI with Bootstrap or TailwindCSS

---

## 📃 License

This project is open-source and available under the [MIT License](LICENSE).

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss your ideas.

---

## 📫 Contact

For questions or suggestions, feel free to reach out at `sohailamjad39sgd@gmail.com`.
