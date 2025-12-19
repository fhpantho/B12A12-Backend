require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

  const { ObjectId } = require("mongodb");

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
    const requestCollection = db.collection("requestCollection");

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
    
  });

  // Request API 



app.post("/asset-requests", async (req, res) => {
  try {
    const {
      assetId,
      requesterEmail,
      note
    } = req.body;

    /* ===== BASIC VALIDATION ===== */
    if (
      !assetId ||

      !requesterEmail
    ) {
      return res.status(400).send({
        message: "Missing required fields",
      });
    }

    /* ===== FIND USER BY EMAIL ===== */
    const user = await userCollection.findOne({ email: requesterEmail });

    if (!user) {
      return res.status(404).send({
        message: "Requester not found",
      });
    }
    /* ===== FIND ASSET INFO BY ID===== */

    const assetInfo = await assetCollection.findOne({_id : new ObjectId(assetId)})

    /* ===== ROLE CHECK ===== */
    if (user.role !== "EMPLOYEE") {
      return res.status(403).send({
        message: "Only employees can request assets",
      });
    }

    /* ===== PREVENT DUPLICATE REQUEST ===== */
    const existingRequest = await requestCollection.findOne({
      assetId: new ObjectId(assetId),
      requesterEmail: requesterEmail,
      requestStatus: { $in: ["pending", "approved"] }, 
    });

    if (existingRequest) {
      return res.status(409).send({
        message: "You have already requested this asset. Please wait for approval or cancellation.",
      });
    }

    /* ===== CREATE REQUEST DOC ===== */
    const requestDoc = {
      assetId: new ObjectId(assetId),
      assetName : assetInfo.productName,
      assetType : assetInfo.productType,
      requesterName: user.name,
      requesterEmail: user.email,
      hrEmail : assetInfo.hrEmail,
      companyName : assetInfo.companyName,
      requestDate: new Date(),
      approvalDate: null,
      requestStatus: "pending",
      note: note || "",
    };

    const result = await requestCollection.insertOne(requestDoc);

    res.status(201).send({
      message: "Asset request submitted successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Failed to submit asset request",
    });
  }
});

// GET: Fetch asset requests based on user's email and role
app.get("/asset-requests", async (req, res) => {
  try {
    const { email } = req.query;

    // Validate email query param
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email query parameter is required",
      });
    }

    // Find the user
    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Determine which field to query based on role
    let query = {};
    if (user.role === "EMPLOYEE") {
      query = { requesterEmail: email };
    } else if (user.role === "HR") {
      query = { hrEmail: email };
    } else {
      return res.status(403).json({
        success: false,
        message: "Invalid user role",
      });
    }

    // Fetch requests
    const requestedAssets = await requestCollection.find(query).toArray();

    res.status(200).json({
      success: true,
      data: requestedAssets,
    });

  } catch (error) {
    console.error("Error fetching asset requests:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching requests",
    });
  }
});




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
