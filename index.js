// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
// const bodyParser = require("body-parser");
// const fs = require("fs");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const uri =
  "mongodb+srv://mcq_bank:Gp59B5sBd4OcbUAf@cluster0.zmtgsgq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

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

    // Replace both GET endpoints with this single one:
app.get("/api/questions", async (req, res) => {
  try {
    const {
      group,
      class: cls,
      subject,
      chapter,
      topic,
      difficulty,
      medium,
      search
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
        { explanation: searchRegex }
      ];
    }

    const questions = await mcqCollection.find(query).toArray();
    res.json(questions);
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});


// app.post("/api/questions/filter", async (req, res) => {
//   try {
//     const { class: cls, subject, chapter, difficulty, medium, search } = req.body;

//     console.log(req.body);

//     const query = {};

//     if (cls) query.class = cls;
//     if (subject) query.subject = subject;
//     if (chapter) query.chapter = chapter;
//     if (difficulty) query.difficulty = difficulty;
//     if (medium) query.medium = medium;

//     if (search) {
//       const searchRegex = new RegExp(search, "i");
//       query.$or = [
//         { question: searchRegex },
//         { subject: searchRegex },
//         { chapter: searchRegex },
//         { topic: searchRegex },
//         { tags: searchRegex },
//         { explanation: searchRegex },
//       ];
//     }

//     const questions = await mcqCollection.find(query).toArray();
//     res.json(questions);
//   } catch (error) {
//     console.error("Error fetching questions:", error);
//     res.status(500).json({ error: "Failed to fetch questions" });
//   }
// });


    // GET all questions
    // app.get("/api/questions", async (req, res) => {
    //   try {
    //     const questions = await mcqCollection.find().toArray();
    //     res.json(questions);
    //   } catch (error) {
    //     res.status(500).json({ error: "Failed to fetch questions" });
    //   }
    // });

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
    const { class: cls, subject, chapter, difficulty, medium, search } = req.query;

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
        { explanation: searchRegex }
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
