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
    await client.connect();
    // Send a ping to confirm a successful connection

    // database and data collections

    const db = client.db("club_sphere_db");
    const usersCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");
    const membershipsCollection = db.collection("memberships");
    const paymentsCollection = db.collection("payments");
    const eventsCollection = db.collection("events");
    const eventRegistrationsCollection = db.collection("eventRegistrations");

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
      res.send("test ok");
    });

    // get user role
    app.get("/users/:email/role", verifyFBAdmin, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decodedEmail) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      console.log(user);

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: user?.role || "member" });
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

        res.status(201).send(result);
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

    // clubs get name by creator for  create event
    app.get("/clubs/club-name", verifyFBAdmin, async (req, res) => {
      const { email } = req.query;
      const query = {};
      if (email) {
        query.managerEmail = email;
        query.status = "approved";
      }

      const result = await clubsCollection
        .find(query)
        .project({ clubName: 1 })
        .toArray();
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

    app.get("/clubs/:email/members", async (req, res) => {
      const email = req.params.email;
      const query = { managerEmail: email };
      const clubs = await clubsCollection.find(query).toArray();
      const members = await membershipsCollection.find().toArray();

      const result = clubs.map((club) => ({
        clubId: club._id,
        clubName: club.clubName,
        members: members.filter((m) => m.clubId === club._id.toString()),
      }));

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
            const paymentsInfo = {
              userEmail: session.customer_email,
              amount: session.amount_total / 100,
              type: "membership",
              status: session.status,
              clubName: session.metadata.clubName,
              paymentId: session.payment_intent,
              createdAt: new Date(),
            };
            const paymentResult = await paymentsCollection.insertOne(
              paymentsInfo
            );
          }
        }
      }
      res.send({
        status: session.status,
        clubName: session.metadata.clubName,
        amount: session.amount_total / 100,
      });
    });

    app.get("/my-paymentns", verifyFBAdmin, async (req, res) => {
      const email = req.decodedEmail;
      const query = { userEmail: email };
      const result = await paymentsCollection.find(query).toArray();
      res.send(result);
    });

    // membership apis
    app.get("/my-clubs", async (req, res) => {
      const { email } = req.query;
      const query = { status: "active" };
      if (email) query.userEmail = email;
      // if (status) query.status = status;
      const memberships = await membershipsCollection.find(query).toArray();

      const clubIds = memberships.map((membership) => membership.clubId);

      const clubs = await clubsCollection
        .find({
          _id: { $in: clubIds.map((id) => new ObjectId(id)) },
        })
        .toArray();

      const result = clubs.map((club) => {
        const membership = memberships.find(
          (m) => m.clubId === club._id.toString()
        );
        return {
          ...club,
          membership: {
            membershipStatus: membership.status,
            joinedAt: membership.joinedAt,
            paymentId: membership.paymentId,
          },
        };
      });

      res.send(result);
    });

    app.get("/clubs/members", async (req, res) => {
      const email = req.query.email;
      const pipeline = [
        {
          $match: {
            managerEmail: email,
            status: "approved",
          },
        },
        {
          $addFields: {
            clubIdString: { $toString: "$_id" },
          },
        },
        {
          $lookup: {
            from: "memberships",
            localField: "clubIdString",
            foreignField: "clubId",
            as: "membership",
          },
        },
        {
          $unwind: {
            path: "$membership",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "membership.userEmail",
            foreignField: "email",
            as: "memberUser",
          },
        },
        {
          $unwind: {
            path: "$memberUser",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: "$_id",
            clubName: { $first: "$clubName" },
            members: {
              $push: {
                name: "$memberUser.displayName",
                membershipId: "$membership._id",
                email: "$membership.userEmail",
                status: "$membership.status",
                joinDate: "$membership.joinedAt",
              },
            },
          },
        },
      ];

      const result = await clubsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    // membership status check api
    app.get(
      "/clubs/:clubId/membership-status",
      verifyFBAdmin,
      async (req, res) => {
        const clubId = req.params.clubId;
        const email = req.decodedEmail;
        const query = { clubId, userEmail: email };
        console.log(clubId, email);
        const result = await membershipsCollection.findOne(query);
        res.send({
          status: result?.status,
        });
      }
    );

    app.patch("/membership/:membershipId/status", async (req, res) => {
      const membershipId = req.params.membershipId;
      const query = { _id: new ObjectId(membershipId) };
      const updateDoc = {
        $set: {
          status: "expired",
        },
      };
      const result = await membershipsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // event related apis

    app.get("/my-clubs/event-registrations", async (req, res) => {
      const email = req.query.email;

      try {
        const pipeline = [
          { $match: { managerEmail: email } },

          {
            $lookup: {
              from: "events",
              let: { clubId: { $toString: "$_id" } },
              pipeline: [
                { $match: { $expr: { $eq: ["$clubId", "$$clubId"] } } },
              ],
              as: "events",
            },
          },

          { $unwind: "$events" },

          // 3️⃣ Events → Registrations
          {
            $lookup: {
              from: "eventRegistrations",
              let: { eventId: { $toString: "$events._id" } },
              pipeline: [
                { $match: { $expr: { $eq: ["$eventId", "$$eventId"] } } },
              ],
              as: "registrations",
            },
          },

          { $unwind: "$registrations" },

          // 4️⃣ Registration → User
          {
            $lookup: {
              from: "users",
              localField: "registrations.userEmail",
              foreignField: "email",
              as: "user",
            },
          },

          { $unwind: "$user" },
          {
            $project: {
              _id: "$registrations._id",
              eventName: "$events.title",
              userEmail: "$registrations.userEmail",
              status: "$registrations.status",
              registeredAt: "$registrations.registeredAt",
              userName: "$user.displayName",
            },
          },
        ];

        const result = await clubsCollection.aggregate(pipeline).toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
      }
    });

    app.post("/event", async (req, res) => {
      const {
        clubId,
        title,
        description,
        eventDate,
        location,
        isPaid,
        eventFee,
        maxAttendees,
      } = req.body;

      const eventInfo = {
        clubId: clubId,
        title: title,
        description: description,
        eventDate: eventDate,
        location: location,
        isPaid: isPaid,
        eventFee: Number(eventFee) || 0,
        maxAttendees: Number(maxAttendees) || 0,
        createdAt: new Date(),
      };

      const result = await eventsCollection.insertOne(eventInfo);
      res.send(result);
    });

    // event update
    app.patch("/events/:id", verifyFBAdmin, async (req, res) => {
      const id = req.params.id;
      const event = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: event,
      };

      const result = await eventsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.delete("/events/:id", verifyFBAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await eventsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/events", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const pipeline = [
          {
            $addFields: {
              clubIdObj: { $toObjectId: "$clubId" },
            },
          },
          {
            $lookup: {
              from: "clubs",
              localField: "clubIdObj",
              foreignField: "_id",
              as: "club",
            },
          },
          { $unwind: "$club" },
          {
            $match: {
              "club.managerEmail": email,
              "club.status": "approved",
            },
          },

          {
            $project: {
              title: 1,
              description: 1,
              clubId: 1,
              eventDate: 1,
              location: 1,
              isPaid: 1,
              eventFee: 1,
              maxAttendees: 1,
              createdAt: 1,
              clubName: "$club.clubName",
            },
          },
          // {
          //   $sort: { eventDate: 1 },
          // },
        ];

        const events = await eventsCollection.aggregate(pipeline).toArray();

        res.send(events);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.get("/clubs/:clubId/events", verifyFBAdmin, async (req, res) => {
      const { clubId } = req.params;
      const userEmail = req.decodedEmail;

      const member = await membershipsCollection.findOne({
        clubId,
        userEmail,
        status: "active",
      });

      if (!member) {
        return res.status(403).json({
          message: "You are not a member of this club",
        });
      }

      const query = {
        clubId: clubId,
      };
      const result = await eventsCollection.find(query).toArray();

      res.send(result);
    });

    app.get(
      "/events/:eventId/registrations",
      verifyFBAdmin,
      async (req, res) => {
        const { eventId } = req.params;
        const email = req.decodedEmail;
        const query = {
          _id: new ObjectId(eventId),
        };

        const event = await eventsCollection.findOne(query);
        const memberQuery = {
          clubId: event.clubId,
          userEmail: email,
          status: "active",
        };
        const member = await membershipsCollection.findOne(memberQuery);

        if (!member) {
          return res.status(403).json({ message: "Members only" });
        }

        const registrations = await eventRegistrationsCollection
          .find({ eventId: event._id })
          .toArray();
        res.send(registrations);
      }
    );

    app.get("/events/registrations", verifyFBAdmin, async (req, res) => {
      const email = req.decodedEmail;
      const result = await eventRegistrationsCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });

    app.get(
      "/events/:eventId/registration/",
      verifyFBAdmin,
      async (req, res) => {
        const eventId = req.params.eventId;
        const email = req.decodedEmail;
        const query = {
          eventId,
          userEmail: email,
          status: "registered",
        };
        const result = await eventRegistrationsCollection.findOne(query);
        if (!result) {
          return res.send({ status: "" });
        }
        res.send({ status: result.status });

        console.log({ status: result.status });
      }
    );

    app.post("/events/:eventId/register", verifyFBAdmin, async (req, res) => {
      const { eventId } = req.params;
      const email = req.decodedEmail;

      const event = await eventsCollection.findOne({
        _id: new ObjectId(eventId),
      });

      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      const member = await membershipsCollection.findOne({
        clubId: event.clubId,
        userEmail: email,
        status: "active",
      });

      if (!member) {
        return res.status(403).json({ message: "Members only" });
      }
      const registered = await eventRegistrationsCollection.findOne({
        eventId: event._id.toString(),
        userEmail: email,
      });
      if (registered) {
        return res.status(409).json({ message: "Already registered" });
      }

      const registration = {
        eventId: event._id.toString(),
        clubId: event.clubId,
        userEmail: email,
        status: "registered",
        paymentId: event.isPaid ? null : undefined,
        registeredAt: new Date(),
      };

      await eventRegistrationsCollection.insertOne(registration);

      res.json({ success: true, registration });
    });

    app.patch("/events/:eventId/cancel", verifyFBAdmin, async (req, res) => {
      const { eventId } = req.params;
      const email = req.decodedEmail;

      const query = { eventId: eventId, userEmail: email };
      const updateDoc = { $set: { status: "cancelled" } };

      const result = await eventRegistrationsCollection.updateOne(
        query,
        updateDoc
      );
      // if (result.matchedCount === 0)
      //   return res.status(404).json({ message: "Registration not found" });

      res.send(result);
    });

    app.get("/my-events", verifyFBAdmin, async (req, res) => {
      const email = req.decodedEmail;
      const pipeline = [
        {
          $match: {
            userEmail: email,
          },
        },
        {
          $addFields: { clubIdObj: { $toObjectId: "$clubId" } },
        },

        {
          $lookup: {
            from: "clubs",
            localField: "clubIdObj",
            foreignField: "_id",
            as: "club",
          },
        },

        {
          $unset: "clubIdObj",
        },
        {
          $addFields: { eventIdObj: { $toObjectId: "$eventId" } },
        },

        {
          $lookup: {
            from: "events",
            localField: "eventIdObj",
            foreignField: "_id",
            as: "ev",
          },
        },
        {
          $unwind: "$ev",
        },
        {
          $unwind: "$club",
        },
        {
          $unset: "eventIdObj",
        },
        {
          $project: {
            _id: "$_id",
            title: "$ev.title",
            clubName: "$club.clubName",
            status: "$status",
            date: "$registeredAt",
          },
        },
      ];
      const result = await eventRegistrationsCollection
        .aggregate(pipeline)
        .toArray();
      console.log(result);
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const id = req.params.id;
      const pipeline = [
        {
          $match: { _id: new ObjectId(id) },
        },
        {
          $addFields: { clubIdObj: { $toObjectId: "$clubId" } },
        },
        {
          $lookup: {
            from: "clubs",
            localField: "clubIdObj",
            foreignField: "_id",
            as: "club",
          },
        },
        { $unwind: "$club" },
        {
          $project: {
            title: 1,
            description: 1,
            eventDate: 1,
            location: 1,
            isPaid: 1,
            eventFee: 1,
            clubName: "$club.clubName",
            clubId: "$club._id",
          },
        },
      ];

      const result = await eventsCollection.aggregate(pipeline).toArray();

      res.send(result[0]);
    });

    app.get("/upcoming/events", async (req, res) => {
      const today = new Date().toISOString().split("T")[0];
      const pipeline = [
        {
          $match: {
            eventDate: { $gte: today },
          },
        },
        {
          $addFields: {
            clubIdObj: { $toObjectId: "$clubId" },
          },
        },
        {
          $lookup: {
            from: "clubs",
            localField: "clubIdObj",
            foreignField: "_id",
            as: "club",
          },
        },
        {
          $unwind: {
            path: "$club",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            title: 1,
            description: 1,
            eventDate: 1,
            location: 1,
            isPaid: 1,
            eventFee: 1,
            maxAttendees: 1,
            clubId: 1,
            clubName: "$club.clubName",
          },
        },
        {
          $sort: { eventDate: 1 },
        },
      ];
      const result = await eventsCollection.aggregate(pipeline).toArray();
      res.send(result);
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
