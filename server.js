// Load built-in Node.js system utilities (No internet connection required)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;

// Central mock database arrays stored in server memory
let registeredUsers = [
    { username: "admin", password: "123", phone: "254712345678" }
];

let marketplaceItems = []; // Initialized as completely clean!

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
    // ROUTE 3: DYNAMIC USER REGISTRATION
    // =========================================================================
    if (pathname === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (!data.username || !data.password || !data.phone) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Missing required fields!" }));
                    return;
                }
                const exists = registeredUsers.some(u => u.username.toLowerCase() === data.username.toLowerCase());
                if (exists) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Username taken!" }));
                    return;
                }
                const newUser = {
                    username: data.username.trim(),
                    password: data.password,
                    phone: data.phone.replace(/[^0-9]/g, '')
                };
                registeredUsers.push(newUser);
                console.log(`👤 Registered: ${newUser.username}`);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: "Account created successfully!" }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: "Malformed payload." }));
            }
        });
        return;
    }

    // =========================================================================
    // ROUTE 4: DYNAMIC USER LOGIN
    // =========================================================================
    if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const credentials = JSON.parse(body);
                const user = registeredUsers.find(u => 
                    u.username.toLowerCase() === credentials.username.toLowerCase() && 
                    u.password === credentials.password
                );
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
                    res.end(JSON.stringify({ success: false, message: "Invalid credentials." }));
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

        if (userToCheck) {
            const userPostCount = marketplaceItems.filter(item => item.username === userToCheck).length;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, postCount: userPostCount }));
            return;
        }

        const enrichedItems = marketplaceItems.map(item => {
            const sellerInfo = registeredUsers.find(u => u.username === item.username);
            return {
                ...item,
                sellerPhone: sellerInfo ? sellerInfo.phone : "254712345678"
            };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, items: enrichedItems }));
        return;
    }

    // =========================================================================
    // ROUTE 6: SECURE SUBMIT LISTING
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
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (!data.title || !data.price || !data.location) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: "Missing required core product fields!" }));
                    return;
                }

                const newItem = {
                    _id: Date.now().toString(),
                    title: data.title,
                    price: data.price,
                    category: data.category || "textbooks",
                    location: data.location,
                    isPremium: data.isPremium || false,
                    username: currentUser
                };
                
                marketplaceItems.unshift(newItem);
                console.log(`🎒 Server saved listing: "${newItem.title}" for user: ${currentUser}`);
                
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
                // In the future, this is where Safaricom code goes.
                // For now, we auto-approve the premium request for the Beta!
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
        const targetItem = marketplaceItems.find(item => item._id === idToDelete);

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

        marketplaceItems = marketplaceItems.filter(item => item._id !== idToDelete);
        console.log(`🗑️ Securely deleted item ID: ${idToDelete} by user: ${currentUser}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: "Item deleted from server successfully!" }));
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