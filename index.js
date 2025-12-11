require("dotenv").config();
var admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000; // Access variables via process.env
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    // console.log(decodedToken);
    req.decodedEmail = decodedToken.email;
    next();
  } catch (error) {
    console.error("Error verifying ID token:", error);
    return res.status(403).send("Invalid or expired token.");
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection

    // database and data collections

    const db = client.db("club_sphere_db");
    const usersCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");

    // admin role verify
    const verifyAdminRole = async (req, res, next) => {
      const email = req.decodedEmail;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // test api
    app.get("/usesr/test", verifyFBAdmin, (req, res) => {
      res.send("text ok");
    });

    // get user role
    app.get("/users/:email/role", verifyFBAdmin, async (req, res) => {
      const email = req.params.email;

      if (req.decodedEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // change role only admin
    app.patch(
      "/users/:id/role",
      verifyFBAdmin,
      verifyAdminRole,
      async (req, res) => {
        const id = req.params.id;
        const role = req.body.role;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { role: role },
        };

        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    app.get("/users", verifyFBAdmin, verifyAdminRole, async (req, res) => {
      const result = await usersCollection.find().toArray();
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

    // club apis

    // get clubs api
    app.get("/clubs", async (req, res) => {
      const email = req.query.email;
      // const query = { email };
      const result = await clubsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // get api for creator clubs

    app.get("/clubs/by-creator", async (req, res) => {
      const { email, status } = req.query;
      const query = {};
      if (email) {
        query.managerEmail = email;
      }
      if (status) {
        query.status = status;
      }

      const result = await clubsCollection.find(query).toArray();
      res.send(result);
    });

    // post api club
    app.post("/clubs", async (req, res) => {
      const club = req.body;
      club.createdAt = new Date();
      club.status = "pending";
      const result = await clubsCollection.insertOne(club);
      res.send(result);
    });

    // club data update api
    app.patch("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const {
        clubName,
        description,
        category,
        location,
        bannerImage,
        membershipFee,
      } = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          clubName: clubName,
          description: description,
          category: category,
          location: location,
          bannerImage: bannerImage,
          membershipFee: Number(membershipFee),
          updatedAt: new Date(),
        },
      };
      const result = await clubsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // patch club status
    app.patch("/clubs/:id/status", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await clubsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    //

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
