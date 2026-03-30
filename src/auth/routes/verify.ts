import type { ServerResponse } from 'http';
import type { ResolvedAuthConfig } from '../types.js';

export async function handleVerifyEmail(
  config: ResolvedAuthConfig,
  url: URL,
  res: ServerResponse,
  db?: any,
): Promise<boolean> {
  const token = url.searchParams.get('token');

  // If no DB or no token, redirect to verify page which shows proper UI
  if (!db || !token) {
    res.writeHead(302, { Location: `/auth/verify${token ? '?token=' + encodeURIComponent(token) : '?error=missing'}` });
    res.end();
    return true;
  }

  const { verifyVerificationToken, verifyUserEmail } = await import('../native-auth.js');
  const userId = verifyVerificationToken(token, config.session.secret);
  if (!userId) {
    res.writeHead(302, { Location: '/auth/verify?error=invalid' });
    res.end();
    return true;
  }

  const verified = await verifyUserEmail(db, userId);
  if (!verified) {
    res.writeHead(302, { Location: '/auth/verify?error=not_found' });
    res.end();
    return true;
  }

  // Redirect to login page with success message
  res.writeHead(302, { Location: `${config.routes.loginPage}?verified=true` });
  res.end();
  return true;
}
