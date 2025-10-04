// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
// const bodyParser = require("body-parser");
// const fs = require("fs");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

// const serviceAccount = require("./firebase-question-paper-builder.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const uri = `mongodb+srv://${process.env.DB_ADMIN}:${process.env.DB_PASS}@cluster0.zmtgsgq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("mcq_bank"); // Database
    const mcqCollection = db.collection("questions"); // Collection
    const userCollection = db.collection("users");
    const transactionCollection = db.collection("transactions");


    const verifyFireBaseToken = async (req, res, next) => {
      // console.log("token in the middleware", req.headers);

      const authHeader = req.headers?.authorization;

      if (!authHeader?.startsWith("Bearer ")) {
        return res
          .status(401)
          .send({ error: "Unauthorized access - no token" });
      }

      const token = authHeader.split(" ")[1];

      if (!token) {
        return res
          .status(401)
          .send({ error: "Unauthorized access - no token" });
      }

      try {
        const decodedUser = await admin.auth().verifyIdToken(token);
        req.decoded = decodedUser;
        next();
      } catch (error) {
        return res.status(403).send({ error: "Forbidden - invalid token" });
      }

      //   next();
    };

    // Replace both GET endpoints with this single one:
    app.get("/api/questions", verifyFireBaseToken,    async (req, res) => {
      try {
        const {
          group,
          class: cls,
          subject,
          chapter,
          topic,
          difficulty,
          medium,
          search,
        } = req.query;

        console.log("Incoming query:", req.query);

        const query = {};

        if (group) query.group = group;
        if (cls) query.class = cls;
        if (subject) query.subject = subject;
        if (chapter) query.chapter = chapter;
        if (topic) query.topic = topic;
        if (difficulty) query.difficulty = difficulty;
        if (medium) query.medium = medium;

        if (search) {
          const searchRegex = new RegExp(search, "i");
          query.$or = [
            { question: searchRegex },
            { subject: searchRegex },
            { chapter: searchRegex },
            { topic: searchRegex },
            { tags: searchRegex },
            { explanation: searchRegex },
          ];
        }

        const questions = await mcqCollection.find(query).toArray();
        res.json(questions);
      } catch (error) {
        console.error("Error fetching questions:", error);
        res.status(500).json({ error: "Failed to fetch questions" });
      }
    });

   
    app.post("/users", async (req, res) => {
      const user = req.body;
      const { email } = user;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      // Check if user already exists
      const existingUser = await userCollection.findOne({ email });

      if (existingUser) {
        return res.send({ message: "User already exists", inserted: false });
      }

      // Set default role if not provided
      user.role = user.role || "user";

      const result = await userCollection.insertOne(user);
      res.send({
        message: "User created",
        inserted: true,
        userId: result.insertedId,
      });
    });

    app.get("/users/referral-exists/:code", async (req, res) => {
      const { code } = req.params;
        
      if (!code) {
        return res.status(400).send({ error: "Referral code is required" });
      }
    
      try {
        const existing = await userCollection.findOne({ referral_link: code });
        res.send({ exists: !!existing });
      } catch (error) {
        console.error("Error checking referral code:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // Get currently logged-in user
app.get("/users/me", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email; // decoded by Firebase token

    if (!email) {
      return res.status(400).json({ error: "Email not found in token" });
    }

    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});


// PATCH /users/deduct-balance
app.patch("/users/deduct-balance", verifyFireBaseToken, async (req, res) => {
  try {
    const { amount, details } = req.body;
    const userEmail = req.decoded.email; // ✅ correct field from Firebase token

    if (!userEmail) {
      return res.status(400).json({ message: "Email not found in token" });
    }

    const user = await userCollection.findOne({ email: userEmail });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.wallet_balance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await userCollection.updateOne(
      { email: userEmail },
      { $inc: { wallet_balance: -amount } }
    );

    // Log transaction
    const transaction = {
      email: userEmail,
      amount,
      type: "purchase",
      details: details || {},
      balanceAfter: user.wallet_balance - amount,
      createdAt: new Date().toISOString(),
    };

    await transactionCollection.insertOne(transaction);

    res.json({ message: "Balance deducted successfully" });
  } catch (error) {
    console.error("❌ Deduct balance error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// GET /transactions (fetch transactions for logged-in user)
app.get("/transactions", verifyFireBaseToken, async (req, res) => {
  try {
    const userEmail = req.decoded.email;

    const transactions = await transactionCollection
      .find({ email: userEmail })
      .sort({ createdAt: -1 }) // newest first
      .toArray();

    res.json(transactions);
  } catch (error) {
    console.error("❌ Fetch transactions error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


    // POST new question
    app.post("/api/questions", async (req, res) => {
      const payload = req.body;
      console.log(payload);

      // ✅ allow SmartQuestionBuilder structure
      if (!payload || (!payload.question && !payload.questionData)) {
        return res.status(400).json({ error: "Invalid question data" });
      }

      try {
        const result = await mcqCollection.insertOne(payload);
        res.status(201).json({
          message: "Question saved successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to save question" });
      }
    });

    // GET /api/questions with filters
    app.get("/questions", async (req, res) => {
      try {
        const {
          class: cls,
          subject,
          chapter,
          difficulty,
          medium,
          search,
        } = req.query;

        console.log(req.query);

        const query = {};

        if (cls) query.class = cls;
        if (subject) query.subject = subject;
        if (chapter) query.chapter = chapter;
        if (difficulty) query.difficulty = difficulty;
        if (medium) query.medium = medium;

        if (search) {
          const searchRegex = new RegExp(search, "i");
          query.$or = [
            { question: searchRegex },
            { subject: searchRegex },
            { chapter: searchRegex },
            { topic: searchRegex },
            { tags: searchRegex },
            { explanation: searchRegex },
          ];
        }

        const questions = await mcqCollection.find(query).toArray();
        res.json(questions);
      } catch (error) {
        console.error("Error fetching questions:", error);
        res.status(500).json({ error: "Failed to fetch questions" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("mcq bank server is running.....");
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server listening on http://localhost:${port}`);
});
