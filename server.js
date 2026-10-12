require("dotenv").config(); 
const express = require("express"); 
const connectDB = require("./config/db.config"); 

const authRoutes = require("./routes/auth.routes"); 
const installationRoutes = require("./routes/installation.routes");
const errorMiddleware = require("./middlewares/error.middleware"); 

const app = express(); 
const PORT = process.env.PORT || 5000; 

// Middleware 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// Database 
connectDB(); 

// Routes 
app.use("/api/auth", authRoutes); 
app.use("/api/install", installationRoutes);

// Health Check 
app.get("/", (req, res) => { return res.status(200).json({ success: true, message: "SpareShare API is running." }); }); 

// Error Middleware 
app.use(errorMiddleware);

// Start Server 
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });