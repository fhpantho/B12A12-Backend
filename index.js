require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 5000;
const uri = process.env.URI;

const app = express();

/* MIDDLEWARES */
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

/* BASIC ROUTE */
app.get("/", (req, res) => {
  res.send("AssetVerse server is running");
});

/* MONGODB CLIENT */
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
    const assetCollection = db.collection("assetCollection")

    console.log("✅ MongoDB connected successfully");

    /*GET USER (by email optional)*/
    app.get("/user", async (req, res) => {
      try {
        const { email } = req.query;
        const query = email ? { email } : {};

        const users = await userCollection.find(query).toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Failed to fetch users",
        });
      }
    });

    // get asset by Email 
    

    /*  VALIDATE USER */
    app.post("/user/validate", async (req, res) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }

        const user = await userCollection.findOne({ email });

        if (user) {
          return res.status(409).send({
            success: false,
            message: "User already exists",
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

    /* CREATE USER*/
    app.post("/user", async (req, res) => {
      try {
        const {
          name,
          email,
          role,
          companyName,
          companyLogo,
          photo,
          dateOfBirth,
        } = req.body;

        if (!email || !role) {
          return res.status(400).send({
            success: false,
            message: "Email and role are required",
          });
        }

        const existingUser = await userCollection.findOne({ email });
        if (existingUser) {
          return res.status(409).send({
            success: false,
            message: "User already exists",
          });
        }

        const normalizedRole = role.toUpperCase();

        // Base allowed fields
        let userInfo = {
          name,
          email,
          role: normalizedRole,
          dateOfBirth,
          createdAt: new Date(),
        };

        

        // HR DEFAULT FIELDS
        if (normalizedRole === "HR") {
          userInfo = {
            ...userInfo,
            companyName,
            companyLogo,
            subscription: "basic",
            packageLimit: 5,
            currentEmployees: 0,
          }
        ;
        }

        // CHECKING IS THE USER IS EMPLOY
        else if(normalizedRole === "EMPLOYEE")
        {
          userInfo = {
            ...userInfo,
            photo,
          }
        }

        const result = await userCollection.insertOne(userInfo);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
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

   // ADD NEW ASSET (POST) - SECURED FOR HR ONLY
app.post("/assetcollection", async (req, res) => {
  try {
    const {
      productName,
      productImage,
      productType,
      productQuantity,
      hrEmail,        
      companyName,
    } = req.body;

    // Basic field validation
    if (!productName || !productImage || !productType || !productQuantity || !hrEmail || !companyName) {
      return res.status(400).send({
        success: false,
        message: "All fields are required",
      });
    }

    if (!["Returnable", "Non-returnable"].includes(productType)) {
      return res.status(400).send({
        success: false,
        message: "Product type must be 'Returnable' or 'Non-returnable'",
      });
    }

    //  SECURITY CHECK: Verify the user is a real HR 
    const user = await userCollection.findOne({ 
      email: hrEmail,
      role: "HR" 
    });

    if (!user) {
      return res.status(403).send({
        success: false,
        message: "Unauthorized: Only verified HR users can add assets",
      });
    }

    // verify company name matches
    if (user.companyName !== companyName) {
      return res.status(403).send({
        success: false,
        message: "Unauthorized: Company name does not match your account",
      });
    }

    //  All checks passed - Add the asset 
    const newAsset = {
      productName,
      productImage,
      productType,
      productQuantity: Number(productQuantity),
      availableQuantity: Number(productQuantity),
      dateAdded: new Date(),
      hrEmail,
      companyName,
    };

    const result = await assetCollection.insertOne(newAsset);

    res.status(201).send({
      success: true,
      message: "Asset added successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Error adding asset:", error);
    res.status(500).send({
      success: false,
      message: "Failed to add asset",
    });
  }
});

// Get all the asset 
  app.get("/assetcollection", async(req, res) => {
    try{

      const result = await assetCollection.find().toArray();
      res.send(result)

    }
    catch(error){

      res.status(500).send("Failed to collect all assets");


    }
    
  })

    // MongoDB ping
    await client.db("admin").command({ ping: 1 });
  } catch (error) {
    console.error(" Database connection failed:", error);
  }
}

run().catch(console.dir);

/* START SERVER */
app.listen(port, () => {
  console.log(` Server running on port ${port}`);
});
