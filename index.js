require("dotenv").config();

var admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;
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
    // await client.connect();
    // Send a ping to confirm a successful connection

    // database and data collections

    const db = client.db("club_sphere_db");
    const usersCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");
    const membershipsCollection = db.collection("memberships");

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
      const status = req.query.status;
      const query = {};
      if (status) {
        query.status = status;
      }
      const result = await clubsCollection
        .find(query)
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

    app.get("/clubs/:id/details", async (req, res) => {
      try {
        const id = req.params.id;
        const pipeline = [
          {
            $match: { _id: new ObjectId(id) },
          },
          {
            $lookup: {
              from: "users",
              localField: "managerEmail",
              foreignField: "email",
              as: "organizer",
            },
          },
          {
            $project: {
              "organizer.photoURL": 0,
              "organizer._id": 0,
              "organizer.role": 0,
              "organizer.createdAt": 0,
              updatedAt: 0,
            },
          },
          { $unwind: "$organizer" },
        ];

        const result = await clubsCollection.aggregate(pipeline).toArray();

        if (!result.length) {
          return res.status(404).send({ message: "Club not found" });
        }
        res.send(result[0]);
      } catch (error) {
        res.status(500).send({ error: "Error fetching club details" });
      }
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

    //payment releted api

    app.post("/payment-checkout-session", async (req, res) => {
      const clubInfo = req.body;
      const amount = parseInt(clubInfo.membershipFee) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              product_data: {
                name: clubInfo.name,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        customer_email: clubInfo.email,
        metadata: {
          clubId: clubInfo._id,
          clubName: clubInfo.clubName,
        },
        mode: "payment",
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/canlelled`,
      });

      // console.log(session)
      res.send({ url: session.url });
    });

    app.get("/session-status", async (req, res) => {
      const session = await stripe.checkout.sessions.retrieve(
        req.query.session_id
      );

      if (session.payment_status === "paid") {
        const existing = await membershipsCollection.findOne({
          paymentId: session.payment_intent,
        });

        if (session.payment_status === "paid") {
          if (!existing) {
            console.log("sesstion retrieve:", session);
            const memberInfo = {
              userEmail: session.customer_email,
              clubId: session.metadata.clubId,
              status: "active",
              paymentStatus: session.payment_status,
              paymentId: session.payment_intent,
              joinedAt: new Date(),
            };

            const result = await membershipsCollection.insertOne(memberInfo);
            console.log(memberInfo);
          }
        }
      }

      res.send({
        status: session.status,
        clubName: session.metadata.clubName,
        amount: session.amount_total / 100,
      });
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
