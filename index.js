require("dotenv").config();
var admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000; // Access variables via process.env
const { MongoClient, ServerApiVersion } = require("mongodb");

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
// middleware
app.use(express.json());
app.use(cors());

const uri = process.env.URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// verifyFirebase admin

const verifyFBAdmin = async (req, res, next) => {
  console.log(req.headers);

  next();
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection

    const db = client.db("club_sphere_db");
    const usersCollection = db.collection("users");

    // get user role

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        // check user already exist
        const existingUser = await usersCollection.findOne({
          email: user.email,
        });

        if (existingUser) {
          return res.status(409).send({ message: "User already exists" });
        }

        user.role = "member";
        user.createdAt = new Date();

        const result = await usersCollection.insertOne(user);

        res
          .status(201)
          .send({ message: "User created", userId: result.insertedId });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.log(error);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("club-sphere server available");
});

app.listen(port, () => {
  console.log(`club-sphere running on port ${port}`);
});
