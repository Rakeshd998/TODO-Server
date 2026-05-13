import nodemailer from 'nodemailer';

const createTransporter = () =>
  nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE ?? 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Gmail App Password (not your normal password)
    },
  });

export const sendPasswordResetEmail = async (
  toEmail: string,
  resetUrl: string
): Promise<void> => {
  const transporter = createTransporter();

  const year = new Date().getFullYear();

  const mailOptions = {
    from: `"Grip" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Reset your Grip password',
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your Grip password</title>
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:Arial,Helvetica,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a14;padding:40px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="560" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;width:100%;background:#12121f;border-radius:16px;overflow:hidden;border:1px solid #1e1e30;">

          <!-- ── Header ── -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%);padding:36px 40px;text-align:center;">

              <!-- Logo: hosted PNG (works in all email clients) -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px;">
                <tr>
                  <td valign="middle" style="padding-right:12px;">
                    <img src="https://todo-type-script-nu.vercel.app/grip-logo.png"
                         alt="Grip Logo"
                         width="52" height="52"
                         style="display:block;border-radius:12px;" />
                  </td>
                  <!-- Wordmark -->
                  <td valign="middle">
                    <span style="font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Grip</span>
                  </td>
                </tr>
              </table>

              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
                Password Reset Request
              </h1>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);">
                We received a request to reset your account password
              </p>
            </td>
          </tr>

          <!-- ── Body ── -->
          <tr>
            <td style="padding:40px;">

              <p style="margin:0 0 24px;font-size:15px;color:#b0b0c8;line-height:1.7;">
                Hi there,
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#b0b0c8;line-height:1.7;">
                Someone requested a password reset for the Grip account associated with
                <strong style="color:#e2e2f0;">${toEmail}</strong>.
                If this was you, click the button below to choose a new password. The link is valid for
                <strong style="color:#e2e2f0;">1 hour</strong>.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 36px;">
                <tr>
                  <td align="center" style="border-radius:10px;background:linear-gradient(135deg,#7c3aed,#4f46e5);">
                    <a href="${resetUrl}"
                       target="_blank"
                       style="display:inline-block;padding:15px 40px;font-size:16px;font-weight:700;
                              color:#ffffff;text-decoration:none;letter-spacing:0.2px;border-radius:10px;">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%"
                     style="background:#1a1a2e;border-radius:10px;border:1px solid #2a2a40;margin-bottom:32px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#8b8baa;text-transform:uppercase;letter-spacing:0.8px;">
                      🔒 Security Notice
                    </p>
                    <p style="margin:0;font-size:13px;color:#8080a0;line-height:1.65;">
                      If you did <strong style="color:#a0a0c0;">not</strong> request a password reset,
                      you can safely ignore this email — your password will not change and your account
                      remains secure. No action is required.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #1e1e30;margin:0 0 24px;" />

              <!-- Fallback link -->
              <p style="margin:0 0 6px;font-size:12px;color:#606078;">
                Button not working? Copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;word-break:break-all;">
                <a href="${resetUrl}" style="color:#7c3aed;">${resetUrl}</a>
              </p>

            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="background:#0d0d1a;padding:24px 40px;border-top:1px solid #1e1e30;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#404058;">
                This is an automated message — please do not reply to this email.
              </p>
              <p style="margin:0;font-size:12px;color:#404058;">
                &copy; ${year} Grip. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>
    `,
  };

  await transporter.sendMail(mailOptions);
};
