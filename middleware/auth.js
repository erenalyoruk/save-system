const { createClient } = require('@supabase/supabase-js');

// This middleware assumes you are passing the Supabase JWT
// in the Authorization header as 'Bearer <YOUR_SUPABASE_JWT>'

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Create a single Supabase client for validating JWTs
// Note: We don't need service_role key here if we are just validating user's JWT and relying on RLS.
// The anon key is sufficient for getUser method.
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Unauthorized: Missing or invalid Authorization header.',
    });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Missing token.' });
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('JWT validation error:', error);
      return res.status(401).json({
        message: 'Unauthorized: Invalid token or user not found.',
        details: error?.message,
      });
    }

    req.user = user; // Attach user information to the request object
    next();
  } catch (err) {
    console.error('Auth middleware unexpected error:', err);
    return res.status(500).json({ message: 'Internal server error during authentication.' });
  }
}

module.exports = authMiddleware;
