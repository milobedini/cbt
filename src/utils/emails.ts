import {
  PASSWORD_RESET_REQUEST_TEMPLATE,
  PASSWORD_RESET_SUCCESS_TEMPLATE,
  VERIFICATION_EMAIL_TEMPLATE,
} from '../mailtrap/emailTemplates'
import { mailtrapClient, sender } from '../mailtrap/mailtrap.config'

// In dev/sandbox mode, Mailtrap may only deliver to verified addresses.
// Set MAILTRAP_OVERRIDE_EMAIL in .env to route all mail to a test inbox.
const resolveRecipient = (email: string) => {
  const override = process.env.MAILTRAP_OVERRIDE_EMAIL
  return override || email
}

const sendVerificationEmail = async (
  email: string,
  verificationCode: string
): Promise<void> => {
  const recipient = [{ email: resolveRecipient(email) }]
  try {
    await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: 'Verify Your CBT Email Address',
      html: VERIFICATION_EMAIL_TEMPLATE.replace(
        '{verificationCode}',
        verificationCode
      ),
      category: 'Email Verification',
    })
  } catch (error) {
    console.error('Failed to send verification email:', error)
    throw new Error('Failed to send verification email')
  }
}

const sendWelcomeEmail = async (
  email: string,
  username: string
): Promise<void> => {
  const recipient = [{ email: resolveRecipient(email) }]
  try {
    await mailtrapClient.send({
      from: sender,
      to: recipient,
      template_uuid: '780d86cd-5eee-4e65-b000-093f4300a8ad',
      template_variables: {
        company_info_name: 'CBT',
        name: username,
      },
    })
  } catch (error) {
    console.error('Failed to send welcome email:', error)
    throw new Error('Failed to send welcome email')
  }
}

const sendPasswordResetEmail = async (
  email: string,
  resetUrl: string
): Promise<void> => {
  const recipient = [{ email: resolveRecipient(email) }]
  try {
    await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: 'Reset Your CBT Password',
      html: PASSWORD_RESET_REQUEST_TEMPLATE.replace('{resetURL}', resetUrl),
      category: 'Password Reset',
    })
  } catch (error) {
    console.error('Failed to send password reset email:', error)
    throw new Error('Failed to send password reset email')
  }
}

const sendResetSuccessEmail = async (
  email: string,
  username: string
): Promise<void> => {
  const recipient = [{ email: resolveRecipient(email) }]
  try {
    await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: 'Your CBT Password Has Been Reset',
      html: PASSWORD_RESET_SUCCESS_TEMPLATE.replace('{username}', username),
      category: 'Password Reset',
    })
  } catch (error) {
    console.error('Failed to send password reset success email:', error)
    throw new Error('Failed to send password reset success email')
  }
}

export {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendResetSuccessEmail,
}
