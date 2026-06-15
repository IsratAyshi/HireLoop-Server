const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express');
const app = express()
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// middleware, app.use() means run before every api request
app.use(cors());
app.use(express.json());

const port = 5000;
const uri = process.env.MONGODB_URI;

app.get('/', (req, res) => {
  res.send('Hello World!')
})


// custom middleware, can be used in any specific route before async (req, res) or use app.use(logger) to run on all routes
const logger = (req, res, next) => {
    console.log("logger middleware logged", req.params);
    next(); // continue to the next stage
}



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("hireloop_db");
    const jobCollection = database.collection("jobs");
    const companyCollection = database.collection("companies");
    const usersCollection = database.collection("user");
    const applicationsCollection = database.collection("applications");
    const planCollection = database.collection("plans");
    const subscriptionCollection = database.collection('subscriptions');
    const sessionCollection = database.collection('session');



    // VERIFICATION RELATED

    // custom middleware to verify token for private api routes
    const verifyToken = async(req, res, next) => {
        // console.log('headers', req.headers);
        const authHeader = req.headers?.authorization;

        if (!authHeader) {
            return res.status(401).send({message: 'Unauthorized access'});
        }

        const token = authHeader.split(' ')[1];
        // console.log('token', token);

        if (!token) {
            return res.status(401).send({message: 'Unauthorized access'});
        }

        // Now fetch the session user using the token
        const query = { token: token };
        const session = await sessionCollection.findOne(query);
        console.log('session: ', session);

        const userId = session.userId;
        
        const userQuery = {
            _id: userId
        }

        const user = await usersCollection.findOne(userQuery);
        console.log('user of the current session: ', user);


        // set data in the req object
        req.user = user;
        next();
    }


    // must be used after verifyToken, because verifyToken sets the req.user we're using here
    const verifySeeker = async(req, res, next) => {
        if (req.user?.role !== 'seeker') {
            return res.status(403).send({message: 'Forbidden access'});
        } 
        next();
    }

    // must be used after verifyToken middleware
    const verifyAdmin = async(req, res, next) => {
        if (req.user?.role !== 'admin') {
            return res.status(403).send({message: 'Forbidden access'});
        }
        next();
    }

    // must be used after verifyToken middleware
    const verifyRecruiter = async(req, res, next) => {
        if (req.user?.role !== 'recruiter') {
            return res.status(403).send({message: 'Forbidden access'});
        }
        next();
    }

    
    // --- API routes ---
    app.get('/api/users', async (req, res) => {
        const cursor = usersCollection.find().skip(1);
        const result = await cursor.toArray();
        res.send(result);
    })

    // job related APIs
    app.get('/api/jobs', async (req, res) => {
        const query = {};

        if (req.query.companyId) {
            query.companyId = req.query.companyId;
        }
        if (req.query.status) {
            query.status = req.query.status;
        }

        const cursor = jobCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
    });

    app.get('/api/jobs/:id', async (req, res) => {
        const id = req.params.id;
        const query = { 
            _id: new ObjectId(id) 
        };
        const result = await jobCollection.findOne(query);
        res.send(result);
    });

    app.post('/api/jobs', async (req, res) => {
        const job = req.body;

        // add createdAt from the server side instead of the client, so that the date is always the same and centralized
        const newJob = {
            ...job,
            createdAt: new Date()
        }
        const result = await jobCollection.insertOne(newJob);
        res.send(result);
    });



    // application related APIs
    app.get('/api/applications', verifyToken, verifySeeker, async (req, res) => {
        const query = {};

        // what if applicant wants to find their applications
        if (req.query.applicantId) {
            query.applicantId = req.query.applicantId;

            // after verifying as a seeker user, verify their own applicantId. Check whether asking for their own info or someone else's
            console.log(req.user, req.query.applicantId);
            if (req.user._id.toString() !== req.query.applicantId) {
                return res.status(403).send({message: 'Forbidden access'});
            }
            
        }
        
        // what if recruiter wants to find applications for a specific job
        if (req.query.jobId) {
            query.jobId = req.query.jobId;
        }

        const cursor = applicationsCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
        
    });

    app.post('/api/applications', async (req, res) => {
        const application = req.body;

        // add createdAt from the server side 
        const newApplication = {
            ...application,
            createdAt: new Date()
        }
        const result = await applicationsCollection.insertOne(newApplication);
        res.send(result);
    })


    // company related APIs

    // app.get('/api/companies', async (req, res) => {
    //     const cursor = companyCollection.find().skip(2);
    //     const result = await cursor.toArray();
    //     res.send(result);
    // });

    // inefficient way to join/aggregate collections
    app.get('/api/companies', verifyToken, async (req, res) => {
        // const cursor = companyCollection.find();
        const cursor = companyCollection.find().sort({ createdAt: -1 }).skip(2); //descending
        const companies = await cursor.toArray();

        for (const company of companies) {
            const filter = { 
                companyId: company._id.toString()
            };
            const jobCount = await jobCollection.countDocuments(filter);
            company.jobCount = jobCount;
        }

        res.send(companies);
    });

    // efficient way to join/aggregate collections
    app.get('/api/companies2', async (req, res) => {
        const pipeline = [
            { $skip: 2 },
            { $limit: 2 },         
        ];

        const cursor = companyCollection.aggregate(pipeline);
        const result = await cursor.toArray();
        res.send(result);
    });

    // join/aggregate collections example
    app.get('api/stats', async (req, res) => {
        const pipeline = [
            { 
                $group: {   
                    _id: "$jobType", // group key field
                    count: { $sum: 1 } // count the number of documents in each group, +1 for each doc
                } 
            },
            {
                $project: {
                    jobType: "$_id", // rename _id to jobType
                    count: 1, // keep count field
                    _id: 0 // remove _id field
                }
            }, 
            {
                $sort: { count: 1 } // ascending based on count field
            }
            
        ]

        const cursor = jobCollection.aggregate(pipeline);
        const result = await cursor.toArray();
        res.send(result);
    })
    

    app.get('/api/my/companies', async (req, res) => {
        const query = {};
        if (req.query.recruiterId) {
            query.recruiterId = req.query.recruiterId;
        }
        const result = await companyCollection.findOne(query);
        res.send(result || {});
        // use res.json(result) instead of res.send(result), it sends "null" as valid JSON when nothing found
    });

    app.post('/api/companies', async (req, res) => {
        const company = req.body;

        const newCompany = {
            ...company,
            createdAt: new Date()
        }
        const result = await companyCollection.insertOne(newCompany);
        res.send(result);
    });

    app.patch('/api/companies/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const updatedCompany = req.body;
        const filter = { _id: new ObjectId(id) };

        const updateDoc = {
            $set: {
                status: updatedCompany.status,
                // updatedAt: new Date()
            }
        }
        const result = await companyCollection.updateOne(filter, updateDoc);
        res.send(result);
    })


    // plan related APIs
    app.get('/api/plans', async (req, res) => {
        const query = {};

        if (req.query.plan_id) {
            query.planId = req.query.plan_id;
        }

        const plan = await planCollection.findOne(query);
        res.send(plan);
        
    });


    // subscription related APIs

    app.post('/api/subscriptions', async (req, res) => {
        const data = req.body;
        const subsInfo = {
            ...data,
            createdAt: new Date()
        }

        const result = await subscriptionCollection.insertOne(subsInfo);
        
        // update the user form information 
        const filter = { 
            email: data.email
         };
        const updateDocument = {
            $set: {
                plan: data.planId,
            }
         }

         const updateResult = await usersCollection.updateOne(filter, updateDocument);
         res.send(updateResult);
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);




app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})