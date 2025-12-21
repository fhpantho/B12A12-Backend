require("dotenv").config();
const express = require("express");
const cors = require("cors");
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
        const { email, search } = req.query;
        const query = {};

        if (email) {
          query.hrEmail = email;
        } else {
          query.productQuantity = { $gt: 0 };
        }

        if (search) {
          query.productName = { $regex: search.trim(), $options: "i" };
        }

        const result = await assetCollection
          .find(query)
          .sort({ _id: -1 }) // Newest first
          .toArray();

        res.status(200).json({
          success: true,
          count: result.length,
          data: result,
        });
      } catch (error) {
        console.error("Error fetching assets:", error);
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