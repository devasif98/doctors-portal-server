const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { query } = require('express');
require('dotenv').config();
const { ObjectId } = require('mongodb');
const multer = require('multer');
const firebase = require("firebase/app");

const {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
} = require("firebase/storage");

const firebaseConfig = {
    apiKey: process.env.DB_api,
    authDomain: process.env.DB_authDomain,
    projectId: process.env.DB_projectId,
    storageBucket: process.env.DB_storageBucket,
    messagingSenderId: process.env.DB_messagingSenderId,
    appId: process.env.DB_appId,
};
firebase.initializeApp(firebaseConfig);
const storage = getStorage();
const upload = multer({ storage: multer.memoryStorage() });



const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;

const app = express();

// middleware
app.use(cors()); 0
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.0iyuemt.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }
    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctors-portal').collection('appointmentOptions');

        const bookingsCollection = client.db('doctors-portal').collection('bookings');

        const usersCollection = client.db('doctors-portal').collection('users');
        const doctorsCollection = client.db('doctors-portal').collection('doctors');

        //  Use Aggregate to query multiple collection and then merge data
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();
            // get the bookings of the provided date
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            // code carefully :D
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options);
        })

        app.get('/bookings', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })


        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                treatment: booking.treatment,
                booking: booking.email
            }


            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }

            console.log(booking);
            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        })
        // token
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: '' })
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log(user);
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })
        app.get('/users', async (req, res) => {
            try {
                const allUsers = await usersCollection.find({}).toArray();
                res.send(allUsers);
            } catch (error) {
                console.error('Error retrieving users:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });
        app.patch('/users/:userId', async (req, res) => {
            const userId = req.params.userId;

            try {
                // Fetch the current user
                const currentUser = await usersCollection.findOne({ _id: ObjectId(userId) });

                if (!currentUser) {
                    return res.status(404).send("User not found");
                }

                // Toggle userType between "user" and "admin"
                const newType = currentUser.userType === "user" ? "admin" : "user";

                // Update the user with the new userType
                const result = await usersCollection.updateOne(
                    { _id: ObjectId(userId) },
                    { $set: { userType: newType } }
                );

                if (result.modifiedCount === 1) {
                    res.send(`User userType updated to ${newType} successfully`);
                } else {
                    res.status(500).send("Failed to update user");
                }
            } catch (error) {
                console.error("Error updating user:", error);
                res.status(500).send("Internal server error");
            }
        });
        app.delete('/users/:userId', async (req, res) => {
            const userId = req.params.userId;

            try {
                // Check if the user exists
                const user = await usersCollection.findOne({ _id: ObjectId(userId) });

                if (!user) {
                    return res.status(404).send("User not found");
                }

                // Delete the user
                const result = await usersCollection.deleteOne({ _id: ObjectId(userId) });

                if (result.deletedCount === 1) {
                    res.send("User deleted successfully");
                } else {
                    res.status(500).send("Failed to delete user");
                }
            } catch (error) {
                console.error("Error deleting user:", error);
                res.status(500).send("Internal server error");
            }
        });

        app.post("/uploadPhoto", upload.single("imageFile"), (req, res) => {
            if (!req.file) {

                res.status(400).send("No file uploaded.");
                return;
            }
            const storageRef = ref(storage, `doctors/${req.file.originalname}`);
            const metadata = {
                contentType: "image/jpeg",
            };
            uploadBytes(storageRef, req.file.buffer, metadata)
                .then(() => {
                    getDownloadURL(storageRef).then((url) => {
                        res.send({ url });
                    });
                })
                .catch((error) => {
                    console.error(error);
                    res.status(500).send(error);
                });
        });
        app.post("/uploadUsersPhoto", upload.single("imageFile"), (req, res) => {
            if (!req.file) {

                res.status(400).send("No file uploaded.");
                return;
            }
            const storageRef = ref(storage, `users/${req.file.originalname}`);
            const metadata = {
                contentType: "image/jpeg",
            };
            uploadBytes(storageRef, req.file.buffer, metadata)
                .then(() => {
                    getDownloadURL(storageRef).then((url) => {
                        res.send({ url });
                    });
                })
                .catch((error) => {
                    console.error(error);
                    res.status(500).send(error);
                });
        });
        app.post("/addDoctor", async (req, res) => {
            const upLoaded = req.body;
            const result = await doctorsCollection.insertOne(upLoaded);
            res.send(result);
          });
        app.get('/doctors', async (req, res) => {
            try {
                const allUsers = await doctorsCollection.find({}).toArray();
                res.send(allUsers);
            } catch (error) {
                console.error('Error retrieving users:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });
        app.delete('/doctors/:doctorId', async (req, res) => {
            const doctorId = req.params.doctorId;

            try {
                // Check if the doctor exists
                const doctor = await doctorsCollection.findOne({ _id: ObjectId(doctorId) });

                if (!doctor) {
                    return res.status(404).send("Doctor not found");
                }

                // Delete the doctor
                const result = await doctorsCollection.deleteOne({ _id: ObjectId(doctorId) });

                if (result.deletedCount === 1) {
                    res.send("Doctor deleted successfully");
                } else {
                    res.status(500).send("Failed to delete doctor");
                }
            } catch (error) {
                console.error("Error deleting doctor:", error);
                res.status(500).send("Internal server error");
            }
        });



    }
    finally {

    }
}
run().catch(console.log);

app.get('/', async (req, res) => {
    res.send('doctors portal server is running');
})

app.listen(port, () => console.log(`doctors portal running on ${port}`))