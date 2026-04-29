import express from 'express';
import cors from 'cors';
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from './lib/auth.js';
import voucherRoutes from './routes/voucherRoutes.js'
import utilsRoutes from './routes/utilsRoutes.js';
import { requireAuth } from './middlewares/auth.js';
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use("/api/auth", toNodeHandler(auth));

app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));

app.get('/api/me', async (req, res) => {
  const session = await auth.api.getSession(fromNodeHeaders(req.headers));
  if (!session) return res.status(401).json({ success: false, message: 'Not logged in' });
  res.json({ success: true, user: session.user });
});

app.use('/api/voucher', voucherRoutes)
app.use('/api/utils', requireAuth, utilsRoutes)

export default app;
