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
app.set("trust proxy", true);

const port = process.env.PORT || 5000;

const moment = require('moment-timezone');

// Middleware
// app.use(cors());

app.use(cors({
  origin: [
    "https://avijatra.com",
    "https://api.avijatra.com",
    "https://www.avijatra.com"
  ],
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type']
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

// const serviceAccount = require("./firebase-question-paper-builder.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// const uri = `mongodb+srv://${process.env.DB_ADMIN}:${process.env.DB_PASS}@cluster0.zmtgsgq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const uri = `mongodb://${process.env.DB_ADMIN}:${process.env.DB_PASS}@127.0.0.1:27017/${process.env.DB_NAME}?authSource=admin`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


/**
 * Sends a notification (Personal or Global)
 * @param {object} params - { userId, title, message, type, link }
 * @param {object} collections - { notificationCollection }
 */
const sendNotification = async (params, collections) => {
    const { userId, title, message, type = 'info', link = null } = params;
    const { notificationCollection } = collections;

    const notification = {
        title,
        message,
        type, // 'info', 'success', 'warning', 'error', 'global'
        link, // Optional: Link to redirect user (e.g., to payment history)
        date: new Date(),
        isRead: false,
    };

    if (userId === 'global') {
        // Global Notification: No specific userId, visible to all
        notification.target = 'global';
        delete notification.userId; 
        // We don't track 'isRead' for global here generally, or handle it differently
    } else {
        // Individual Notification
        notification.userId = userId; // String ID
        notification.target = 'individual';
    }

    try {
        const result = await notificationCollection.insertOne(notification);
        return { success: true, id: result.insertedId };
    } catch (error) {
        console.error("Notification Error:", error);
        return { success: false, error };
    }
};


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
    const modelTestsCollection = db.collection("model_tests");
    const examResultsCollection = db.collection("model_tests_results");
    const paymentCollection = db.collection("payment_requests");
    const notificationCollection = db.collection("notifications");
    
    // Firebase Token Verification Middleware
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


    // Add this AFTER verifyFireBaseToken
    // Admin Role Verification Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email: email });

      // Check if role is teacher OR coaching_center OR admin
      if ( user?.role === 'admin' || user?.role === 'moderator') {
        next();
      } else {
        return res.status(403).send({ error: "Forbidden access: Teachers only" });
      }
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
            // ১. প্রশ্নের টেক্সট খুঁজবে (Dot notation জরুরি)
            { "question.text": searchRegex },
            
            // ২. অপশনের টেক্সট খুঁজবে (MongoDB অটোমেটিক অ্যারের ভেতর খুঁজবে)
            { "options.text": searchRegex },
            
            // ৩. সলিউশন খুঁজবে
            { "solution.text": searchRegex },
            { "explanation.text": searchRegex },
            { subject: searchRegex },
            { chapter: searchRegex },
            { topic: searchRegex },
            { tags: searchRegex },
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


// ✅ GET /public-exam/:id (Protected: Requires Login for EVERYONE)
app.get("/public-exam/:id", verifyFireBaseToken, async (req, res) => {
  const id = req.params.id;
  const userEmail = req.decoded.email; // ✅ Available because middleware verifies token first

  try {
    // 1. Fetch exam from collection
    const exam = await onlineExamCollections.findOne({
      _id: new ObjectId(id)
    });

    if (!exam) {
      return res.status(404).json({ error: "Exam not found" });
    }

    // 🔒 2. PRIVACY CHECK (Only for Private Exams)
    // Since middleware passed, we know they are logged in. Now check if they are allowed.
    if (exam.settings?.accessType === "private") {
      const allowedList = exam.settings.allowedEmails || [];
      
      // Allow Creator OR Whitelisted Emails
      if (userEmail !== exam.createdBy && !allowedList.includes(userEmail)) {
        return res.status(403).json({ 
          error: "Access Denied: You are not in the allowed list for this private exam." 
        });
      }
    }

    // 3. Time & Logic Setup (Asia/Dhaka)
    const startDateTime = moment.tz(`${exam.startDate} ${exam.startTime}`, "YYYY-MM-DD HH:mm", "Asia/Dhaka");
    const endDateTime = moment.tz(`${exam.endDate} ${exam.endTime}`, "YYYY-MM-DD HH:mm", "Asia/Dhaka");
    const now = moment.tz("Asia/Dhaka");

    let questionsToSend = {};
    let isExamStarted = false;

    // 4. Question Logic
    if (now >= startDateTime && now <= endDateTime) {
      isExamStarted = true;
      
      // Extract and flatten all questions
      const allQuestions = Object.values(exam.questions || {}).flat();

      // Simplify questions (Hide correct answers/solutions)
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
      // Before start time or after end time: Send only count (security best practice)
      const allQuestions = Object.values(exam.questions || {}).flat();
      questionsToSend = allQuestions.length; 
    }

    // 5. Build Final Response
    const response = {
      _id: exam._id,
      name: exam.name,
      duration: exam.duration,
      description: exam.description,
      instructions: exam.instructions,
      warnings: exam.warnings,
      startDate: exam.startDate,
      startTime: exam.startTime,
      endDate: exam.endDate,
      endTime: exam.endTime,
      
      // Send Settings & Completed Students list for frontend logic
      settings: exam.settings, 
      completedStudents: exam.completedStudents || [], 

      questions: questionsToSend,
      isLive: now.isBetween(startDateTime, endDateTime),
      isExamStarted: isExamStarted,
      currentUser: userEmail // Optional: confirming who is viewing
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

// ✅ GET /exam-responses/all/:examId - Fetch all responses for leaderboard
app.get("/exam-responses/all/:examId", async (req, res) => {
  const examId = req.params.examId;

  try {
    // No auth required if public leaderboard, otherwise add verifyFireBaseToken
    // Fetch all responses matching the examId
    const responses = await examResponsesCollection
      .find({ examId: examId })
      .sort({ submittedAt: 1 }) // Sort logic happens mostly on frontend for ranks
      .toArray();

    res.json(responses);
  } catch (err) {
    console.error("❌ Error fetching exam responses:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// ✅ DELETE /online-exam-collections/:id
app.delete("/online-exam-collections/:id", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const id = req.params.id;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    // Delete from the correct collection (onlineExamCollections)
    // Make sure to match the user field (usually 'createdBy' for exams based on your previous codes)
    const result = await onlineExamCollections.deleteOne({
      _id: new ObjectId(id),
      createdBy: email // Ensure user only deletes their own exam
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Exam not found or not authorized" });
    }

    res.json({ message: "Exam deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting exam:", err);
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
      negativeMarks,
      marksPerQuestion,
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
      negativeMarks,
      marksPerQuestion,
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


// POST: Save a new transaction
app.post("/transactions", async (req, res) => {
    try {
        const transaction = req.body;
        
        // Basic validation
        if (!transaction.email || !transaction.amount) {
            return res.status(400).send({ message: "Invalid transaction data" });
        }

        const result = await transactionCollection.insertOne(transaction);
        // 2. ✅ NEW: Send Notification if Saved Successfully
        if (result.insertedId && transaction.userId) {
            
            let title = "Transaction Alert 🔔";
            let message = `Transaction of ${transaction.amount} BDT successful.`;
            let type = "info";

            // Customize message based on category (from your frontend logic)
            if (transaction.details?.category === 'welcome_bonus') {
                title = "Welcome Gift! 🎁";
                message = `You received ${transaction.amount} BDT as a Welcome Bonus!`;
                type = "success";
            } 
            else if (transaction.type === 'credit') {
                title = "Wallet Credited 💰";
                message = `Your account has been credited with ${transaction.amount} BDT.`;
                type = "success";
            }

            // Create Notification Object
            const notification = {
                userId: transaction.userId, // Link to the specific user
                title: title,
                message: message,
                type: type, 
                link: "/profile", // Redirect user to wallet when clicked
                date: new Date(),
                isRead: false
            };

            // Insert into DB
            await notificationCollection.insertOne(notification);
        }

        res.send(result);
    } catch (error) {
        console.error("Transaction Error:", error);
        res.status(500).send({ message: "Failed to save transaction" });
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


// ✅ PATCH /users/student-profile
// Updates the user with group, division, and batch info
app.patch("/users/student-profile", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const profileData = req.body; // { group, division, batch, class }

    const filter = { email: email };
    const updateDoc = {
      $set: {
        studentProfile: profileData, // We save it under a specific field
        isStudentProfileComplete: true
      },
    };

    const result = await userCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});



// ✅ GET /api/practice-stats (Fixed: Nested vs Standard Grouping)
app.get("/api/practice-stats", verifyFireBaseToken, async (req, res) => {
  try {
    const { subject } = req.query;
    const email = req.decoded.email;

    if (!subject) return res.status(400).send({ message: "Subject required" });

    // 1. Determine Grouping Mode
    // If Bangla 1st Paper, we use "nested" mode (Chapter -> Topics)
    const isNestedMode = subject.includes("বাংলা ১ম পত্র");
    
    // 2. Fetch User to check Group (Admission logic)
    const user = await userCollection.findOne({ email: email });
    const userGroup = user?.studentProfile?.group;

    // 3. Build Match Query
    const matchQuery = {
      subject: subject,
      questionType: "বহুনির্বাচনি প্রশ্ন"
    };

    if (userGroup === "Admission") {
      matchQuery.$or = [
        { tags: "Admission Exam Question" },
        { source: "Admission Exam Question" }
      ];
    }

    let stats = {};

    if (isNestedMode) {
        // =================================================
        // 🅰️ NESTED MODE (Group by Chapter -> then Topic)
        // =================================================
        
        // 1. Total Counts Pipeline (Nested)
        const totalPipeline = [
            { $match: matchQuery },
            // First group by unique Chapter+Topic combo
            { 
                $group: { 
                    _id: { chapter: "$chapter", topic: "$topic" }, 
                    count: { $sum: 1 } 
                } 
            },
            // Then group by Chapter to create the array of topics
            {
                $group: {
                    _id: "$_id.chapter",
                    chapterTotal: { $sum: "$count" },
                    topics: { 
                        $push: { 
                            name: "$_id.topic", 
                            total: "$count",
                            completed: 0 // Initialize as 0
                        } 
                    }
                }
            }
        ];
        const totalCounts = await mcqCollection.aggregate(totalPipeline).toArray();

        // Initialize Stats Object
        totalCounts.forEach(item => {
            if (item._id) {
                stats[item._id] = { 
                    total: item.chapterTotal, 
                    completed: 0, 
                    topics: item.topics 
                };
            }
        });

        // 2. User Progress Pipeline (Nested)
        const progressPipeline = [
            { $match: { userEmail: email, subject: subject } },
            // Group user history by Chapter+Topic
            { 
                $group: { 
                    _id: { chapter: "$chapter", topic: "$topic" }, 
                    count: { $sum: 1 } 
                } 
            }
        ];
        const userProgress = await db.collection("practice_history").aggregate(progressPipeline).toArray();

        // 3. Merge Progress into Stats
        userProgress.forEach(h => {
            const chapterName = h._id.chapter;
            const topicName = h._id.topic;
            const solvedCount = h.count;

            if (stats[chapterName]) {
                // Update Chapter Total Completed
                stats[chapterName].completed += solvedCount;

                // Update Specific Topic Completed
                const topicObj = stats[chapterName].topics.find(t => t.name === topicName);
                if (topicObj) {
                    topicObj.completed = solvedCount;
                }
            }
        });

    } else {
        // =================================================
        // 🅱️ STANDARD MODE (Group by Chapter Only)
        // =================================================

        // 1. Total Counts Pipeline (Standard)
        const totalPipeline = [
            { $match: matchQuery }, 
            { $group: { _id: "$chapter", count: { $sum: 1 } } }
        ];
        const totalCounts = await mcqCollection.aggregate(totalPipeline).toArray();

        // Initialize Stats Object
        totalCounts.forEach(item => {
            if (item._id) { 
                stats[item._id] = { total: item.count, completed: 0 };
            }
        });

        // 2. User Progress Pipeline (Standard)
        const progressPipeline = [
            { $match: { userEmail: email, subject: subject } },
            { $group: { _id: "$chapter", count: { $sum: 1 } } }
        ];
        const userProgress = await db.collection("practice_history").aggregate(progressPipeline).toArray();

        // 3. Merge Progress
        userProgress.forEach(item => {
            if (stats[item._id]) {
                stats[item._id].completed = item.count;
            }
        });
    }

    res.send({
        stats: stats,
        groupedBy: isNestedMode ? "nested" : "chapter"
    });

  } catch (error) {
    console.error("Error fetching practice stats:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});




// ✅ GET /api/practice-questions (Updated for Topic Support)
app.get("/api/practice-questions", verifyFireBaseToken, async (req, res) => {
  try {
    // 1. Extract 'topic' from query
    const { subject, chapter, topic } = req.query; 
    const email = req.decoded.email;

    if (!subject || !chapter) {
      return res.status(400).send({ message: "Subject and Chapter required" });
    }

    // 2. Get User Group
    const user = await userCollection.findOne({ email });
    const userGroup = user?.studentProfile?.group;

    // 3. Build Query
    const query = {
      subject: subject,
      chapter: chapter,
      questionType: "বহুনির্বাচনি প্রশ্ন"
    };

    // ✅ NEW: If topic is provided (e.g., Bangla 1st), filter by it
    if (topic) {
        query.topic = topic;
    }

    // 🔒 Admission Filter Logic
    if (userGroup === "Admission") {
      query.$or = [
        { tags: "Admission Exam Question" },
        { source: "Admission Exam Question" }
      ];
    }

    // 4. Fetch Questions (Now filtered by Topic if applicable)
    const questions = await mcqCollection.find(query)
      .sort({ _id: 1 }) 
      .toArray();

    // 5. Calculate Stats (Specific to this Chapter OR Topic)
    
    // Build the match object for history
    const historyMatch = { 
        userEmail: email, 
        subject: subject, 
        chapter: chapter 
    };

    // ✅ NEW: If practicing a topic, only count history for that topic
    // This ensures "Resume" starts at Q1 for 'Topic A' even if you finished 'Topic B'
    if (topic) {
        historyMatch.topic = topic;
    }

    const stats = await db.collection("practice_history").aggregate([
        { $match: historyMatch },
        { 
            $group: { 
                _id: null, 
                totalAttempts: { $sum: 1 }, 
                totalCorrect: { $sum: { $cond: ["$isCorrect", 1, 0] } },
                totalWrong: { $sum: { $cond: ["$isCorrect", 0, 1] } } 
            } 
        }
    ]).toArray();

    const resultStats = stats.length > 0 ? stats[0] : { totalAttempts: 0, totalCorrect: 0, totalWrong: 0 };

    res.send({
        questions: questions,
        lastIndex: resultStats.totalAttempts, 
        prevCorrect: resultStats.totalCorrect,
        prevWrong: resultStats.totalWrong      
    });

  } catch (error) {
    console.error("Error fetching practice questions:", error);
    res.status(500).send({ message: "Server Error" });
  }
});

// ✅ POST /api/save-progress
app.post("/api/save-progress", verifyFireBaseToken, async (req, res) => {
  try {
    // ✅ Extract 'topic' here
    const { questionId, subject, chapter, topic, isCorrect } = req.body; 
    const email = req.decoded.email;

    const practiceHistory = db.collection("practice_history");

    const filter = { userEmail: email, questionId: questionId };
    
    const updateDoc = {
      $set: {
        userEmail: email,
        questionId: questionId,
        subject: subject,
        chapter: chapter,
        topic: topic || null, // ✅ Save topic (or null if standard chapter)
        isCorrect: isCorrect, 
        lastAttemptedAt: new Date()
      },
      $inc: { attempts: 1 } 
    };

    await practiceHistory.updateOne(filter, updateDoc, { upsert: true });

    res.send({ success: true });
  } catch (error) {
    console.error("Error saving progress:", error);
    res.status(500).send({ message: "Failed to save progress" });
  }
});



// ✅ PATCH /users/update-profile
// Updates User Personal Info + Student Profile
app.patch("/users/update-profile", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const { 
      name, mobile, DOB, gender, district, thana, 
      studentProfile // Nested object { group, division, batch, class }
    } = req.body;

    const filter = { email: email };
    
    // Construct the update object dynamically
    const updateDoc = {
      $set: {
        name,
        mobile,
        DOB,
        gender,
        district,
        thana,
        // If studentProfile is provided, update it. 
        // This ensures we don't accidentally wipe it if it's missing in the request.
        ...(studentProfile && { studentProfile: studentProfile }),
        ...(studentProfile && { isStudentProfileComplete: true })
      },
    };

    const result = await userCollection.updateOne(filter, updateDoc);
    
    if (result.modifiedCount > 0) {
      res.send({ success: true, message: "Profile updated successfully" });
    } else {
      res.send({ success: false, message: "No changes made" });
    }

  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});


// ✅ GET /api/user-stats
// Returns total questions solved, total correct, etc.
app.get("/api/user-stats", verifyFireBaseToken, async (req, res) => {
  try {
    const email = req.decoded.email;

    // Aggregate entire practice history for this user
    const stats = await db.collection("practice_history").aggregate([
      { $match: { userEmail: email } },
      { 
        $group: { 
          _id: null, 
          totalSolved: { $sum: 1 },
          totalCorrect: { $sum: { $cond: ["$isCorrect", 1, 0] } }
        } 
      }
    ]).toArray();

    const data = stats[0] || { totalSolved: 0, totalCorrect: 0 };

    res.send({
      totalSolved: data.totalSolved,
      totalCorrect: data.totalCorrect,
      // You can add logic for 'Daily Goal' or 'Time Spent' if you track timestamps
    });

  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).send({ message: "Server Error" });
  }
});



// ✅ POST /api/model-tests
// Description: Create a new Model Test / Exam
app.post("/api/model-tests", verifyFireBaseToken, verifyAdmin, async (req, res) => {
  try {
    const examData = req.body;

    // 1. Basic Validation
    if (!examData.title || !examData.group || !examData.questionIds || examData.questionIds.length === 0) {
      return res.status(400).send({ message: "Missing required fields or no questions selected." });
    }

    // 2. Construct the Exam Object
    // We explicitly map fields to ensure data types are correct
    const newExam = {
      title: examData.title,
      subtitle: examData.subtitle || "",
      
      // Audience & Type
      group: examData.group,         // e.g., "HSC", "Class 1 to 8"
      division: examData.division,   // e.g., "Science", "Common"
      class: examData.class || null, // e.g., "Class 9" (Specific to Class 1-8 group)
      type: examData.type,           // e.g., "subject-wise-test"
      
      // Hierarchy / Tags
      examClass: examData.examClass || null, // e.g., "HSC - 1st Year" (Specific to SSC/HSC)
      subject: examData.subject || null,
      chapter: examData.chapter || null,
      topic: examData.topic || null,

      // Metadata (Specific to Type)
      board: examData.board || null,
      institute: examData.institute || null,
      year: examData.year || null,

      // Scheduling & Grading
      startTime: new Date(examData.startTime), // Store as ISO Date Object
      endTime: new Date(examData.endTime),     // Store as ISO Date Object
      duration: parseInt(examData.duration) || 0,
      totalMarks: parseInt(examData.totalMarks) || 0,

      // Questions (Convert String IDs to ObjectIds for database references)
      questionIds: examData.questionIds.map((id) => new ObjectId(id)),
      questionCount: parseInt(examData.questionCount) || 0,

      // System Meta
      status: "active", // active, archived, draft
      createdAt: new Date(),
    };

    // 3. Insert into Database
    const result = await modelTestsCollection.insertOne(newExam);

    res.send({ success: true, insertedId: result.insertedId, message: "Exam created successfully" });

  } catch (error) {
    console.error("Error creating model test:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});




// ✅ API 1: Get Exam List (Pure Data, No User Logic)
// Matches route: /api/model-tests
app.get("/api/student/model-tests", verifyFireBaseToken, async (req, res) => {
  try {
    const { group, type } = req.query;
    let query = { status: "active" };

    if (group) query.group = group;
    if (type) query.type = type;

    const tests = await modelTestsCollection.find(query)
      .sort({ startTime: 1 })
      .toArray();

    res.send(tests);
  } catch (error) {
    console.error("Error fetching exams:", error);
    res.status(500).send({ message: "Failed to fetch exams" });
  }
});

// ✅ API 2: Get My Attempts (User Specific)
// Matches route: /api/student/exam-attempts
app.get("/api/student/exam-attempts", verifyFireBaseToken, async (req, res) => {
  try {
    if (!req.decoded || !req.decoded.email) {
        return res.status(401).send({ message: "User not authenticated" });
    }
    const studentId = req.decoded.email;

    // Return only examId and the result ID
    const attempts = await examResultsCollection.find({ studentId: studentId })
        .project({ examId: 1, _id: 1 }) 
        .toArray();

    res.send(attempts);
  } catch (error) {
    console.error("Error fetching attempts:", error);
    res.status(500).send({ message: "Failed to fetch attempts" });
  }
});



// ✅ 1. GET Single Exam Meta (For Header info)
app.get("/api/model-tests/:id", verifyFireBaseToken, async (req, res) => {
    try {
        const id = req.params.id;
        const exam = await modelTestsCollection.findOne({ _id: new ObjectId(id) });
        res.send(exam);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch exam" });
    }
});

// ✅ 2. POST Questions for Exam (For Security, fetch specific IDs only)
// Why POST? Because GET URLs have length limits, and an exam might have 100 question IDs.
app.post("/api/model-tests/questions", verifyFireBaseToken, async (req, res) => {
    try {
        const { questionIds } = req.body;
        // Convert string IDs to ObjectIds
        const objectIds = questionIds.map(id => new ObjectId(id));
        
        // Fetch questions but EXCLUDE the correct answer (security)
        const questions = await mcqCollection.find({ _id: { $in: objectIds } })
            .project({ correctOptionIndices: 0, solution: 0 }) // HIDE ANSWERS
            .toArray();
            
        // Preserve order of questions as defined in the exam
        // (Optional: mongo might return them in different order)
        const sortedQuestions = objectIds.map(id => questions.find(q => q._id.equals(id))).filter(q => q);

        res.send(sortedQuestions);
    } catch (error) {
        res.status(500).send({ message: "Failed to load questions" });
    }
});

// const { ObjectId } = require("mongodb"); // Ensure this is imported

// ✅ 3. POST Submit Exam (Fixed for MongoDB Driver v5+)
app.post("/api/exam-results/submit", verifyFireBaseToken, async (req, res) => {
    try {
        const { examId, studentId, answers, timeTaken } = req.body;

        // 1. Validation check
        if (!examId || !studentId) {
            return res.status(400).send({ message: "Missing examId or studentId" });
        }

        // 2. Fetch the Exam Metadata
        const exam = await modelTestsCollection.findOne({ _id: new ObjectId(examId) });
        if (!exam) return res.status(404).send({ message: "Exam not found" });

        // 3. Fetch Original Questions
        const questionIds = exam.questionIds.map(id => new ObjectId(id));
        const originalQuestions = await mcqCollection.find({ _id: { $in: questionIds } }).toArray();

        // 4. Grading Logic
        let correctCount = 0;
        let wrongCount = 0;
        let totalScore = 0;
        let answeredCount = 0;

        const detailedResult = [];

        originalQuestions.forEach(q => {
            const qIdStr = q._id.toString();
            const userAnsIndex = answers[qIdStr];
            
            let status = "skipped";
            const mark = parseFloat(q.priceing?.mark) || 1;
            
            // Ensure correct index is a number
            const correctAnswer = parseInt(q.correctOptionIndices);

            if (userAnsIndex !== undefined && userAnsIndex !== null) {
                answeredCount++;
                if (userAnsIndex === correctAnswer) {
                    correctCount++;
                    totalScore += mark;
                    status = "correct";
                } else {
                    wrongCount++;
                    status = "wrong";
                }
            }

            detailedResult.push({
                questionId: q._id,
                userSelected: userAnsIndex,
                correctAnswer: correctAnswer,
                status: status,
                markObtained: status === "correct" ? mark : 0
            });
        });

        // 5. Prepare Database Operation
        const filter = { 
            examId: new ObjectId(examId), 
            studentId: studentId 
        };

        const updateDoc = {
            $set: {
                examTitle: exam.title,
                totalQuestions: originalQuestions.length,
                totalMarks: exam.totalMarks,
                obtainedMarks: totalScore,
                correctCount,
                wrongCount,
                skippedCount: originalQuestions.length - answeredCount,
                timeTaken: timeTaken,
                submittedAt: new Date(),
                details: detailedResult
            },
            $inc: { attemptCount: 1 },
            $setOnInsert: {
                createdAt: new Date()
            }
        };

        // 6. Execute Upsert
        // includeResultMetadata: true is REQUIRED in newer drivers to get 'lastErrorObject' and 'value' wrapper
        const result = await examResultsCollection.findOneAndUpdate(
            filter,
            updateDoc,
            { 
                upsert: true, 
                returnDocument: 'after',
                includeResultMetadata: true 
            }
        );

        // Handle Driver Differences (value vs directly returned doc)
        // In some drivers 'result' is the doc, in others 'result.value' is the doc.
        const doc = result.value || result; 

        // 7. Update Participant Count (Only if it was a NEW insertion)
        // updatedExisting is true if we updated a record, false if we inserted a new one
        const isNewEntry = result.lastErrorObject ? !result.lastErrorObject.updatedExisting : false;

        if (isNewEntry) {
            await modelTestsCollection.updateOne(
                { _id: new ObjectId(examId) },
                { $inc: { participants: 1 } }
            );
        }

        // 8. Send Response
        res.send({ 
            success: true, 
            resultId: doc._id, 
            score: totalScore 
        });

    } catch (error) {
        console.error("Submission Error Details:", error); // Check your server terminal for this log
        res.status(500).send({ message: "Failed to submit exam", error: error.message });
    }
});





// ✅ 1. GET Full Result with Question Details (For Solution Page)
app.get("/api/exam-results/:resultId", verifyFireBaseToken, async (req, res) => {
  try {
    const resultId = req.params.resultId;

    // A. Fetch the Result Document
    const result = await examResultsCollection.findOne({ _id: new ObjectId(resultId) });
    if (!result) return res.status(404).send({ message: "Result not found" });

    // B. Fetch Original Questions to show text/solutions
    // We extract all question IDs from the result details
    const questionIds = result.details.map(d => d.questionId);
    
    const questions = await mcqCollection.find({ _id: { $in: questionIds } })
        .project({ question: 1, options: 1, solution: 1, explanation: 1 }) // Fetch text & solution
        .toArray();

    // C. Calculate Rank (On the fly)
    // Count how many people scored HIGHER than this student for this specific exam
    const rank = await examResultsCollection.countDocuments({
        examId: result.examId,
        $or: [
            { obtainedMarks: { $gt: result.obtainedMarks } },
            { obtainedMarks: result.obtainedMarks, timeTaken: { $lt: result.timeTaken } }
        ]
    }) + 1;

    res.send({ result, questions, rank });

  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server Error" });
  }
});

// ✅ 2. GET Leaderboard for an Exam
app.get("/api/leaderboard/:examId", verifyFireBaseToken, async (req, res) => {
  try {
    const examId = req.params.examId;
    
    const leaderboard = await examResultsCollection.find({ examId: new ObjectId(examId) })
        .sort({ obtainedMarks: -1, timeTaken: 1 }) // Higher marks first, less time second
        .limit(50) // Top 50
        .project({ studentId: 1, obtainedMarks: 1, timeTaken: 1, submittedAt: 1 }) // Only show necessary info
        .toArray();

    res.send(leaderboard);
  } catch (error) {
    res.status(500).send({ message: "Error fetching leaderboard" });
  }
});








// --- 1. POST: User Sends Payment Request ---
app.post("/api/payment/request",verifyFireBaseToken, async (req, res) => {
  const paymentData = req.body;
  
  // Basic validation
  if (!paymentData.email || !paymentData.transactionId) {
    return res.status(400).send({ message: "Invalid data" });
  }

  // Add server-side fields
  const doc = {
    ...paymentData,
    status: "pending", // pending, approved, rejected
    submittedAt: new Date(),
  };

  try {
      const result = await paymentCollection.insertOne(doc);

      if (result.insertedId) {
          
          // ---------------------------------------------
          // 1. Notify the User (Confirmation)
          // ---------------------------------------------
          const user = await userCollection.findOne({ email: paymentData.email });
          if (user) {
              await sendNotification({
                  userId: user._id.toString(),
                  title: "Request Submitted ⏳",
                  message: `Your payment request for ${paymentData.amount} BDT (${paymentData.planType}) has been received.`,
                  type: "info", 
                  link: "/profile"
              }, { notificationCollection });
          }

          // ---------------------------------------------
          // 2. ✅ NEW: Notify ALL Admins
          // ---------------------------------------------
          const admins = await userCollection.find({ role: 'admin' }).toArray();

          if (admins.length > 0) {
              // Create a notification promise for each admin
              const adminNotificationPromises = admins.map(admin => {
                  return sendNotification({
                      userId: admin._id.toString(),
                      title: "New Payment Request 💰",
                      message: `${paymentData.name || 'A user'} has requested approval for ${paymentData.amount} BDT (${paymentData.planType}). TrxID: ${paymentData.transactionId}`,
                      type: "warning", // Using 'warning' style (Amber color) to grab attention
                      link: "/dashboard/payment-requests" // Link to Admin Dashboard
                  }, { notificationCollection });
              });

              // Send all admin notifications in parallel
              await Promise.all(adminNotificationPromises);
          }
      }

      res.send(result);

  } catch (error) {
      console.error("Payment Request Error:", error);
      res.status(500).send({ message: "Failed to submit request" });
  }
});

// --- 2. GET: Admin Views All Pending Requests ---
// ⚠️ IMPORTANT: Add verifyToken and verifyAdmin middleware here
app.get("/api/admin/payment-requests", verifyFireBaseToken, verifyAdmin, async (req, res) => {
  
  const status = req.query.status || "pending";

  const query = { status: status }; // Or remove query to see history
  // Sort by newest first
  const result = await paymentCollection.find(query).sort({ submittedAt: -1 }).toArray();
  res.send(result);
});

// --- 3. PATCH: Admin Approves Request & Updates User Subscription ---
app.patch("/api/admin/approve-payment/:id", verifyFireBaseToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { email, planType, durationDays, questionLimit, amount } = req.body;

  // Only check for valid 'days' if the plan is NOT a recharge
  const days = parseInt(durationDays);
  if (!email || !planType) {
      return res.status(400).send({ success: false, message: "Invalid email or plan type." });
  }
  if (planType !== 'recharge' && isNaN(days)) {
      return res.status(400).send({ success: false, message: "Invalid duration for subscription." });
  }

  try {
      // 2. Find User
      const user = await userCollection.findOne({ email: email });
      if (!user) {
          return res.status(404).send({ success: false, message: "User not found." });
      }

      // 3. Helper Function to Calculate New Expiry
      const calculateExpiry = (currentSub) => {
          const now = new Date();
          let newExpiry = new Date();
          
          if (currentSub && currentSub.isActive) {
              const currentExpiryDate = new Date(currentSub.expiryDate);
              if (currentExpiryDate > now) {
                  newExpiry = new Date(currentExpiryDate.getTime() + (days * 24 * 60 * 60 * 1000));
              } else {
                  newExpiry = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
              }
          } else {
              newExpiry = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
          }
          return newExpiry;
      };

      // 4. Prepare User Update Object
      let userUpdate = {};
      let finalExpiryDate = new Date(); 

      const paymentAmount = parseFloat(amount);

      // ✅ UPDATE 3: Insert Recharge Logic Here
      if (planType === 'recharge') {
          // ⚡ WALLET RECHARGE LOGIC
          // We don't set an expiry date for wallet balance, so we just use current date for the payment record
          finalExpiryDate = new Date(); 

          userUpdate = {
              $inc: { wallet_balance: paymentAmount } // 
          };
      }
      else if (planType === 'teacher') {
          // 👨‍🏫 TEACHER PLAN
          // 👨‍🏫 TEACHER PLAN
          const currentSub = user.subscriptions?.teacher;
          const teacherExpiry = calculateExpiry(currentSub);
          
          // 1. Calculate Remaining Questions from previous plan
          let previousRemaining = 0;
          
          // Only check remaining if the plan is currently active
          if (currentSub && currentSub.isActive) {
              const oldLimit = currentSub.questionLimit || 0;
              const oldUsed = currentSub.questionUsed || 0;
              
              // If old plan was NOT unlimited (-1), calculate what's left
              if (oldLimit !== -1) {
                  previousRemaining = Math.max(0, oldLimit - oldUsed);
              }
          }

          const newPackLimit = parseInt(questionLimit);
          let finalLimit = 0;

          // 2. Logic: If New Pack is Unlimited (-1) OR Old was Unlimited, the result is Unlimited (-1)
          if (newPackLimit === -1 || (currentSub?.questionLimit === -1 && currentSub?.isActive)) {
              finalLimit = -1; 
          } else {
              // Otherwise: Add Remaining + New
              finalLimit = previousRemaining + newPackLimit;
          }
          
          userUpdate = {
              $set: {
                  'subscriptions.teacher.isActive': true,
                  'subscriptions.teacher.expiryDate': teacherExpiry,
                  'subscriptions.teacher.questionLimit': finalLimit, // ✅ Explicitly saved
                  'subscriptions.teacher.questionUsed': 0, // Reset usage
                  'subscriptions.teacher.lastPaymentId': id
              }
          };
      } 
      else if (planType === 'combo') {
          // 🎁 COMBO PLAN
          const practiceExpiry = calculateExpiry(user.subscriptions?.practice);
          const modelTestExpiry = calculateExpiry(user.subscriptions?.modelTest);
          
          finalExpiryDate = practiceExpiry > modelTestExpiry ? practiceExpiry : modelTestExpiry;

          userUpdate = {
              $set: {
                  'subscriptions.practice.isActive': true,
                  'subscriptions.practice.expiryDate': practiceExpiry,
                  'subscriptions.practice.lastPaymentId': id,
                  
                  'subscriptions.modelTest.isActive': true,
                  'subscriptions.modelTest.expiryDate': modelTestExpiry,
                  'subscriptions.modelTest.lastPaymentId': id
              }
          };
      } 
      else {
          // ⚡ STANDARD PLAN (practice OR modelTest)
          const newExpiry = calculateExpiry(user.subscriptions?.[planType]);
          finalExpiryDate = newExpiry;

          userUpdate = {
              $set: {
                  [`subscriptions.${planType}.isActive`]: true,
                  [`subscriptions.${planType}.expiryDate`]: newExpiry,
                  [`subscriptions.${planType}.lastPaymentId`]: id
              }
          };
      }

      // 5. Update User Collection
      const userFilter = { email: email };
      const userUpdateResult = await userCollection.updateOne(userFilter, userUpdate, { upsert: true });

      // 6. Update Payment Collection
      const paymentFilter = { _id: new ObjectId(id) };
      const paymentUpdate = {
        $set: { 
          status: "approved",
          approvedAt: new Date(),
          expiryDate: finalExpiryDate
        }
      };
      const paymentUpdateResult = await paymentCollection.updateOne(paymentFilter, paymentUpdate);

      // 7. Send Response
      if(paymentUpdateResult.modifiedCount > 0 || userUpdateResult.modifiedCount > 0 || userUpdateResult.upsertedCount > 0){
          
        // ============================================================
        // 🔵 1. NEW: LOG USER TRANSACTION (For Recharge Only)
        // ============================================================
        if (planType === 'recharge') {
            try {
                // Calculate new balance for log
                const currentBalance = user.wallet_balance || 0;
                const newBalance = currentBalance + paymentAmount;

                await transactionCollection.insertOne({
                    userId: user._id.toString(),
                    email: user.email,
                    amount: paymentAmount,
                    type: "credit", // Money IN
                    category: "wallet_recharge",
                    details: { 
                        description: "Wallet Recharge Approved by Admin",
                        paymentId: id
                    },
                    balanceAfter: newBalance,
                    createdAt: new Date().toISOString()
                });
                console.log(`✅ Transaction logged for User: ${user.email}`);
            } catch (txError) {
                console.error("❌ Failed to log user transaction", txError);
            }
        }
        // ============================================================

        // ============================================================
          // 🟢 NEW: REFERRAL BONUS LOGIC (Wrapped safely)
          // ============================================================
          try {
            // 1. Check if user was referred by someone
            if (user.referred_by) {
                const referrer = await userCollection.findOne({ referral_link: user.referred_by });
                
                // 2. Only give bonus if referrer exists AND payment amount > 0
                if (referrer && amount > 0) {
                    const bonusPercent = 0.20; // 20%
                    const bonusAmount = Math.floor(parseFloat(amount) * bonusPercent);

                    if (bonusAmount > 0) {
                        // A. Add money to Referrer Wallet
                        await userCollection.updateOne(
                            { _id: referrer._id },
                            { $inc: { wallet_balance: bonusAmount } }
                        );

                        // 1. Calculate the NEW balance for the referrer
                        const newReferrerBalance = (referrer.wallet_balance || 0) + bonusAmount;

                        // B. [Expert Requirement] Record the Transaction
                        // Assuming you have a 'transactionCollection'
                        await transactionCollection.insertOne({
                            userId: referrer._id.toString(),
                            email: referrer.email,
                            amount: bonusAmount,
                            type: "referral_bonus",

                            // ✅ NEW FIELD: Save the Friend's ID so we can group earnings later
                            sourceUserId: user._id.toString(),

                            details: { 
                                description: `Referral Bonus from ${user.name}`,
                                planType: planType
                            },
                            balanceAfter: newReferrerBalance,
                            createdAt: new Date().toISOString(),
                        });

                        // C. Notify the Referrer
                        await sendNotification({
                            userId: referrer._id.toString(),
                            title: "Referral Bonus! 🎁",
                            message: `You earned ৳${bonusAmount} because your friend ${user.name} subscribed!`,
                            type: "success",
                            link: "/my-referrals"
                        }, { notificationCollection });
                    }
                }
            }
          } catch (referralError) {
             // We log the error but DO NOT crash the request. The user still gets their subscription.
             console.error("Referral Bonus Error:", referralError);
          }
          // ============================================================
          // 🔴 END REFERRAL LOGIC
          // ============================================================

        let title = "Subscription Activated! 🎉";
        let message = `Your ${planType} plan is now active for ${durationDays} days.`;

        // Custom message for Wallet Recharge
        if (planType === 'recharge') {
            title = "Wallet Recharged! 💰";
            message = `Successfully added ৳${amount} to your wallet. Current Balance: ৳${(user.wallet_balance || 0) + parseFloat(amount)}`;
        }

        // Trigger Notification
        await sendNotification({
            userId: user._id.toString(),
            title: title,
            message: message,
            type: "success",
            link: planType === 'recharge' ? "/profile" : "/profile"
        }, { notificationCollection });
            
            
        res.send({ success: true, message: "Subscription activated successfully" });
      } else {
          res.status(200).send({ success: true, message: "Subscription already active or no changes needed." });
      }

  } catch (error) {
      console.error("Approval Error:", error);
      res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// --- 4. PATCH: Admin Rejects Request (Optional) ---
// app.patch("/api/admin/reject-payment/:id", verifyFireBaseToken, verifyAdmin, async (req, res) => {
//     const id = req.params.id;
//     const filter = { _id: new ObjectId(id) };
//     const update = { $set: { status: "rejected" } };
//     const result = await paymentCollection.updateOne(filter, update);
//     res.send(result);
// });


app.patch("/api/admin/reject-payment/:id", verifyFireBaseToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };

    try {
        // 1. Fetch the request details FIRST (to get user info)
        const paymentRequest = await paymentCollection.findOne(filter);
        
        if (!paymentRequest) {
            return res.status(404).send({ success: false, message: "Request not found" });
        }

        // 2. Reject the request
        const updateResult = await paymentCollection.updateOne(filter, { 
            $set: { status: "rejected" } 
        });

        // ✅ NEW: Find User and Send Notification
        if (updateResult.modifiedCount > 0) {
            const user = await userCollection.findOne({ email: paymentRequest.email });
            
            if (user) {
                await sendNotification({
                    userId: user._id.toString(),
                    title: "Payment Rejected ❌",
                    message: `Your payment request for ${paymentRequest.amount} BDT (${paymentRequest.planType}) was rejected. Please check your transaction ID and try again.`,
                    type: "error",
                    link: "/profile"
                }, { notificationCollection });
            }
        }

        res.send(updateResult);

    } catch (error) {
        console.error("Reject Error:", error);
        res.status(500).send({ success: false });
    }
});


// GET: My Payment History
app.get("/api/payment/history", verifyFireBaseToken, async (req, res) => {
  const email = req.query.email;
  // Security check: ensure requesting user matches token user
  if (req.decoded.email !== email) {
    return res.status(403).send({ message: "Forbidden access" });
  }
  const result = await paymentCollection.find({ email: email }).sort({ requestDate: -1 }).toArray();
  res.send(result);
});




// ✅ DEDUCT QUESTION LIMIT (For Teacher Plans)
app.patch("/api/users/deduct-question-limit", verifyFireBaseToken, async (req, res) => {
  const { email, count, details } = req.body;

  try {
    const user = await userCollection.findOne({ email });

    if (!user || !user.subscriptions?.teacher?.isActive) {
      return res.status(403).send({ message: "No active teacher subscription" });
    }

    const sub = user.subscriptions.teacher;
    const limit = sub.questionLimit;
    const used = sub.questionUsed || 0;

    // Check Limit (Skip if unlimited i.e., -1)
    if (limit !== -1 && (used + count > limit)) {
      return res.status(400).send({ message: "Question limit exceeded for this plan." });
    }

    // Update Usage
    const updateResult = await userCollection.updateOne(
      { email: email },
      { 
        $inc: { "subscriptions.teacher.questionUsed": count } 
      }
    );

    if (updateResult.modifiedCount > 0) {

      // 📝 LOG TRANSACTION (New Feature)
      const remaining = limit === -1 ? "Unlimited" : (limit - (used + count));
      
      const transaction = {
        email: email,
        amount: 0, // কোনো টাকা কাটা হয়নি
        quotaDeducted: count, // কতগুলো প্রশ্ন কাটা হলো
        type: "quota_usage", // ট্রানজ্যাকশন টাইপ
        details: details || { description: "Used for question creation" },
        remainingQuota: remaining, // অবশিষ্ট কোটা
        createdAt: new Date().toISOString(),
      };

      await transactionCollection.insertOne(transaction);

      res.send({ success: true, message: "Limit deducted and logged" });
    } else {
      res.status(500).send({ message: "Failed to update limit" });
    }

  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});




// GET: Fetch all users with subscription details
app.get("/api/admin/subscription-status", verifyFireBaseToken, verifyAdmin, async (req, res) => {
    try {
        // We project only necessary fields to keep it fast
        const result = await userCollection.find({}, {
            projection: {
                name: 1,
                email: 1,
                phone: 1, // Ensure you save phone in user profile
                wallet_balance: 1,
                subscriptions: 1, // Contains teacher, practice, etc.
                role: 1
            }
        }).toArray();

        // Optional: Filter out admins if you only want students
        const subscribers = result.filter(u => u.role !== 'admin');

        res.send(subscribers);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch subscription data" });
    }
});



// ✅ 1. POST: Send Notification (Called by SubscriptionManager frontend)
app.post("/api/admin/send-notification", verifyFireBaseToken, verifyAdmin, async (req, res) => {
    const { userId, title, message, isGlobal, type } = req.body;

    // Use the Helper Function
    const result = await sendNotification({
        userId: isGlobal ? 'global' : userId,
        title: req.body.subject || title, // Handle 'subject' from frontend
        message: req.body.body || message, // Handle 'body' from frontend
        type:  type, // Use 'global' type for global notifs
        link: req.body.link || null // Optional link for notification
      }, { notificationCollection });

    if(result.success) {
        res.send({ success: true, message: "Notification sent!" });
    } else {
        res.status(500).send({ success: false });
    }
});

// ✅ 2. GET: Fetch Notifications (Hybrid: Personal + Global)
app.get("/api/notifications", verifyFireBaseToken, async (req, res) => {
    const email = req.decoded.email;
    
    // Find User to get ID
    const user = await userCollection.findOne({ email: email });
    if(!user) return res.send([]);

    const userId = user._id.toString();

    // 1. Fetch Personal Notifications
    const personal = await notificationCollection
        .find({ userId: userId })
        .sort({ date: -1 })
        .limit(20)
        .toArray();

    // 2. Fetch Global Notifications (Last 5)
    // Note: You might want a logic to hide global notifs the user has "cleared", 
    // but typically global announcements persist for a while.
    const global = await notificationCollection
        .find({ target: 'global' })
        .sort({ date: -1 })
        .limit(5)
        .toArray();

    // 3. Merge & Sort by Date (Newest first)
    const allNotifications = [...personal, ...global]
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.send(allNotifications);
});

// ✅ 3. PATCH: Mark as Read
app.patch("/api/notifications/read/:id", verifyFireBaseToken, async (req, res) => {
    const id = req.params.id;
    await notificationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isRead: true } }
    );
    res.send({ success: true });
});




// ✅ DELETE: Remove a global notification
app.delete("/api/admin/global-notification/:id", verifyFireBaseToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await notificationCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Error deleting notification" });
    }
});


// ✅ GET: Fetch ALL notifications (Global + Individual) for Admin
app.get("/api/admin/all-notifications", verifyFireBaseToken, verifyAdmin, async (req, res) => {
    try {
        const filter = req.query.type === 'global' ? { target: 'global' } : {};
        
        // Fetch notifications sorted by newest
        // Limit to 100 to prevent browser crash
        const notifications = await notificationCollection
            .find(filter)
            .sort({ date: -1 })
            .limit(100) 
            .toArray();

        // Optional: If you stored userId but not email, you might want to fetch user details here
        // But for performance, it's better to just show userId or store email in notification initially.
        // Assuming we just show the raw data for now.

        res.send(notifications);
    } catch (error) {
        res.status(500).send({ message: "Error fetching notifications" });
    }
});

// ✅ DELETE: Automated Cleanup (Delete notifications older than 30 days)
app.delete("/api/admin/notifications/cleanup", verifyFireBaseToken, verifyAdmin, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const result = await notificationCollection.deleteMany({
            date: { $lt: thirtyDaysAgo }
        });

        res.send({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        res.status(500).send({ message: "Cleanup failed" });
    }
});




// GET: My Referrals with Exact Earnings
app.get("/api/my-referrals/:referralCode", async (req, res) => {
    const code = req.params.referralCode;

    try {
        const referrerUser = await userCollection.findOne({ referral_link: code });
        if (!referrerUser) return res.send([]);

        const referrerIdStr = referrerUser._id.toString();

        const pipeline = [
            // 1. Find all users invited by this code
            { $match: { referred_by: code } },

            // 2. Convert their _id to string for matching
            { $addFields: { userIdStr: { $toString: "$_id" } } },

            // 3. JOIN with Transactions Collection
            {
                $lookup: {
                    from: "transactions", // Your transactions collection name
                    let: { friendId: "$userIdStr" },
                    pipeline: [
                        { $match: {
                            $expr: {
                                $and: [
                                    // Match transaction type
                                    { $eq: ["$type", "referral_bonus"] },
                                    // Match the Friend's ID (The field we added in Step 1)
                                    { $eq: ["$sourceUserId", "$$friendId"] },
                                    // Ensure it belongs to the Referrer
                                    { $eq: ["$userId", referrerIdStr] } 
                                ]
                            }
                        }}
                    ],
                    as: "earnings"
                }
            },

            // 4. Calculate Total Amount from that array
            {
                $addFields: {
                    totalBonusEarned: { $sum: "$earnings.amount" }
                }
            },

            // 5. Clean up output
            {
                $project: {
                    name: 1,
                    email: 1,
                    photoURL: 1,
                    joinDate: "$_id", // Timestamp from ID
                    totalBonusEarned: 1 // The new calculated field
                }
            }
        ];

        const referrals = await userCollection.aggregate(pipeline).toArray();

        // Safe mapping
        const safeData = referrals.map(u => ({
            _id: u._id,
            name: u.name,
            photo: u.photoURL || "https://i.ibb.co/5GzXkwq/user.png",
            joinDate: u._id.getTimestamp(),
            totalEarned: u.totalBonusEarned || 0 // Default to 0
        }));

        res.send(safeData);

    } catch (error) {
        console.error("Referral Stats Error:", error);
        res.status(500).send([]);
    }
});





// POST: Pay with Wallet (Instant Purchase)
app.post("/api/payment/pay-with-wallet", verifyFireBaseToken, async (req, res) => {
    const { email, amount, planType, durationDays, questionLimit } = req.body;
    const price = parseFloat(amount);
    const days = parseInt(durationDays);

    try {
        const user = await userCollection.findOne({ email });
        
        // 1. Validate User & Balance
        if (!user) return res.status(404).send({ success: false, message: "User not found" });
        if ((user.wallet_balance || 0) < price) {
            return res.status(400).send({ success: false, message: "Insufficient wallet balance" });
        }
        if ((user.wallet_balance || 0) < 50) {
             return res.status(400).send({ success: false, message: "Minimum 50 TK balance required to use wallet." });
        }

        // 2. Helper Function: Calculate Expiry (Exact match with Admin Route)
        const calculateExpiry = (currentSub) => {
            const now = new Date();
            let newExpiry = new Date();
            
            if (currentSub && currentSub.isActive) {
                const currentExpiryDate = new Date(currentSub.expiryDate);
                // Extend if currently active, otherwise start from now
                if (currentExpiryDate > now) {
                    newExpiry = new Date(currentExpiryDate.getTime() + (days * 24 * 60 * 60 * 1000));
                } else {
                    newExpiry = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
                }
            } else {
                newExpiry = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
            }
            return newExpiry;
        };

        // ⚡ CRITICAL STEP: Generate a specific ID for this transaction
        const transactionId = new ObjectId();

        // 3. Prepare Update Object
        let userUpdate = { $inc: { wallet_balance: -price } }; // Deduct Balance
        let updateSet = {};

        // 🟢 MATCHING ADMIN LOGIC FOR PLAN TYPES
        if (planType === 'teacher') {
            
            const currentSub = user.subscriptions?.teacher;
            const teacherExpiry = calculateExpiry(currentSub);

            // A. Calculate Previous Remaining
            let previousRemaining = 0;
            if (currentSub && currentSub.isActive) {
                const oldLimit = currentSub.questionLimit || 0;
                const oldUsed = currentSub.questionUsed || 0;
                if (oldLimit !== -1) {
                    previousRemaining = Math.max(0, oldLimit - oldUsed);
                }
            }

            // B. Calculate Final Limit
            const newPackLimit = parseInt(questionLimit);
            let finalLimit = 0;

            if (newPackLimit === -1 || (currentSub?.questionLimit === -1 && currentSub?.isActive)) {
                finalLimit = -1; // Unlimited
            } else {
                finalLimit = previousRemaining + newPackLimit; // Add remaining + new
            }

            updateSet = {
                'subscriptions.teacher.isActive': true,
                'subscriptions.teacher.expiryDate': teacherExpiry,
                'subscriptions.teacher.questionLimit': finalLimit, // ✅ Explicitly saved
                'subscriptions.teacher.questionUsed': 0, // Reset usage
                'subscriptions.teacher.lastPaymentId': transactionId.toString()
            };
        } 
        else if (planType === 'combo') {
            const practiceExpiry = calculateExpiry(user.subscriptions?.practice);
            const modelTestExpiry = calculateExpiry(user.subscriptions?.modelTest);
            updateSet = {
                'subscriptions.practice.isActive': true,
                'subscriptions.practice.expiryDate': practiceExpiry,
                'subscriptions.practice.lastPaymentId': transactionId.toString(),

                'subscriptions.modelTest.isActive': true,
                'subscriptions.modelTest.expiryDate': modelTestExpiry,
                'subscriptions.modelTest.lastPaymentId': transactionId.toString()
            };
        } 
        else {
            // Standard (practice or modelTest)
            const newExpiry = calculateExpiry(user.subscriptions?.[planType]);
            updateSet = {
                [`subscriptions.${planType}.isActive`]: true,
                [`subscriptions.${planType}.expiryDate`]: newExpiry,
                [`subscriptions.${planType}.lastPaymentId`]: transactionId.toString()
            };
        }

        // Merge logic
        userUpdate.$set = updateSet;

        // 4. Update Database (Atomic Operation)
        await userCollection.updateOne({ email }, userUpdate);

        // 5. Log Transaction
        await transactionCollection.insertOne({
            _id: transactionId,
            userId: user._id.toString(),
            email,
            amount: price,
            type: "purchase", // Money OUT
            details: { 
                collectionName: `${planType} Plan Purchase (Wallet)`,
                description: `Activated ${planType} plan for ${days} days` 
            },
            balanceAfter: (user.wallet_balance - price),
            createdAt: new Date()
        });

        // 6. Send Notification
        await notificationCollection.insertOne({
            userId: user._id.toString(),
            title: "Plan Activated! 🚀",
            message: `Successfully purchased ${planType} plan using Wallet Balance.`,
            type: "success",
            link: "/profile",
            date: new Date(),
            isRead: false
        });

        res.send({ success: true, message: "Plan activated successfully" });

    } catch (err) {
        console.error("Wallet Payment Error:", err);
        res.status(500).send({ success: false, message: "Server error" });
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
  console.log("mcq bank server is running..... from home route by zulfikar");
  res.send("mcq bank server is running.....");
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server listening on port http://localhost:${port}`);
});
