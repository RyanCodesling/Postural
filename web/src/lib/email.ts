import * as nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || "accbpostural.noreply@gmail.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

function getTransporter() {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn(
      "[email] SMTP_USER or SMTP_PASS not configured — emails will not be sent."
    );
    return null;
  }
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

// ── Core send function ────────────────────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  try {
    await transporter.sendMail({
      from: `"ACC Bacoor - Postural Monitoring" <${SMTP_FROM}>`,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error("[email] Failed to send email:", err);
    return false;
  }
}

// ── Shared template wrapper ───────────────────────────────────────────────────

function wrapTemplate(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background-color:#f4f7f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#166534,#15803d);padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">
                ACC Bacoor
              </h1>
              <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;font-weight:500;">
                Postural Monitoring System
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;color:#166534;font-size:20px;font-weight:600;">
                ${title}
              </h2>
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f0fdf4;padding:20px 32px;text-align:center;border-top:1px solid #dcfce7;">
              <p style="margin:0;color:#6b7280;font-size:12px;">
                This is an automated message from the ACC Bacoor Postural Monitoring System.
                <br/>Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

// ── Account creation email ────────────────────────────────────────────────────

export async function sendAccountCreationEmail(
  email: string,
  name: string,
): Promise<boolean> {
  const subject = "Welcome to ACC Bacoor Postural Monitoring System";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Your account has been created on the ACC Bacoor Postural Monitoring System. Below are your login credentials:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600;">${email}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Password</p>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;background:#f0fdf4;border:1px solid #bbf7d0;padding:12px 16px;border-radius:6px;">
            Your password is your <strong>last name + year of birth</strong><br/>
            <span style="color:#6b7280;font-size:13px;">(e.g. DelaCruz2004)</span>
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      For security, you will be asked to change your password when you first log in.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
      <tr>
        <td style="background-color:#166534;border-radius:8px;">
          <a href="${APP_URL}" target="_blank" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Log In Now
          </a>
        </td>
      </tr>
    </table>
  `;
  return sendEmail(email, subject, wrapTemplate("Welcome!", body));
}

// ── Password changed email ────────────────────────────────────────────────────

export async function sendPasswordChangedEmail(
  email: string,
  name: string
): Promise<boolean> {
  const subject = "Your Password Has Been Changed";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Your password for the ACC Bacoor Postural Monitoring System has been successfully changed.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#92400e;font-size:14px;line-height:1.5;">
            ⚠️ If you did not make this change, please contact your administrator immediately.
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      You can continue using the system with your new password.
    </p>
  `;
  return sendEmail(email, subject, wrapTemplate("Password Changed", body));
}

// ── OTP email ─────────────────────────────────────────────────────────────────

export async function sendOTPEmail(
  email: string,
  name: string,
  otp: string
): Promise<boolean> {
  const subject = "Your Password Reset Code";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      We received a request to reset your password. Use the verification code below to proceed:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background:linear-gradient(135deg,#166534,#15803d);padding:20px 40px;border-radius:12px;">
            <span style="font-size:36px;font-weight:700;color:#ffffff;letter-spacing:12px;font-family:monospace;">
              ${otp}
            </span>
          </div>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.5;">
            ⏱️ This code expires in <strong>5 minutes</strong>. Do not share it with anyone.
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      If you did not request a password reset, you can safely ignore this email.
    </p>
  `;
  return sendEmail(email, subject, wrapTemplate("Password Reset Code", body));
}

// ── Account created — admin notification ─────────────────────────────────────

export async function sendAccountCreatedAdminEmail(
  adminEmail: string,
  newUserName: string,
  newUserEmail: string,
  newUserRole: string
): Promise<boolean> {
  const subject = "New User Account Created";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      This is a confirmation that a new user account has been created in the system.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Name</p>
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600;">${newUserName}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
          <p style="margin:0 0 16px;color:#111827;font-size:15px;">${newUserEmail}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Role</p>
          <p style="margin:0;color:#111827;font-size:15px;text-transform:capitalize;">${newUserRole}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      An activation email with login credentials has been sent to the new user.
    </p>
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("New Account Created", body));
}

// ── Email address changed — old address ───────────────────────────────────────

export async function sendEmailChangedToOldAddress(
  oldEmail: string,
  name: string,
  newEmail: string
): Promise<boolean> {
  const subject = "Your Email Address Has Been Updated";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      The email address linked to your account on the ACC Bacoor Postural Monitoring System has been changed by an administrator.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Old Email Address</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:15px;text-decoration:line-through;">${oldEmail}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">New Email Address</p>
          <p style="margin:0;color:#111827;font-size:16px;font-weight:600;">${newEmail}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Your new email address <strong>${newEmail}</strong> will now be used to log in to the system.
      This address is no longer active for login.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#92400e;font-size:14px;line-height:1.5;">
            ⚠️ If you did not authorize this change, please contact your administrator immediately.
          </p>
        </td>
      </tr>
    </table>
  `;
  return sendEmail(oldEmail, subject, wrapTemplate("Email Address Updated", body));
}

// ── Email address changed — new address ───────────────────────────────────────

export async function sendEmailChangedToNewAddress(
  newEmail: string,
  name: string,
  oldEmail: string
): Promise<boolean> {
  const subject = "Your New Email Address Is Now Active";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Your email address on the ACC Bacoor Postural Monitoring System has been updated by an administrator. Here are the details:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Previous Email</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:15px;text-decoration:line-through;">${oldEmail}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">New Email (Now Active)</p>
          <p style="margin:0;color:#111827;font-size:16px;font-weight:600;">${newEmail}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Use <strong>${newEmail}</strong> to log in to the system from now on.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
      <tr>
        <td style="background-color:#166534;border-radius:8px;">
          <a href="${APP_URL}" target="_blank" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Log In Now
          </a>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#92400e;font-size:14px;line-height:1.5;">
            ⚠️ If you did not authorize this change, please contact your administrator immediately.
          </p>
        </td>
      </tr>
    </table>
  `;
  return sendEmail(newEmail, subject, wrapTemplate("New Email Address Active", body));
}

// ── Email address changed — admin notification ────────────────────────────────

export async function sendEmailChangedAdminNotification(
  adminEmail: string,
  userName: string,
  oldEmail: string,
  newEmail: string
): Promise<boolean> {
  const subject = "User Email Address Changed";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      This is a confirmation that a user's email address was updated in the system.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">User</p>
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600;">${userName}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Old Email Address</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:15px;text-decoration:line-through;">${oldEmail}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">New Email Address</p>
          <p style="margin:0;color:#111827;font-size:16px;font-weight:600;">${newEmail}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      The user will now use <strong>${newEmail}</strong> to log in to the system.
    </p>
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Email Address Change Notice", body));
}

// ── Account archived — user notification ─────────────────────────────────────

export async function sendAccountArchivedUserEmail(
  email: string,
  name: string,
  role: string
): Promise<boolean> {
  const subject = "Your Account Has Been Archived";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Your <strong>${role}</strong> account on the ACC Bacoor Postural Monitoring System has been archived by an administrator.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#92400e;font-size:14px;line-height:1.5;">
            ⚠️ Your account access has been temporarily suspended. Your records remain intact in the system. If you believe this was done in error, please contact your administrator.
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      Thank you for using the ACC Bacoor Postural Monitoring System.
    </p>
  `;
  return sendEmail(email, subject, wrapTemplate("Account Archived", body));
}

// ── Account archived — admin notification ────────────────────────────────────

export async function sendAccountArchivedAdminEmail(
  adminEmail: string,
  archivedName: string,
  archivedEmail: string,
  archivedRole: string
): Promise<boolean> {
  const subject = "User Account Archived";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      This is a confirmation that the following user account has been archived in the system.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Name</p>
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600;">${archivedName}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
          <p style="margin:0 0 16px;color:#111827;font-size:15px;">${archivedEmail || "—"}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Role</p>
          <p style="margin:0 0 16px;color:#111827;font-size:15px;text-transform:capitalize;">${archivedRole}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      The user's records remain intact. You can restore the account at any time from the Manage Users panel.
    </p>
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Account Archived", body));
}

// ── Account restored — user notification ─────────────────────────────────────

export async function sendAccountRestoredUserEmail(
  email: string,
  name: string,
  role: string
): Promise<boolean> {
  const subject = "Your Account Has Been Restored";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Great news! Your <strong>${role}</strong> account on the ACC Bacoor Postural Monitoring System has been restored by an administrator.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#166534;font-size:14px;line-height:1.5;">
            ✅ Your account is now active again. You can log in using your existing credentials.
          </p>
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
      <tr>
        <td style="background-color:#166534;border-radius:8px;">
          <a href="${APP_URL}" target="_blank" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
            Log In Now
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      All your past records and data remain intact. Welcome back!
    </p>
  `;
  return sendEmail(email, subject, wrapTemplate("Account Restored", body));
}

// ── Account restored — admin notification ────────────────────────────────────

export async function sendAccountRestoredAdminEmail(
  adminEmail: string,
  restoredName: string,
  restoredEmail: string,
  restoredRole: string
): Promise<boolean> {
  const subject = "User Account Restored";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      This is a confirmation that the following user account has been restored and can now access the system.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Name</p>
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600;">${restoredName}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
          <p style="margin:0 0 16px;color:#111827;font-size:15px;">${restoredEmail || "—"}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Role</p>
          <p style="margin:0;color:#111827;font-size:15px;text-transform:capitalize;">${restoredRole}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      The user can now log in and access the system with all their previous records restored.
    </p>
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Account Restoration Confirmation", body));
}

// ── Account permanently deleted — user notification ───────────────────────────

export async function sendAccountDeletedUserEmail(
  email: string,
  name: string,
  role: string
): Promise<boolean> {
  const subject = "Your Account Has Been Permanently Deleted";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hello <strong>${name}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Your <strong>${role}</strong> account on the ACC Bacoor Postural Monitoring System has been permanently deleted by an administrator.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border:1px solid #fee2e2;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.5;">
            🚨 This action is permanent. Your history-free account record and its non-clinical access data cannot be recovered. Accounts with durable clinical or assignment history are archived instead of permanently deleted.
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      Thank you for your time using our system.
    </p>
  `;
  return sendEmail(email, subject, wrapTemplate("Account Deleted", body));
}

// ── Account permanently deleted — admin notification ──────────────────────────

export async function sendAccountDeletedAdminEmail(
  adminEmail: string,
  deletedName: string,
  deletedEmail: string,
  deletedRole: string
): Promise<boolean> {
  const subject = "User Account Permanently Deleted";
  const body = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      This is a confirmation that the following user account has been permanently deleted from the system.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border:1px solid #fee2e2;border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Name</p>
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600;">${deletedName}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Email</p>
          <p style="margin:0 0 16px;color:#111827;font-size:15px;">${deletedEmail || "—"}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Role</p>
          <p style="margin:0;color:#111827;font-size:15px;text-transform:capitalize;">${deletedRole}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
      The account passed the archived and history-free eligibility checks before deletion. Accounts with durable clinical or assignment history remain archived and cannot be permanently deleted.
    </p>
  `;
  return sendEmail(adminEmail, subject, wrapTemplate("Account Deletion Confirmation", body));
}
