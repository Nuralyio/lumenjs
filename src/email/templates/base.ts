/**
 * Shared HTML email layout wrapper.
 * Table-based for maximum email client compatibility (Outlook, Gmail, Apple Mail).
 */
export function renderTemplate(appName: string, content: string, footerText?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
</head>
<body style="margin:0; padding:0; background-color:#f7f9f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f9f9;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; background-color:#ffffff; border-radius:12px; overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 0; text-align:center;">
              <div style="display:inline-block; width:40px; height:40px; background-color:#0f1419; color:#ffffff; border-radius:8px; font-size:20px; font-weight:900; line-height:40px; text-align:center;">N</div>
              <div style="font-size:14px; font-weight:700; color:#0f1419; margin-top:8px;">${appName}</div>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:24px 40px 40px;">
              ${content}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="padding:24px 40px; text-align:center; font-size:12px; color:#536471; line-height:1.5;">
              ${footerText || `This email was sent by ${appName}. If you didn't expect this, you can safely ignore it.`}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Render a purple CTA button */
export function renderButton(text: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td align="center">
      <a href="${url}" target="_blank" style="display:inline-block; padding:14px 32px; background-color:#7c3aed; color:#ffffff; font-size:16px; font-weight:700; text-decoration:none; border-radius:9999px;">
        ${text}
      </a>
    </td>
  </tr>
</table>`;
}
