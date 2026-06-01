import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

export async function sendVerificationEmail(to: string, token: string, username: string) {
    const verifyUrl = `${BACKEND_URL}/auth/verify?token=${token}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#0f0f13;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f13;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#1a1a24;border-radius:16px;overflow:hidden;border:1px solid #2a2a3a;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 0 40px;text-align:center;">
              <h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Nibras</h1>
              <p style="margin:8px 0 0 0;font-size:13px;color:#6b7094;text-transform:uppercase;letter-spacing:2px;">Email Verification</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#2a2a3a,transparent);"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:0 40px;">
              <p style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:#e4e4ed;">
                Welcome, ${username}!
              </p>
              <p style="margin:0 0 28px 0;font-size:14px;line-height:1.7;color:#9394a5;">
                Thank you for joining Nibras. To complete your registration and unlock your workspace, please verify your email address by clicking the button below.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:0 40px;" align="center">
              <a href="${verifyUrl}" target="_blank"
                 style="display:inline-block;padding:14px 40px;background-color:#3b82f6;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                Verify My Email
              </a>
            </td>
          </tr>

          <!-- Alt link -->
          <tr>
            <td style="padding:24px 40px 0 40px;">
              <p style="margin:0;font-size:12px;color:#6b7094;line-height:1.6;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:6px 0 0 0;font-size:12px;word-break:break-all;">
                <a href="${verifyUrl}" style="color:#60a5fa;text-decoration:none;">${verifyUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Expiry notice -->
          <tr>
            <td style="padding:28px 40px;">
              <div style="background-color:#13131c;border-radius:10px;padding:14px 18px;border:1px solid #2a2a3a;">
                <p style="margin:0;font-size:12px;color:#6b7094;line-height:1.5;">
                  This link expires in <strong style="color:#9394a5;">24 hours</strong>. If you did not create an account on Nibras, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:0 40px 32px 40px;text-align:center;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#2a2a3a,transparent);margin-bottom:20px;"></div>
              <p style="margin:0;font-size:11px;color:#4a4b5e;">&copy; 2026 Nibras. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'Nibras <noreply@nibras.dev>',
        to,
        subject: 'Verify your email — Nibras',
        html,
    });

    if (error) {
        console.error('Failed to send verification email:', error);
      const providerMessage =
        typeof error === 'object' && error && 'message' in error
          ? String(error.message)
          : 'Failed to send verification email';

      throw new Error(providerMessage);
    }
}
