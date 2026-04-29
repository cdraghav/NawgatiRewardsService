import { fromNodeHeaders } from "better-auth/node";
import { auth } from '../lib/auth.js';

export const requireAuth = async (req, res, next) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session) {
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  }

  req.user = session.user;
  req.session = session.session;
  next();
};
