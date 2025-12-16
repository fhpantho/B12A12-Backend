require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 5000;
const uri = process.env.URI;

const app = express();

//  MIDDLEWARES 
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

//  BASIC ROUTE 
app.get("/", (req, res) => {
  res.send("AssetVerse server is running");
});

//  MONGODB CLIENT 
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("AssetVerseDB");
    const userCollection = db.collection("UserInfo");



    //  GET USER 
    app.get("/user", async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;

        if (email) {
          query.email = email;
        }

        const result = await userCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Failed to fetch users",
        });
      }
    });

    //  VALIDATE USER 
    app.post("/user/validate", async (req, res) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }

        const existingUser = await userCollection.findOne({ email });

        if (existingUser) {
          return res.status(409).send({
            success: false,
            message: "User already exists in database",
          });
        }

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Server error",
        });
      }
    });

    //  CREATE USER 
    app.post("/user", async (req, res) => {
      try {
        let userInfo = req.body;

        if (!userInfo.email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }

        const existingUser = await userCollection.findOne({
          email: userInfo.email,
        });

        if (existingUser) {
          return res.status(409).send({
            success: false,
            message: "User already exists",
          });
        }

        // HR default fields
        if (userInfo.role === "HR") {
          userInfo = {
            ...userInfo,
            subscription: "basic",
            packageLimit: 5,
            currentEmployees: 0,
          };
        }

        const result = await userCollection.insertOne(userInfo);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        // duplicate key error fallback
        if (error.code === 11000) {
          return res.status(409).send({
            success: false,
            message: "User already exists",
          });
        }

        res.status(500).send({
          success: false,
          message: "Server error",
        });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error(" Database connection failed:", error);
  }
}

run().catch(console.dir);

//  START SERVER 
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
