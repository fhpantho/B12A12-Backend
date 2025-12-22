require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require('./firebaseAdmin');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
    const assetCollection = db.collection("assetCollection");
    const requestCollection = db.collection("requestCollection");
    const employeeAffiliationsCollection = db.collection("employeeAffiliationsCollection");
    const assignedAssetsCollection = db.collection("assignedAssetsCollection");

    console.log("✅ MongoDB connected successfully");

    /* GET USER (by email optional) */
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

    /* VALIDATE USER */
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

    /* CREATE USER */
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

        let userInfo = {
          name,
          email,
          role: normalizedRole,
          dateOfBirth,
          createdAt: new Date(),
        };

        if (normalizedRole === "HR") {
          userInfo = {
            ...userInfo,
            companyName,
            companyLogo,
            subscription: "basic",
            packageLimit: 5,
            currentEmployees: 0,
          };
        } else if (normalizedRole === "EMPLOYEE") {
          userInfo = {
            ...userInfo,
            photo,
          };
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

    /* ADD NEW ASSET (HR ONLY) */
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

        const user = await userCollection.findOne({ email: hrEmail, role: "HR" });
        if (!user) {
          return res.status(403).send({
            success: false,
            message: "Unauthorized: Only verified HR users can add assets",
          });
        }

        if (user.companyName !== companyName) {
          return res.status(403).send({
            success: false,
            message: "Unauthorized: Company name does not match your account",
          });
        }

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

    /* GET: Assets — newest first */
app.get("/assetcollection", async (req, res) => {
  try {
    const { search } = req.query;
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    page = page < 1 ? 1 : page;
    limit = limit < 1 ? 10 : limit;

    const query = { productQuantity: { $gt: 0 } };

    if (search) {
      query.productName = { $regex: search.trim(), $options: "i" };
    }

    const total = await assetCollection.countDocuments(query);
    const assets = await assetCollection
      .find(query)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.status(200).json({
      success: true,
      data: assets,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch assets" });
  }
});

    /* PATCH: Update asset (HR only) */
    app.patch("/assetcollection/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { productName, productQuantity, productImage, hrEmail } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid asset ID",
          });
        }

        if (!hrEmail) {
          return res.status(400).json({
            success: false,
            message: "hrEmail is required for authorization",
          });
        }

        if (!productName && !productQuantity && !productImage) {
          return res.status(400).json({
            success: false,
            message: "At least one field is required to update",
          });
        }

        const asset = await assetCollection.findOne({ _id: new ObjectId(id) });
        if (!asset) {
          return res.status(404).json({
            success: false,
            message: "Asset not found",
          });
        }

        if (asset.hrEmail !== hrEmail) {
          return res.status(403).json({
            success: false,
            message: "Unauthorized",
          });
        }

        const updateFields = {};
        if (productName) updateFields.productName = productName.trim();
        if (productImage) updateFields.productImage = productImage;
        if (productQuantity !== undefined) {
          const qty = Number(productQuantity);
          if (isNaN(qty) || qty < 0) {
            return res.status(400).json({
              success: false,
              message: "productQuantity must be non-negative",
            });
          }
          updateFields.productQuantity = qty;
          updateFields.availableQuantity = qty;
        }

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

    /* DELETE: Remove asset (HR only) */
    app.delete("/assetcollection/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { hrEmail } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid asset ID",
          });
        }

        if (!hrEmail) {
          return res.status(400).json({
            success: false,
            message: "hrEmail is required",
          });
        }

        const asset = await assetCollection.findOne({ _id: new ObjectId(id) });
        if (!asset) {
          return res.status(404).json({
            success: false,
            message: "Asset not found",
          });
        }

        if (asset.hrEmail !== hrEmail) {
          return res.status(403).json({
            success: false,
            message: "Unauthorized",
          });
        }

        const activeRequests = await requestCollection.countDocuments({
          assetId: new ObjectId(id),
          requestStatus: { $in: ["pending", "approved"] },
        });

        if (activeRequests > 0) {
          return res.status(409).json({
            success: false,
            message: `Cannot delete asset. ${activeRequests} active request(s) exist.`,
          });
        }

        const result = await assetCollection.deleteOne({ _id: new ObjectId(id) });

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

    /* POST: Create asset request */
    app.post("/asset-requests", async (req, res) => {
      try {
        const { assetId, requesterEmail, note } = req.body;

        if (!assetId || !requesterEmail) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const user = await userCollection.findOne({ email: requesterEmail });
        if (!user || user.role !== "EMPLOYEE") {
          return res.status(403).json({ message: "Only employees can request assets" });
        }

        const assetInfo = await assetCollection.findOne({ _id: new ObjectId(assetId) });
        if (!assetInfo || assetInfo.productQuantity <= 0) {
          return res.status(400).json({ message: "Asset not found or out of stock" });
        }

        const existingRequest = await requestCollection.findOne({
          assetId: new ObjectId(assetId),
          requesterEmail,
          requestStatus: { $in: ["pending", "approved", "rejected"] },
        });

        if (existingRequest) {
          if (existingRequest.requestStatus === "pending") return res.status(409).json({ message: "You already have a pending request" });
          if (existingRequest.requestStatus === "approved") return res.status(409).json({ message: "This asset is already approved for you" });
          if (existingRequest.requestStatus === "rejected") return res.status(403).json({ message: "Your previous request was rejected. Cannot request again." });
        }

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
        res.status(500).json({ message: "Failed to submit request" });
      }
    });

    /* PATCH: Reject request */
    app.patch("/asset-request/reject/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { hrEmail } = req.body;

        if (!ObjectId.isValid(id) || !hrEmail) {
          return res.status(400).json({ success: false, message: "Invalid data" });
        }

        const request = await requestCollection.findOne({ _id: new ObjectId(id) });
        if (!request || request.requestStatus !== "pending" || request.hrEmail !== hrEmail) {
          return res.status(400).json({ success: false, message: "Cannot reject this request" });
        }

        await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { requestStatus: "rejected", rejectionDate: new Date() } }
        );

        res.status(200).json({ success: true, message: "Request rejected successfully" });
      } catch (error) {
        res.status(500).json({ success: false, message: "Failed to reject request" });
      }
    });

    /* GET: Asset requests — newest first */
    app.get("/asset-requests", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ success: false, message: "Email required" });

        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const query = user.role === "EMPLOYEE" ? { requesterEmail: email } : { hrEmail: email };

        const requests = await requestCollection
          .find(query)
          .sort({ _id: -1 }) // Newest first
          .toArray();

        res.status(200).json({ success: true, data: requests });
      } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    /* PATCH: Approve request (with limit check) */
    app.patch("/asset-request/approve/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { hrEmail } = req.body;

        if (!ObjectId.isValid(id) || !hrEmail) {
          return res.status(400).json({ success: false, message: "Invalid data" });
        }

        const request = await requestCollection.findOne({ _id: new ObjectId(id), requestStatus: "pending" });
        if (!request || request.hrEmail !== hrEmail) {
          return res.status(400).json({ success: false, message: "Invalid request" });
        }

        const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
        const asset = await assetCollection.findOne({ _id: request.assetId });

        if (!asset || asset.productQuantity <= 0) {
          return res.status(400).json({ success: false, message: "Asset out of stock" });
        }

        const existingAffiliation = await employeeAffiliationsCollection.findOne({
          employeeEmail: request.requesterEmail,
          hrEmail,
          status: "active",
        });

        const isNewEmployee = !existingAffiliation;

        if (isNewEmployee && hrUser.currentEmployees >= hrUser.packageLimit) {
          return res.status(403).json({
            success: false,
            message: `Employee limit reached (${hrUser.currentEmployees}/${hrUser.packageLimit})`,
          });
        }

        // Deduct quantity
        const assetUpdate = await assetCollection.updateOne(
          { _id: request.assetId, productQuantity: { $gt: 0 } },
          { $inc: { productQuantity: -1, availableQuantity: -1 } }
        );

        if (assetUpdate.modifiedCount === 0) {
          return res.status(400).json({ success: false, message: "Asset out of stock" });
        }

        // Approve request
        await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { requestStatus: "approved", approvalDate: new Date() } }
        );

        // Assign asset
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

        // Affiliate new employee
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

          await userCollection.updateOne({ email: hrEmail }, { $inc: { currentEmployees: 1 } });
        }

        res.status(200).json({ success: true, message: "Request approved successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    /* GET: Assigned assets for employee — newest first */
    app.get("/assigned-assets", async (req, res) => {
      try {
        const { employeeEmail } = req.query;
        if (!employeeEmail) {
          return res.status(400).json({ success: false, message: "employeeEmail required" });
        }

        const assignedAssets = await assignedAssetsCollection
          .find({ employeeEmail, status: "assigned" })
          .sort({ _id: -1 }) // Newest first
          .toArray();

        res.status(200).json({
          success: true,
          count: assignedAssets.length,
          data: assignedAssets,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to fetch assigned assets" });
      }
    });

    // GET: Employee affiliations
app.get("/employee-affiliations", async (req, res) => {
  try {
    const { employeeEmail } = req.query;
    if (!employeeEmail) {
      return res.status(400).json({ message: "employeeEmail required" });
    }
    const affiliations = await employeeAffiliationsCollection
      .find({ employeeEmail, status: "active" })
      .sort({ affiliationDate: -1 })
      .toArray();
    res.json({ success: true, data: affiliations });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// PATCH: Update user profile (name, dateOfBirth, photo/companyLogo)
app.patch("/user/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { name, dateOfBirth, photo } = req.body; // photo for employee, companyLogo for HR

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
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

    // Build update fields
    const updateFields = {};
    if (name) updateFields.name = name.trim();
    if (dateOfBirth) updateFields.dateOfBirth = new Date(dateOfBirth);
    if (photo) {
      if (user.role === "EMPLOYEE") {
        updateFields.photo = photo;
      } else if (user.role === "HR") {
        updateFields.companyLogo = photo; // Allow HR to update company logo
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    // Perform update
    const result = await userCollection.updateOne(
      { email },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found during update",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
});

// GET: Fetch all affiliated employees for this HR
app.get("/my-employees", async (req, res) => {
  try {
    const { hrEmail } = req.query;

    if (!hrEmail) {
      return res.status(400).json({
        success: false,
        message: "hrEmail is required",
      });
    }

    // Find HR to get current count and limit
    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Fetch active affiliations
    const affiliations = await employeeAffiliationsCollection
      .find({ hrEmail, status: "active" })
      .toArray();

    // Fetch assigned asset count per employee
    const employeeEmails = affiliations.map(aff => aff.employeeEmail);
    const assetCounts = await assignedAssetsCollection.aggregate([
      {
        $match: {
          employeeEmail: { $in: employeeEmails },
          status: "assigned"
        }
      },
      {
        $group: {
          _id: "$employeeEmail",
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Map asset counts
    const assetCountMap = {};
    assetCounts.forEach(item => {
      assetCountMap[item._id] = item.count;
    });

    // Combine data
    const employees = affiliations.map(aff => ({
      _id: aff._id,
      name: aff.employeeName,
      email: aff.employeeEmail,
      photo: "", // Will be filled from users collection if needed
      joinDate: aff.affiliationDate,
      assetsCount: assetCountMap[aff.employeeEmail] || 0,
    }));

// Enrich with photo from users collection
    for (let emp of employees) {
      const user = await userCollection.findOne({ email: emp.email, role: "EMPLOYEE" });
      if (user?.photo) emp.photo = user.photo;
    }

    res.status(200).json({
      success: true,
      currentEmployees: hrUser.currentEmployees,
      packageLimit: hrUser.packageLimit,
      employees,
    });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch employees",
    });
  }
});

// PATCH: Remove employee from team (HR only)
app.patch("/remove-employee", async (req, res) => {
  try {
    const { hrEmail, employeeEmail } = req.body;

    if (!hrEmail || !employeeEmail) {
      return res.status(400).json({
        success: false,
        message: "hrEmail and employeeEmail required",
      });
    }

    // Verify HR
    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // Deactivate affiliation
    const affiliationResult = await employeeAffiliationsCollection.updateOne(
      { hrEmail, employeeEmail, status: "active" },
      { $set: { status: "inactive" } }
    );

    if (affiliationResult.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: "Employee not found in your team" });
    }

    // Return all assigned assets (set to returned, increment stock)
    const assigned = await assignedAssetsCollection.find({ employeeEmail, hrEmail, status: "assigned" }).toArray();

    for (let assignment of assigned) {
      // Return asset: increment quantity
      await assetCollection.updateOne(
        { _id: assignment.assetId },
        { $inc: { productQuantity: 1, availableQuantity: 1 } }
      );

      // Mark as returned
      await assignedAssetsCollection.updateOne(
        { _id: assignment._id },
        { $set: { status: "returned", returnDate: new Date() } }
      );
    }

    // Decrement current employee count
    await userCollection.updateOne(
      { email: hrEmail },
      { $inc: { currentEmployees: -1 } }
    );

    res.status(200).json({
      success: true,
      message: "Employee removed from team successfully",
      returnedAssets: assigned.length,
    });
  } catch (error) {
    console.error("Error removing employee:", error);
    res.status(500).json({ success: false, message: "Failed to remove employee" });
  }
});

// GET: Fetch team members for a specific company (by companyName)
app.get("/my-team", async (req, res) => {
  try {
    const { companyName, employeeEmail } = req.query;

    if (!companyName || !employeeEmail) {
      return res.status(400).json({ message: "companyName and employeeEmail required" });
    }

    // Get all affiliated employees in this company
    const teamAffiliations = await employeeAffiliationsCollection
      .find({ companyName, status: "active" })
      .toArray();

    const teamEmails = teamAffiliations.map(aff => aff.employeeEmail);

    // Fetch user details
    const teamMembers = await userCollection
      .find({ email: { $in: teamEmails }, role: "EMPLOYEE" })
      .toArray();

    // Map with affiliation data
    const colleagues = teamMembers.map(member => {
      const aff = teamAffiliations.find(a => a.employeeEmail === member.email);
      return {
        name: member.name,
        email: member.email,
        photo: member.photo || "",
        joinDate: aff?.affiliationDate || null,
        dateOfBirth: member.dateOfBirth || null,
      };
    });

    // Exclude current user
    const filteredColleagues = colleagues.filter(c => c.email !== employeeEmail);

    // Upcoming birthdays (current month)
    const currentMonth = new Date().getMonth();
    const upcomingBirthdays = filteredColleagues
      .filter(c => {
        if (!c.dateOfBirth) return false;
        const birthMonth = new Date(c.dateOfBirth).getMonth();
        return birthMonth === currentMonth;
      })
      .sort((a, b) => {
        const dayA = new Date(a.dateOfBirth).getDate();
        const dayB = new Date(b.dateOfBirth).getDate();
        return dayA - dayB;
      });

    res.json({
      success: true,
      colleagues: filteredColleagues,
      upcomingBirthdays,
      total: filteredColleagues.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


// GET: Asset type distribution for pie chart
app.get("/analytics/asset-types", async (req, res) => {
  try {
    const { hrEmail } = req.query;
    const query = hrEmail ? { hrEmail } : {};

    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: "$productType",
          count: { $sum: 1 },
        },
      },
    ];

    const result = await assetCollection.aggregate(pipeline).toArray();

    const distribution = {
      Returnable: 0,
      "Non-returnable": 0,
    };
    result.forEach(item => {
      distribution[item._id] = item.count;
    });

    res.json({ success: true, data: distribution });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// GET: Top 5 most requested assets
app.get("/analytics/top-requested", async (req, res) => {
  try {
    const { hrEmail } = req.query;

    const pipeline = [
      { $match: hrEmail ? { hrEmail } : {} },
      {
        $group: {
          _id: "$assetName",
          requestCount: { $sum: 1 },
        },
      },
      { $sort: { requestCount: -1 } },
      { $limit: 5 },
    ];

    const result = await requestCollection.aggregate(pipeline).toArray();

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});


// PATCH: Direct asset assignment by HR to affiliated employee
app.patch("/direct-assign", async (req, res) => {
  try {
    const { hrEmail, employeeEmail, assetId } = req.body;

    if (!hrEmail || !employeeEmail || !assetId) {
      return res.status(400).json({
        success: false,
        message: "hrEmail, employeeEmail, and assetId are required",
      });
    }

    // Verify HR
    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) return res.status(403).json({ success: false, message: "Unauthorized" });

    // Verify affiliation
    const affiliation = await employeeAffiliationsCollection.findOne({
      hrEmail,
      employeeEmail,
      status: "active",
    });
    if (!affiliation) {
      return res.status(403).json({
        success: false,
        message: "Employee not affiliated with your company",
      });
    }

    // Get asset
    const asset = await assetCollection.findOne({ _id: new ObjectId(assetId), hrEmail });
    if (!asset || asset.productQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Asset not available or out of stock",
      });
    }

// prevent duplicate assing
const existingAssignment = await assignedAssetsCollection.findOne({
  assetId: new ObjectId(assetId),
  employeeEmail,
  status: "assigned",
});

if (existingAssignment) {
  return res.status(409).json({
    success: false,
    message: "This asset is already assigned to this employee. Cannot assign again.",
  });
}

    // Deduct quantity
    const updateResult = await assetCollection.updateOne(
      { _id: new ObjectId(assetId), productQuantity: { $gt: 0 } },
      { $inc: { productQuantity: -1, availableQuantity: -1 } }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({ success: false, message: "Asset out of stock" });
    }

    // Create assigned asset
    await assignedAssetsCollection.insertOne({
      assetId: new ObjectId(assetId),
      assetName: asset.productName,
      assetImage: asset.productImage,
      assetType: asset.productType,
      employeeEmail,
      employeeName: affiliation.employeeName,
      hrEmail,
      companyName: asset.companyName,
      assignmentDate: new Date(),
      returnDate: null,
      status: "assigned",
    });

    res.status(200).json({
      success: true,
      message: "Asset assigned directly to employee",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to assign asset" });
  }
});

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("Database connection failed:", error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});