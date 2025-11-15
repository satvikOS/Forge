const allowedOrigins = [];

if (process.env.ALLOWED_ORIGINS) {
    allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(','));
}

// Allow all Vercel deployment URLs
allowedOrigins.push("*.vercel.app");

// Allow localhost during development
if (process.env.NODE_ENV === 'development') {
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('http://localhost:5173');
}

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.some(allowedOrigin => origin && (origin.endsWith(allowedOrigin.replace('*', ''))))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        console.log(`CORS allowed for origin: ${origin}`);
    } else {
        console.log(`CORS blocked for origin: ${origin}`);
    }
    next();
});
