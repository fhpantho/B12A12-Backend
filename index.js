require("dotenv").config();
const stripe = require('stripe')(process.env.STRIPEKEY);

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = process.env.URI;

const app = express();
const admin = require("firebase-admin");

const serviceAccount = require("./firebaseadminkey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


/* MIDDLEWARES */
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://assetversefhpantho.netlify.app"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);


const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization; // standard header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("missing header");
      return res.status(401).send({ message: "Unauthorized access" });
    }

    const token = authHeader.split(" ")[1]; // actual token
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // attach user info to request
    next();
  } catch (err) {
    console.error("Invalid token:", err);
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

/* BASIC ROUTE */
app.get("/", (req, res) => {
  res.send("AssetVerse server is running");
});

/* SERVERLESS-FRIENDLY MONGODB CONNECTION CACHING */
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb && cachedClient.topology?.isConnected()) {
    return { client: cachedClient, db: cachedDb };
  }

  // Close stale connection if exists
  if (cachedClient) {
    try {
      await cachedClient.close();
    } catch (e) {
      console.error("Error closing stale MongoDB client:", e);
    }
  }

  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  const db = client.db("AssetVerseDB");

  cachedClient = client;
  cachedDb = db;

  console.log("✅ MongoDB connected successfully");

  return { client, db };
}

async function getCollections() {
  const { db } = await connectToDatabase();
  return {
    userCollection: db.collection("UserInfo"),
    assetCollection: db.collection("assetCollection"),
    requestCollection: db.collection("requestCollection"),
    employeeAffiliationsCollection: db.collection("employeeAffiliationsCollection"),
    assignedAssetsCollection: db.collection("assignedAssetsCollection"),
    pakageCollections : db.collection("pakageCollections"),
    paymentCollection: db.collection("Payments")
  };
}

/* ==================== ALL ROUTES ==================== */

/* GET USER (by email optional) */
app.get("/user", async (req, res) => {
  try {
    const { email } = req.query;
    const { userCollection } = await getCollections();
    const query = email ? { email } : {};
    const users = await userCollection.find(query).toArray();
    res.send(users);
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Failed to fetch users" });
  }
});

/* VALIDATE USER */
app.post("/user/validate", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).send({ success: false, message: "Email is required" });
    const { userCollection } = await getCollections();
    const user = await userCollection.findOne({ email });
    if (user) return res.status(409).send({ success: false, message: "User already exists" });
    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ success: false, message: "Server error" });
  }
});

