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
    const employeeAffiliationsCollection = db.collection("employeeAffiliationsCollection")
    const assignedAssetsCollection = db.collection("assignedAssetsCollection")

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

// GET: Fetch available assets (for employees) or HR-specific assets
app.get("/assetcollection", async (req, res) => {
  try {
    const { email, search } = req.query;
    const query = {};

    if (email) {
      query.hrEmail = email; // HR sees all their assets
    } else {
      query.productQuantity = { $gt: 0 }; // Employees see only available
    }

    if (search) {
      query.productName = { $regex: search.trim(), $options: "i" };
    }

    const result = await assetCollection.find(query).toArray();

    res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch assets" });
  }
});
  // PATCH: Update an asset (HR only)
app.patch("/assetcollection/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { productName, productQuantity, productImage, hrEmail } = req.body;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID",
      });
    }

    // Required fields check
    if (!hrEmail) {
      return res.status(400).json({
        success: false,
        message: "hrEmail is required for authorization",
      });
    }

    // At least one field to update
    if (!productName && !productQuantity && !productImage) {
      return res.status(400).json({
        success: false,
        message: "At least one field (productName, productQuantity, or productImage) is required to update",
      });
    }

    // Find the asset
    const asset = await assetCollection.findOne({ _id: new ObjectId(id) });

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    // Authorization: Only the HR who added this asset can update it
    if (asset.hrEmail !== hrEmail) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You can only update assets you added",
      });
    }

    // Build update object (only allowed fields)
    const updateFields = {};
    if (productName) updateFields.productName = productName.trim();
    if (productImage) updateFields.productImage = productImage;
    if (productQuantity !== undefined) {
      const qty = Number(productQuantity);
      if (isNaN(qty) || qty < 0) {
        return res.status(400).json({
          success: false,
          message: "productQuantity must be a non-negative number",
        });
      }
      updateFields.productQuantity = qty;
      updateFields.availableQuantity = qty; // Sync available quantity
    }

    // Perform the update
    const result = await assetCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Asset not found during update",
      });
    }

    res.status(200).json({
      success: true,
      message: "Asset updated successfully",
      modifiedCount: result.modifiedCount,
    });

  } catch (error) {
    console.error("Error updating asset:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update asset",
    });
  }
});
//  Remove an asset (HR only)
app.delete("/assetcollection/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { hrEmail } = req.body; 

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID",
      });
    }

    // Required authorization
    if (!hrEmail) {
      return res.status(400).json({
        success: false,
        message: "hrEmail is required for authorization",
      });
    }

    // Find the asset first
    const asset = await assetCollection.findOne({ _id: new ObjectId(id) });

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    // Authorization: Only the HR who added this asset can delete it
    if (asset.hrEmail !== hrEmail) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You can only delete assets you added",
      });
    }

    // SAFETY CHECK: Prevent deleting assets that have active requests
    const activeRequests = await requestCollection.find({
      assetId: new ObjectId(id),
      requestStatus: { $in: ["pending", "approved"] }, // Block if pending or approved
    }).count();

    if (activeRequests > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete asset. ${activeRequests} active request(s) exist for this asset. Please resolve them first.`,
        activeRequestsCount: activeRequests,
      });
    }

    // Perform the deletion
    const result = await assetCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Asset not found during deletion",
      });
    }



    res.status(200).json({
      success: true,
      message: "Asset deleted successfully",
      deletedCount: result.deletedCount,
    });

  } catch (error) {
    console.error("Error deleting asset:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete asset",
    });
  }
});

  // Request API 



app.post("/asset-requests", async (req, res) => {
  try {
    const { assetId, requesterEmail, note } = req.body;

    if (!assetId || !requesterEmail) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    // Find user
    const user = await userCollection.findOne({ email: requesterEmail });
    if (!user || user.role !== "EMPLOYEE") {
      return res.status(403).json({
        message: "Only employees can request assets",
      });
    }

    // Find asset
    const assetInfo = await assetCollection.findOne({ _id: new ObjectId(assetId) });
    if (!assetInfo) {
      return res.status(404).json({ message: "Asset not found" });
    }

    if (assetInfo.productQuantity <= 0) {
      return res.status(400).json({ message: "This asset is out of stock" });
    }

    // CRITICAL: Prevent re-request after rejection
    const existingRequest = await requestCollection.findOne({
      assetId: new ObjectId(assetId),
      requesterEmail: requesterEmail,
      requestStatus: { $in: ["pending", "approved", "rejected"] }, // Now includes rejected!
    });

    if (existingRequest) {
      if (existingRequest.requestStatus === "pending") {
        return res.status(409).json({
          message: "You already have a pending request for this asset.",
        });
      }
      if (existingRequest.requestStatus === "approved") {
        return res.status(409).json({
          message: "This asset has already been approved for you.",
        });
      }
      if (existingRequest.requestStatus === "rejected") {
        return res.status(403).json({
          message: "Your previous request for this asset was rejected. You cannot request it again.",
        });
      }
    }

    // Create new request
    const requestDoc = {
      assetId: new ObjectId(assetId),
      assetName: assetInfo.productName,
      assetType: assetInfo.productType,
      requesterName: user.name,
      requesterEmail: user.email,
      hrEmail: assetInfo.hrEmail,
      companyName: assetInfo.companyName,
      requestDate: new Date(),
      approvalDate: null,
      requestStatus: "pending",
      note: note || "",
    };

    const result = await requestCollection.insertOne(requestDoc);

    res.status(201).json({
      message: "Asset request submitted successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to submit asset request",
    });
  }
});

//  Reject an asset request (HR only)
app.patch("/asset-request/reject/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { hrEmail } = req.body; // HR email sent from frontend for authorization

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request ID",
      });
    }

    // HR email is required for authorization
    if (!hrEmail) {
      return res.status(400).json({
        success: false,
        message: "hrEmail is required for authorization",
      });
    }

    // Find the request
    const request = await requestCollection.findOne({ _id: new ObjectId(id) });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Asset request not found",
      });
    }

    // Authorization: Only the HR responsible for this asset/company can reject
    if (request.hrEmail !== hrEmail) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You can only manage requests for your company assets",
      });
    }

    // Only pending requests can be rejected
    if (request.requestStatus !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a request that is already ${request.requestStatus}`,
      });
    }

    // Update the request status to "rejected"
    const result = await requestCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          requestStatus: "rejected",
          rejectionDate: new Date(), //
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Request not found during update",
      });
    }

    res.status(200).json({
      success: true,
      message: "Asset request rejected successfully",
      modifiedCount: result.modifiedCount,
    });

  } catch (error) {
    console.error("Error rejecting asset request:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject request",
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

// PATCH: Approve an asset request (HR only) - WITH EMPLOYEE LIMIT CHECK
app.patch("/asset-request/approve/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { hrEmail } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request ID",
      });
    }

    if (!hrEmail) {
      return res.status(400).json({
        success: false,
        message: "hrEmail is required",
      });
    }

    // Find the pending request
    const request = await requestCollection.findOne({ 
      _id: new ObjectId(id),
      requestStatus: "pending" 
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Pending request not found",
      });
    }

    // Authorization
    if (request.hrEmail !== hrEmail) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Get HR user to check package limit
    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) {
      return res.status(403).json({
        success: false,
        message: "HR account not found",
      });
    }

    // Check if this approval would affiliate a NEW employee
    const existingAffiliation = await employeeAffiliationsCollection.findOne({
      employeeEmail: request.requesterEmail,
      hrEmail: hrEmail,
      status: "active",
    });

    const isNewEmployee = !existingAffiliation;

    if (isNewEmployee) {
      // Check employee limit
      if (hrUser.currentEmployees >= hrUser.packageLimit) {
        return res.status(403).json({
          success: false,
          message: `Cannot approve: Employee limit reached (${hrUser.currentEmployees}/${hrUser.packageLimit}). Upgrade your package to add more employees.`,
        });
      }
    }

    // Get asset and check stock
    const asset = await assetCollection.findOne({ _id: request.assetId });
    if (!asset || asset.productQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Asset is out of stock",
      });
    }

    // 1. Deduct asset quantity (with optimistic check)
    const assetUpdate = await assetCollection.updateOne(
      { _id: request.assetId, productQuantity: { $gt: 0 } },
      { $inc: { productQuantity: -1, availableQuantity: -1 } }
    );

    if (assetUpdate.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Asset out of stock — approval failed",
      });
    }

    // 2. Mark request as approved
    await requestCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          requestStatus: "approved",
          approvalDate: new Date(),
        },
      }
    );

    // 3. Assign asset to employee
    await assignedAssetsCollection.insertOne({
      assetId: request.assetId,
      assetName: request.assetName,
      assetImage: asset.productImage,
      assetType: request.assetType,
      employeeEmail: request.requesterEmail,
      employeeName: request.requesterName,
      hrEmail: request.hrEmail,
      companyName: request.companyName,
      assignmentDate: new Date(),
      returnDate: null,
      status: "assigned",
    });

    // 4. Create affiliation if new employee AND increment currentEmployees
    if (isNewEmployee) {
      await employeeAffiliationsCollection.insertOne({
        employeeEmail: request.requesterEmail,
        employeeName: request.requesterName,
        hrEmail: request.hrEmail,
        companyName: request.companyName,
        companyLogo: hrUser.companyLogo || "",
        affiliationDate: new Date(),
        status: "active",
      });

      // Increment current employee count
      await userCollection.updateOne(
        { email: hrEmail },
        { $inc: { currentEmployees: 1 } }
      );
    }

    res.status(200).json({
      success: true,
      message: "Request approved and asset assigned successfully",
      newEmployeeAdded: isNewEmployee,
    });

  } catch (error) {
    console.error("Error approving request:", error);
    res.status(500).json({
      success: false,
      message: "Server error during approval",
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
