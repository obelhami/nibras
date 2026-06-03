import jsonwebtoken from 'jsonwebtoken';

const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export const createAccessToken = (user: { username: string; email: string; role?: string | null }) =>
  jsonwebtoken.sign(
    { email: user.email, username: user.username, ...(user.role ? { role: user.role } : {}) },
    jwtSecret,
    { expiresIn: '15m' }
  );

export const createRefreshToken = (user: { email: string }) =>
  jsonwebtoken.sign(
    { email: user.email },
    jwtSecret,
    { expiresIn: '7d' }
  );

export const createVerificationToken = (user: { username: string; email: string }) =>
  jsonwebtoken.sign(
    { email: user.email, username: user.username, purpose: 'verification' },
    jwtSecret,
    { expiresIn: '24h' }
  );

export const verifyAuthToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length);

  try {
    return jsonwebtoken.verify(token, jwtSecret) as {
      email: string;
      username: string;
      purpose?: 'verification';
      iat: number;
      exp: number;
    };
  } catch {
    return null;
  }
};
