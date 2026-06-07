// Load built-in Node.js system utilities
const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose'); // 🔌 Added Mongoose for Database Persistence

const PORT = process.env.PORT || 5000;

// =========================================================================
// MONGODB CONNECTION SETUP
// =========================================================================
// Use Render's environment variables. Fallback to local string if testing locally.
// Replace line 12 with this line:
const MONGO_URI = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/campusmarket";

mongoose.connect(MONGO_URI)
    .then(() => console.log("🔌 Connected to MongoDB Atlas successfully!"))
    .catch(err => console.error("❌ MongoDB connection failure:", err));

// Define User Schema (Enforces UNIQUE usernames at database level)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// Define Marketplace Item Schema (Stores product and compressed mobile images)
const itemSchema = new mongoose.Schema({
    title: { type: String, required: true },
    price: { type: String, required: true },
    category: { type: String, default: "textbooks" },
    location: { type: String, required: true },
    isPremium: { type: Boolean, default: false },
    username: { type: String, required: true },
    image: { type: String, default: null }, // Saved image string
    createdAt: { type: Date, default: Date.now }
});
const Item = mongoose.model('Item', itemSchema);


const server = http.createServer((req, res) => {
    // SECURITY HANDSHAKE: Allow browser communications locally across ports
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Token');

    if (req.method === 'OPTIONS') { 
        res.writeHead(200); 
        res.end(); 
        return; 
    }

    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    // =========================================================================
    // ROUTE 1 & 2: SERVE FRONTEND STATIC FILES (INDEX.HTML / AUTH.HTML)
    // =========================================================================
    if (pathname === '/' || pathname === '/index.html' || pathname === '/auth.html') {
        const filename = (pathname === '/' || pathname === '/index.html') ? 'index.html' : 'auth.html';
        const targetPath = path.join(__dirname, filename);

        fs.readFile(targetPath, (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`System Error: Missing ${filename} in your folder!`);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        });
        return;
    }

    // =========================================================================
    // ROUTE 3: DYNAMIC USER REGISTRATION (With Database Verification)
    // =========================================================================
    if (pathname === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (!data.username || !data.password || !data.phone) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Missing required fields!" }));
                    return;
                }

                // Query MongoDB case-insensitively to see if username is already taken
                const usernameClean = data.username.trim();
                const exists = await User.findOne({ username: new RegExp(`^${usernameClean}$`, 'i') });
                
                if (exists) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Username taken! Please log in instead." }));
                    return;
                }

                // Save permanent new account to MongoDB Atlas
                const newUser = new User({
                    username: usernameClean,
                    password: data.password,
                    phone: data.phone.replace(/[^0-9]/g, '')
                });
                await newUser.save();

                console.log(`👤 Database Saved: ${newUser.username}`);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: "Account created successfully!" }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Database registration error." }));
            }
        });
        return;
    }

    // =========================================================================
    // ROUTE 4: DYNAMIC USER LOGIN (Verifies Against Database Records)
    // =========================================================================
    if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const credentials = JSON.parse(body);
                const userClean = credentials.username ? credentials.username.trim() : '';

                // Locate profile in MongoDB database matching details
                const user = await User.findOne({ 
                    username: new RegExp(`^${userClean}$`, 'i'), 
                    password: credentials.password 
                });

                if (user) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: "Access Granted!", 
                        token: user.username,
                        username: user.username
                    }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Invalid username or password credentials." }));
                }
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Malformed login payload." }));
            }
        });
        return;
    }

    // =========================================================================
    // ROUTE 5: PRODUCT GETTING & INTELLIGENT POST COUNT CHECKING
    // =========================================================================
    if (pathname.startsWith('/api/items') && req.method === 'GET') {
        const userToCheck = parsedUrl.searchParams.get('username');

        // Wrap logic inside an async execution wrapper
        (async () => {
            try {
                if (userToCheck) {
                    const userPostCount = await Item.countDocuments({ username: userToCheck });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, postCount: userPostCount }));
                    return;
                }

                // Get all database items sorted newest first
                const databaseItems = await Item.find().sort({ createdAt: -1 });

                // Cross-reference user documents to pull correct cellular contacts dynamically
                const enrichedItems = await Promise.all(databaseItems.map(async (item) => {
                    const sellerInfo = await User.findOne({ username: item.username });
                    return {
                        _id: item._id,
                        title: item.title,
                        price: item.price,
                        category: item.category,
                        location: item.location,
                        isPremium: item.isPremium,
                        username: item.username,
                        image: item.image,
                        phone: sellerInfo ? sellerInfo.phone : "254712345678"
                    };
                }));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, items: enrichedItems }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Error fetching catalog rows." }));
            }
        })();
        return;
    }

    // =========================================================================
    // ROUTE 6: SECURE SUBMIT LISTING (Saves directly to MongoDB Collection)
    // =========================================================================
    if (pathname === '/api/items' && req.method === 'POST') {
        const authHeader = req.headers['authorization'];
        const currentUser = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        if (!currentUser) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: "Unauthorized! Missing user session token." }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (!data.title || !data.price || !data.location) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Missing required core product fields!" }));
                    return;
                }

                // Save product structure cleanly into database collection matching images
                const newItem = new Item({
                    title: data.title,
                    price: data.price,
                    category: data.category || "textbooks",
                    location: data.location,
                    isPremium: data.isPremium || false,
                    username: currentUser,
                    image: data.image // Image file data correctly saved here
                });
                
                await newItem.save();
                console.log(`🎒 Database saved listing: "${newItem.title}" for user: ${currentUser}`);
                
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: "Saved successfully!", item: newItem }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Data processing error." }));
            }
        });
        return;
    }

    // =========================================================================
    // ROUTE 7: TEMPORARY FREE BETA UPGRADE
    // =========================================================================
    if (pathname === '/api/mpesa-pay' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                console.log(`🎉 FREE BETA: Auto-upgrading listing to Premium!`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: "Beta Launch Special: Your item has been upgraded to Premium for FREE!" 
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Upgrade failed." }));
            }
        });
        return;
    }

    // =========================================================================
    // ROUTE 8: SECURE OWNERSHIP DELETE VALIDATION
    // =========================================================================
    if (pathname.startsWith('/api/items') && req.method === 'DELETE') {
        const authHeader = req.headers['authorization'];
        const currentUser = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        const idToDelete = parsedUrl.searchParams.get('id'); 

        (async () => {
            try {
                const targetItem = await Item.findById(idToDelete);

                if (!targetItem) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Listing not found on campus registry." }));
                    return;
                }

                if (targetItem.username !== currentUser) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Access Denied: You do not own this campus listing!" }));
                    return;
                }

                await Item.findByIdAndDelete(idToDelete);
                console.log(`🗑️ Database deleted item ID: ${idToDelete} by user: ${currentUser}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: "Item deleted from server successfully!" }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Invalid ID parameter request." }));
            }
        })();
        return;
    }

    // =========================================================================
    // FALLBACK 404: RESOURCE NOT FOUND
    // =========================================================================
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: "Error 404: Resource endpoint not found." }));
});

// START THE SERVER LOUDSPEAKER
server.listen(PORT, () => {
    console.log(`🚀 CampusMarket Engine Live! Run your dashboard at http://localhost:${PORT}/auth.html`);
});