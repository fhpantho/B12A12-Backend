require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 5000;
const uri = process.env.URI;

const app = express();

// Middlewares
app.use(express.json());
app.use(cors({
    origin : ["http://localhost:5173"],
    credentials : true
}));

// Routes
app.get("/", (req, res) => {
    res.send("App is running");
});



// MongoDB Client
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Run Function
async function run() {
    try {
        await client.connect(); 

        const db = client.db("AssetVerseDB");

        const userCollection = db.collection("UserInfo");


        // get user information
        app.get("/user", async (req , res) => {

            const query = {};

            const {email} = req.query;

            if(email){
                query.email = email;
            }
            const cursor = userCollection.find(query);
            const result = await cursor.toArray();
            res.send(result)
        })

        // storing user information information
        app.post("/user", async (req, res) => {
            const userInfo = req.body;

            const result = await userCollection.insertOne(userInfo);
            res.send(result)
        })


        await client.db("admin").command({ ping: 1 });
        console.log("Database connected successfully");




    } catch (error) {
        console.error("Database connection failed:", error);
    }
}
run().catch(console.dir);

// Start Server
app.listen(port, () => {
    console.log(`App is running on port: ${port}`);
});
