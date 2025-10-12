// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ObjectId } = require("mongodb");
// const bodyParser = require("body-parser");
// const fs = require("fs");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

const moment = require('moment-timezone');

// Middleware
app.use(cors());
// app.use(express.json());

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));


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
    const usersQuestionsCollection = db.collection("collections");
    const onlineExamCollections = db.collection("online_exam_collections");
    const examResponsesCollection = db.collection("online_exam_response_collections");
    

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

    // POST usersCreatedQuestions
    app.post("/collections", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const { name, questions, createdAt } = req.body;

    if (!name || !questions || typeof questions !== "object") {
      return res.status(400).json({ message: "Invalid collection data" });
    }

    const newCollection = {
      userEmail: email,
      name,
      questions,
      createdAt: createdAt || new Date().toISOString(),
    };

    const result = await usersQuestionsCollection.insertOne(newCollection);

    res.status(201).json({
      message: "Collection saved successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("❌ Error saving collection:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// GET usersCreatedQuestions
app.get("/collections", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;

    const collections = await usersQuestionsCollection
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(collections);
  } catch (error) {
    console.error("❌ Error fetching collections:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// inside run(), after defining collectionCollection
app.get("/collections/:id", verifyFireBaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.decoded.email;

    const objId = new ObjectId(id);
    const coll = await usersQuestionsCollection.findOne({
      _id: objId,
      userEmail: email,
    });

    if (!coll) {
      return res.status(404).json({ message: "Not found or not allowed" });
    }

    res.json(coll);
  } catch (err) {
    console.error("Error fetching collection:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// DELETE /collections/:id
app.delete("/collections/:id", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const collId = req.params.id;

    // Validate ObjectId
    if (!ObjectId.isValid(collId)) {
      return res.status(400).json({ message: "Invalid collection ID format" });
    }

    const result = await usersQuestionsCollection.deleteOne({
      _id: new ObjectId(collId),
      userEmail: email  // ensure user only deletes their own
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Collection not found or not your own" });
    }
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Error deleting collection:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// ✅ POST /online-exam-collections
app.post("/online-exam-collections", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const { name, questions, createdAt } = req.body;

    if (!name || !questions || typeof questions !== "object") {
      return res.status(400).json({ message: "Invalid collection data" });
    }

    const newCollection = {
      name,
      questions,
      createdBy: email,
      createdAt: createdAt || new Date().toISOString(),
    };

    const result = await onlineExamCollections.insertOne(newCollection);

    res.status(201).json({
      message: "Online Exam Collection saved successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("❌ Error saving online exam collection:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ✅ GET /online-exam-collections
app.get("/online-exam-collections", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const collections = await onlineExamCollections
      .find({ createdBy: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(collections);
  } catch (err) {
    console.error("❌ Error fetching online exam collections:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ✅ GET /online-exam-collections/:id
app.get("/online-exam-collections/:id", verifyFireBaseToken, async (req, res) => {
  const collectionId = req.params.id;

  try {
    const email = req.decoded.email;

    const collection = await onlineExamCollections.findOne({
      _id: new ObjectId(collectionId),
      createdBy: email, // Optional: to ensure the user owns this collection
    });

    if (!collection) {
      return res.status(404).json({ message: "Collection not found" });
    }

    res.json(collection);
  } catch (err) {
    console.error("❌ Error fetching exam collection by ID:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
// ✅ GET /public-exam/:id
app.get("/public-exam/:id", async (req, res) => {
  const  id = req.params.id;

  try {

    // Fetch exam from collection
    const exam = await onlineExamCollections.findOne({
      _id: new ObjectId(id)
    });

    if (!exam) {
      return res.status(404).json({ error: "Exam not found" });
    }

    // // Combine startDate and startTime into a single Date object
    // const startDateTime = new Date(`${exam.startDate}T${exam.startTime}:00`);
    // const endDateTime = new Date(`${exam.endDate}T${exam.endTime}:00`);

    // const now = new Date();

    // ✅ Treat exam start and end as Bangladesh time (Asia/Dhaka)
    const startDateTime = moment.tz(`${exam.startDate} ${exam.startTime}`, "YYYY-MM-DD HH:mm", "Asia/Dhaka");
    const endDateTime = moment.tz(`${exam.endDate} ${exam.endTime}`, "YYYY-MM-DD HH:mm", "Asia/Dhaka");

    const now = moment.tz("Asia/Dhaka"); // ✅ Use same timezone for now


    let questionsToSend = {};

    if (now >= startDateTime && now <= endDateTime) {
      // Extract and flatten all questions from exam
      const allQuestions = Object.values(exam.questions || {}).flat();

      // Simplify questions to include only text and options
      questionsToSend = allQuestions.map((q) => ({
        question_id: q?._id,
        text: q?.question?.text || [],
        image: q?.question?.image || [],
        options: (q?.options || []).map((opt) => ({
          label: opt.label,
          text: opt.text,
          image: opt.image || "",
        })),
      }));
    } else {
      // Before start time: send only question count as a number
      const allQuestions = Object.values(exam.questions || {}).flat();
      questionsToSend = allQuestions.length; // send number of questions
    }

    // Build final response: full exam object but override `questions`
    const response = {
      ...exam,
      questions: questionsToSend,
      isLive: now.isBetween(startDateTime, endDateTime), // Optional for frontend
    };

    return res.json(response);
  } catch (error) {
    console.error("❌ Error loading public exam:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /online-exam-collections/:id
app.patch("/online-exam-collections/:id", verifyFireBaseToken, async (req, res) => {
  try {
    const collectionId = req.params.id;
    const email = req.decoded.email;
    const updateData = req.body;

    const result = await onlineExamCollections.updateOne(
      { _id: new ObjectId(collectionId), createdBy: email },
      { $set: updateData }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "Collection not found or not updated" });
    }

    res.status(200).json({ message: "Collection updated successfully" });
  } catch (err) {
    console.error("❌ Error updating collection:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ✅ POST /exam-responses/submit
app.post("/exam-responses/submit", verifyFireBaseToken, async (req, res) => {
  try {
    const studentEmail = req.decoded.email;
    const {
      examId,
      examName,
      studentName,
      answers,
      durationTaken,
    } = req.body;

    if (!examId || !studentName || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: "Invalid exam response data" });
    }

    // 1. Save exam response to a new collection
    const responseDoc = {
      examId,
      examName,
      studentName,
      studentEmail,
      answers,
      durationTaken,
      submittedAt: new Date().toISOString(),
    };

    const saveResponse = await examResponsesCollection.insertOne(responseDoc);

    // 2. Update the original exam collection to add student email to completedStudents
    await onlineExamCollections.updateOne(
      { _id: new ObjectId(examId) },
      { $addToSet: { completedStudents: studentEmail } } // avoids duplicates
    );

    res.status(201).json({
      message: "✅ Exam submitted and recorded successfully.",
      insertedId: saveResponse.insertedId,
    });
  } catch (error) {
    console.error("❌ Error submitting exam response:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// ✅ GET /exam-responses/student?email=someone@gmail.com
app.get("/exam-responses/student", verifyFireBaseToken, async (req, res) => {
  const studentEmail = req.query.email;

  if (!studentEmail) {
    return res.status(400).json({ message: "Missing email" });
  }

  try {
    const responses = await examResponsesCollection
      .find({ studentEmail })
      .sort({ submittedAt: -1 })
      .toArray();

    // Optionally populate exam name if needed from onlineExamCollections
    // or store it in responses during submission for faster access.

    res.json(responses);
  } catch (err) {
    console.error("❌ Failed to fetch student exam responses:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// ✅ GET /online-exam/:id  for show result
app.get("/online-exam/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "Missing exam ID" });
  }

  try {
    const exam = await onlineExamCollections.findOne({ _id: new ObjectId(id) });

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    res.status(200).json(exam);
  } catch (error) {
    console.error("❌ Error fetching exam by ID:", error);
    res.status(500).json({ message: "Internal Server Error" });
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
      group,
      class: cls,
      subject,
      chapter,
      topic,
      medium,
      questionType,
    } = req.query;

    const query = {};

    // ✅ only add if value is not empty
    const addField = (field, value) => {
      if (value && value.trim() !== "") {
        query[field] = value.trim();
      }
    };

    addField("group", group);
    addField("class", cls);
    addField("subject", subject);
    addField("chapter", chapter);
    addField("topic", topic);
    addField("medium", medium);
    addField("questionType", questionType);
    
    console.log("🔍 Final Query:", query);

    const questions = await mcqCollection.find(query).toArray();
    res.json(questions);
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// ✅ GET /api/questions/by-chapter?name=গতি
app.get("/api/questions/by-chapter",  async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ error: "Chapter name is required" });
    }

    const questions = await mcqCollection.find({ chapter: name }).toArray();

    res.json({
      count: questions.length,
      data: questions,
    });
  } catch (error) {
    console.error("❌ Error fetching questions by chapter:", error);
    res.status(500).json({ message: "Internal Server Error" });
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
  console.log(`✅ Server listening on port http://localhost:${port}`);
});