/* CREATE USER */
app.post("/user", async (req, res) => {
  try {
    const { name, email, role, companyName, companyLogo, photo, dateOfBirth } = req.body;

    if (!email || !role) {
      return res.status(400).send({ success: false, message: "Email and role are required" });
    }

    const { userCollection } = await getCollections();
    const existingUser = await userCollection.findOne({ email });
    if (existingUser) {
      return res.status(409).send({ success: false, message: "User already exists" });
    }

    const normalizedRole = role.toUpperCase();

    let userInfo = {
      name,
      email,
      role: normalizedRole,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
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
      userInfo = { ...userInfo, photo };
    }

    const result = await userCollection.insertOne(userInfo);

    res.status(201).send({
      success: true,
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Server error" });
  }
});

/* ADD NEW ASSET (HR ONLY) */
app.post("/assetcollection", verifyFirebaseToken, async (req, res) => {
  try {
    const { productName, productImage, productType, productQuantity, hrEmail, companyName } = req.body;

    if (!productName || !productImage || !productType || !productQuantity || !hrEmail || !companyName) {
      return res.status(400).send({ success: false, message: "All fields are required" });
    }

    if (!["Returnable", "Non-returnable"].includes(productType)) {
      return res.status(400).send({ success: false, message: "Invalid product type" });
    }

    const { userCollection, assetCollection } = await getCollections();

    const user = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!user || user.companyName !== companyName) {
      return res.status(403).send({ success: false, message: "Unauthorized" });
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
    res.status(500).send({ success: false, message: "Failed to add asset" });
  }
});

/* GET: Assets — with pagination & search */
app.get("/assetcollection",verifyFirebaseToken, async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const { search, email } = req.query;

    if (!email) {
      return res.status(400).json({ success: false, message: "HR email required" });
    }

    page = page < 1 ? 1 : page;
    limit = limit < 1 ? 10 : limit;

    const { assetCollection, userCollection } = await getCollections();

    // ✅ Verify HR
    const hrUser = await userCollection.findOne({ email, role: "HR" });
    if (!hrUser) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // ✅ CRITICAL FIX: filter by hrEmail
    const query = {
      hrEmail: email,
      productQuantity: { $gt: 0 },
    };

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

    res.json({
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
app.get("/employee-assets", verifyFirebaseToken, async (req, res) => {
  try {
    const { assetCollection } = await getCollections(); // ✅ FIX

    const assets = await assetCollection
      .find({ availableQuantity: { $gt: 0 } }) // optional safety
      .sort({ _id: -1 })
      .toArray();

    res.json({
      success: true,
      data: assets,
    });
  } catch (error) {
    console.error("Employee assets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch assets",
    });
  }
});




/* PATCH: Update asset (HR only) */
app.patch("/assetcollection/:id",verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { productName, productQuantity, productImage, hrEmail } = req.body;

    if (!ObjectId.isValid(id) || !hrEmail) {
      return res.status(400).json({ success: false, message: "Invalid data" });
    }

    if (!productName && productQuantity === undefined && !productImage) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const { assetCollection } = await getCollections();
    const asset = await assetCollection.findOne({ _id: new ObjectId(id) });

    if (!asset || asset.hrEmail !== hrEmail) {
      return res.status(403).json({ success: false, message: "Unauthorized or not found" });
    }

    const updateFields = {};
    if (productName) updateFields.productName = productName.trim();
    if (productImage) updateFields.productImage = productImage;
    if (productQuantity !== undefined) {
      const qty = Number(productQuantity);
      if (isNaN(qty) || qty < 0) return res.status(400).json({ success: false, message: "Invalid quantity" });
      updateFields.productQuantity = qty;
      updateFields.availableQuantity = qty;
    }

    const result = await assetCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    res.json({
      success: true,
      message: "Asset updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update asset" });
  }
});

/* DELETE: Remove asset (HR only) */
app.delete("/assetcollection/:id",verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { hrEmail } = req.body;

    if (!ObjectId.isValid(id) || !hrEmail) {
      return res.status(400).json({ success: false, message: "Invalid data" });
    }

    const { assetCollection, requestCollection } = await getCollections();
    const asset = await assetCollection.findOne({ _id: new ObjectId(id) });

    if (!asset || asset.hrEmail !== hrEmail) {
      return res.status(403).json({ success: false, message: "Unauthorized or not found" });
    }

    const activeRequests = await requestCollection.countDocuments({
      assetId: new ObjectId(id),
      requestStatus: { $in: ["pending", "approved"] },
    });

    if (activeRequests > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete. ${activeRequests} active request(s) exist.`,
      });
    }

    await assetCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true, message: "Asset deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to delete asset" });
  }
});

/* POST: Create asset request */
app.post("/asset-requests",verifyFirebaseToken, async (req, res) => {
  try {
    const { assetId, requesterEmail, note } = req.body;
    if (!assetId || !requesterEmail) return res.status(400).json({ message: "Missing required fields" });

    const { userCollection, assetCollection, requestCollection } = await getCollections();

    const user = await userCollection.findOne({ email: requesterEmail });
    if (!user || user.role !== "EMPLOYEE") {
      return res.status(403).json({ message: "Only employees can request assets" });
    }

    const assetInfo = await assetCollection.findOne({ _id: new ObjectId(assetId) });
    if (!assetInfo || assetInfo.availableQuantity <= 0) {
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
app.patch("/asset-request/reject/:id",verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { hrEmail } = req.body;

    if (!ObjectId.isValid(id) || !hrEmail) {
      return res.status(400).json({ success: false, message: "Invalid data" });
    }

    const { requestCollection } = await getCollections();
    const request = await requestCollection.findOne({ _id: new ObjectId(id) });

    if (!request || request.requestStatus !== "pending" || request.hrEmail !== hrEmail) {
      return res.status(400).json({ success: false, message: "Cannot reject this request" });
    }

    await requestCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { requestStatus: "rejected", rejectionDate: new Date() } }
    );

    res.json({ success: true, message: "Request rejected successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to reject request" });
  }
});

/* GET: Asset requests */
app.get("/asset-requests",verifyFirebaseToken, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const { userCollection, requestCollection } = await getCollections();
    const user = await userCollection.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const query = user.role === "EMPLOYEE" ? { requesterEmail: email } : { hrEmail: email };

    const requests = await requestCollection.find(query).sort({ _id: -1 }).toArray();

    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* PATCH: Approve request */
app.patch("/asset-request/approve/:id",verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { hrEmail } = req.body;

    if (!ObjectId.isValid(id) || !hrEmail) {
      return res.status(400).json({ success: false, message: "Invalid data" });
    }

    const {
      requestCollection,
      userCollection,
      assetCollection,
      employeeAffiliationsCollection,
      assignedAssetsCollection,
    } = await getCollections();

    const request = await requestCollection.findOne({ _id: new ObjectId(id), requestStatus: "pending" });
    if (!request || request.hrEmail !== hrEmail) {
      return res.status(400).json({ success: false, message: "Invalid request" });
    }

    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    const asset = await assetCollection.findOne({ _id: request.assetId });

    if (!asset || asset.availableQuantity <= 0) {
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

    const assetUpdate = await assetCollection.updateOne(
      { _id: request.assetId, availableQuantity: { $gt: 0 } },
      { $inc: { productQuantity: -1, availableQuantity: -1 } }
    );

    if (assetUpdate.modifiedCount === 0) {
      return res.status(400).json({ success: false, message: "Asset out of stock" });
    }

    await requestCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { requestStatus: "approved", approvalDate: new Date() } }
    );

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

    res.json({ success: true, message: "Request approved successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* GET: Assigned assets for employee */
app.get("/assigned-assets",verifyFirebaseToken, async (req, res) => {
  try {
    const { employeeEmail } = req.query;
    if (!employeeEmail) return res.status(400).json({ success: false, message: "employeeEmail required" });

    const { assignedAssetsCollection } = await getCollections();

    const assignedAssets = await assignedAssetsCollection
      .find({ employeeEmail, status: "assigned" })
      .sort({ _id: -1 })
      .toArray();

    res.json({
      success: true,
      count: assignedAssets.length,
      data: assignedAssets,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch assigned assets" });
  }
});

/* GET: Employee affiliations */
app.get("/employee-affiliations",verifyFirebaseToken, async (req, res) => {
  try {
    const { employeeEmail } = req.query;
    if (!employeeEmail) return res.status(400).json({ message: "employeeEmail required" });

    const { employeeAffiliationsCollection } = await getCollections();

    const affiliations = await employeeAffiliationsCollection
      .find({ employeeEmail, status: "active" })
      .sort({ affiliationDate: -1 })
      .toArray();

    res.json({ success: true, data: affiliations });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/* PATCH: Update user profile */
app.patch("/user/:email",verifyFirebaseToken, async (req, res) => {
  try {
    const { email } = req.params;
    const { name, dateOfBirth, photo } = req.body;

    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const { userCollection } = await getCollections();
    const user = await userCollection.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const updateFields = {};
    if (name) updateFields.name = name.trim();
    if (dateOfBirth) updateFields.dateOfBirth = new Date(dateOfBirth);
    if (photo) {
      if (user.role === "EMPLOYEE") updateFields.photo = photo;
      else if (user.role === "HR") updateFields.companyLogo = photo;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const result = await userCollection.updateOne({ email }, { $set: updateFields });

    res.json({
      success: true,
      message: "Profile updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
});

/* GET: My employees (HR) */
app.get("/my-employees",verifyFirebaseToken, async (req, res) => {
  try {
    const { hrEmail } = req.query;
    if (!hrEmail) return res.status(400).json({ success: false, message: "hrEmail required" });

    const {
      userCollection,
      employeeAffiliationsCollection,
      assignedAssetsCollection,
    } = await getCollections();

    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) return res.status(403).json({ success: false, message: "Unauthorized" });

    const affiliations = await employeeAffiliationsCollection
      .find({ hrEmail, status: "active" })
      .toArray();

    const employeeEmails = affiliations.map((aff) => aff.employeeEmail);
    const assetCounts = await assignedAssetsCollection
      .aggregate([
        { $match: { employeeEmail: { $in: employeeEmails }, status: "assigned" } },
        { $group: { _id: "$employeeEmail", count: { $sum: 1 } } },
      ])
      .toArray();

    const assetCountMap = {};
    assetCounts.forEach((item) => (assetCountMap[item._id] = item.count));

    const employees = affiliations.map((aff) => ({
      _id: aff._id,
      name: aff.employeeName,
      email: aff.employeeEmail,
      photo: "",
      joinDate: aff.affiliationDate,
      assetsCount: assetCountMap[aff.employeeEmail] || 0,
    }));

    for (let emp of employees) {
      const user = await userCollection.findOne({ email: emp.email, role: "EMPLOYEE" });
      if (user?.photo) emp.photo = user.photo;
    }

    res.json({
      success: true,
      currentEmployees: hrUser.currentEmployees,
      packageLimit: hrUser.packageLimit,
      employees,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch employees" });
  }
});

/* PATCH: Remove employee from team */
app.patch("/remove-employee",verifyFirebaseToken, async (req, res) => {
  try {
    const { hrEmail, employeeEmail } = req.body;
    if (!hrEmail || !employeeEmail) {
      return res.status(400).json({ success: false, message: "hrEmail and employeeEmail required" });
    }

    const {
      userCollection,
      employeeAffiliationsCollection,
      assignedAssetsCollection,
      assetCollection,
    } = await getCollections();

    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) return res.status(403).json({ success: false, message: "Unauthorized" });

    const affiliationResult = await employeeAffiliationsCollection.updateOne(
      { hrEmail, employeeEmail, status: "active" },
      { $set: { status: "inactive" } }
    );

    if (affiliationResult.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: "Employee not found in your team" });
    }

    const assigned = await assignedAssetsCollection
      .find({ employeeEmail, hrEmail, status: "assigned" })
      .toArray();

    for (let assignment of assigned) {
      await assetCollection.updateOne(
        { _id: assignment.assetId },
        { $inc: { productQuantity: 1, availableQuantity: 1 } }
      );

      await assignedAssetsCollection.updateOne(
        { _id: assignment._id },
        { $set: { status: "returned", returnDate: new Date() } }
      );
    }

    await userCollection.updateOne({ email: hrEmail }, { $inc: { currentEmployees: -1 } });

    res.json({
      success: true,
      message: "Employee removed from team successfully",
      returnedAssets: assigned.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to remove employee" });
  }
});

/* GET: Team members (for employee) */
app.get("/my-team",verifyFirebaseToken, async (req, res) => {
  try {
    const { companyName, employeeEmail } = req.query;
    if (!companyName || !employeeEmail) {
      return res.status(400).json({ message: "companyName and employeeEmail required" });
    }

    const { employeeAffiliationsCollection, userCollection } = await getCollections();

    const teamAffiliations = await employeeAffiliationsCollection
      .find({ companyName, status: "active" })
      .toArray();

    const teamEmails = teamAffiliations.map((aff) => aff.employeeEmail);

    const teamMembers = await userCollection
      .find({ email: { $in: teamEmails }, role: "EMPLOYEE" })
      .toArray();

    const colleagues = teamMembers.map((member) => {
      const aff = teamAffiliations.find((a) => a.employeeEmail === member.email);
      return {
        name: member.name,
        email: member.email,
        photo: member.photo || "",
        joinDate: aff?.affiliationDate || null,
        dateOfBirth: member.dateOfBirth || null,
      };
    });

    const filteredColleagues = colleagues.filter((c) => c.email !== employeeEmail);

    const currentMonth = new Date().getMonth();
    const upcomingBirthdays = filteredColleagues
      .filter((c) => c.dateOfBirth && new Date(c.dateOfBirth).getMonth() === currentMonth)
      .sort((a, b) => new Date(a.dateOfBirth).getDate() - new Date(b.dateOfBirth).getDate());

    res.json({
      success: true,
      colleagues: filteredColleagues,
      upcomingBirthdays,
      total: filteredColleagues.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

/* GET: Analytics - Asset types distribution */
app.get("/analytics/asset-types",verifyFirebaseToken, async (req, res) => {
  try {
    const { hrEmail } = req.query;
    const { assetCollection } = await getCollections();

    const query = hrEmail ? { hrEmail } : {};

    const pipeline = [
      { $match: query },
      { $group: { _id: "$productType", count: { $sum: 1 } } },
    ];

    const result = await assetCollection.aggregate(pipeline).toArray();

    const distribution = { Returnable: 0, "Non-returnable": 0 };
    result.forEach((item) => (distribution[item._id] = item.count));

    res.json({ success: true, data: distribution });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/* GET: Analytics - Top 5 most requested assets */
app.get("/analytics/top-requested", async (req, res) => {
  try {
    const { hrEmail } = req.query;
    const { requestCollection } = await getCollections();

    const pipeline = [
      { $match: hrEmail ? { hrEmail } : {} },
      { $group: { _id: "$assetName", requestCount: { $sum: 1 } } },
      { $sort: { requestCount: -1 } },
      { $limit: 5 },
    ];

    const result = await requestCollection.aggregate(pipeline).toArray();

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/* PATCH: Direct asset assignment by HR */
app.patch("/direct-assign",verifyFirebaseToken, async (req, res) => {
  try {
    const { hrEmail, employeeEmail, assetId } = req.body;

    if (!hrEmail || !employeeEmail || !assetId) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const {
      userCollection,
      employeeAffiliationsCollection,
      assetCollection,
      assignedAssetsCollection,
    } = await getCollections();

    const hrUser = await userCollection.findOne({ email: hrEmail, role: "HR" });
    if (!hrUser) return res.status(403).json({ success: false, message: "Unauthorized" });

    const affiliation = await employeeAffiliationsCollection.findOne({
      hrEmail,
      employeeEmail,
      status: "active",
    });
    if (!affiliation) return res.status(403).json({ success: false, message: "Employee not in your team" });

    const asset = await assetCollection.findOne({ _id: new ObjectId(assetId), hrEmail });
    if (!asset || asset.availableQuantity <= 0) {
      return res.status(400).json({ success: false, message: "Asset not available" });
    }

    const existingAssignment = await assignedAssetsCollection.findOne({
      assetId: new ObjectId(assetId),
      employeeEmail,
      status: "assigned",
    });
    if (existingAssignment) {
      return res.status(409).json({ success: false, message: "Asset already assigned to this employee" });
    }

    await assetCollection.updateOne(
      { _id: new ObjectId(assetId) },
      { $inc: { productQuantity: -1, availableQuantity: -1 } }
    );

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

    res.json({ success: true, message: "Asset assigned directly" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to assign asset" });
  }
});

/* GET : Geting pakage information */
app.get("/packages", verifyFirebaseToken , async(req, res) => {
  try {
    const { pakageCollections } = await getCollections();
    const pakages = await pakageCollections.find({}).toArray();
    res.status(200).json(pakages);
  }
  catch {
    res.status(500).json({
        message: "Failed to fetch plans",
        error: error.message
      });
  }
})



app.get("/packages/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { pakageCollections } = await getCollections();
    const { id } = req.params;

    // validate MongoDB ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid package ID" });
    }

    const query = { _id: new ObjectId(id) };
    const packageData = await pakageCollections.findOne(query);

    if (!packageData) {
      return res.status(404).json({ message: "Package not found" });
    }

    res.status(200).json(packageData);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch package",
      error: error.message,
    });
  }
});

app.post("/payment-checkout-session", async (req, res) => {
  const paymentInfo = req.body;
  const {hrEmail, id} = paymentInfo;
  const { pakageCollections } = await getCollections();
  const query = { _id: new ObjectId(id) };
  const packageData = await pakageCollections.findOne(query);
  const {name , price, employeeLimit} = packageData


  const session = await stripe.checkout.sessions.create(
    {
    line_items: [
      {
        price_data : {
          currency : 'USD',
          unit_amount : price * 100,
          product_data : {
            name : name,



          }
        },
        
        quantity: 1,
      },
    ],
    customer_email :hrEmail,
    mode: 'payment',
    metadata : {

      package_id : id,
      employee_limit : employeeLimit


    },
    success_url: `${process.env.DOMAIN}/dashboard/hr/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.DOMAIN}/dashboard/hr/payment-cancel`,
  }
  )
  console.log(session);
  res.send({ url: session.url });

})

app.patch("/payment-success", async (req, res) => {
  try {
    const sessionID = req.query.session_id;
    if (!sessionID) {
      return res.status(400).json({ message: "Session ID missing" });
    }

    // 🔐 Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionID);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ message: "Payment not completed" });
    }

    const hrEmail = session.customer_email;
    const package_id = session.metadata.package_id;

    const {
      pakageCollections,
      userCollection,
      paymentCollection,
    } = await getCollections();

    // 🔍 Get package info
    const packageData = await pakageCollections.findOne({
      _id: new ObjectId(package_id),
    });

    if (!packageData) {
      return res.status(404).json({ message: "Package not found" });
    }

    const { name, price, employeeLimit } = packageData;

    // 🚫 DUPLICATE PAYMENT CHECK
    const existingPayment = await paymentCollection.findOne({
      hrEmail,
      packageName: name,
      status: "completed",
    });

    if (existingPayment) {
      return res.status(409).json({
        message: "You already paid for this package",
      });
    }

    // 💾 STORE PAYMENT TRANSACTION
    await paymentCollection.insertOne({
      hrEmail,
      packageName: name,
      employeeLimit,
      amount: price,
      transactionId: session.id,
      paymentDate: new Date(),
      status: "completed",
    });

    // 🔄 UPDATE USER SUBSCRIPTION
    await userCollection.updateOne(
      { email: hrEmail },
      {
        $set: {
          subscription: name,
          packageLimit: employeeLimit,
        },
      }
    );

    return res.json({
      success: true,
      message: "Payment successful & subscription updated",
    });
  } catch (error) {
    console.error("Payment success error:", error);
    return res.status(500).json({
      success: false,
      message: "Payment processing failed",
    });
  }
});

module.exports = app;

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
