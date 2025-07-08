import {
  PASSWORD_RESET_REQUEST_TEMPLATE,
  PASSWORD_RESET_SUCCESS_TEMPLATE,
  VERIFICATION_EMAIL_TEMPLATE,
} from '../mailtrap/emailTemplates'
import { mailtrapClient, sender } from '../mailtrap/mailtrip.config'

const sendVerificationEmail = async (
  // Temporarily can only use my email
  email: string = 'milobedini64@gmail.com',
  verificationCode: string
): Promise<void> => {
  const recipient = [
    {
      email,
    },
  ]
  try {
    const response = await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: 'Verify Your CBT Email Address',
      html: VERIFICATION_EMAIL_TEMPLATE.replace(
        '{verificationCode}',
        verificationCode
      ),
      category: 'Email Verification',
    })
    console.log(`Email sent successfully to ${email}:`, response)
  } catch (error) {
    console.error(`Failed to send verification email to ${email}:`, error)
    throw new Error(`Failed to send verification email to ${email}: ${error}`)
  }
}

const sendWelcomeEmail = async (
  email: string = 'milobedini64@gmail.com',
  username: string
): Promise<void> => {
  const recipient = [{ email }]
  try {
    const response = await mailtrapClient.send({
      from: sender,
      to: recipient,
      template_uuid: '780d86cd-5eee-4e65-b000-093f4300a8ad',
      template_variables: {
        company_info_name: 'CBT',
        name: username,
      },
    })
    console.log(`Welcome email sent successfully to ${email}:`, response)
  } catch (error) {
    throw new Error(`Failed to send welcome email to ${email}: ${error}`)
  }
}

const sendPasswordResetEmail = async (
  email: string = 'milobedini64@gmail.com',
  resetUrl: string
): Promise<void> => {
  const recipient = [{ email }]
  try {
    const response = await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: 'Reset Your CBT Password',
      html: PASSWORD_RESET_REQUEST_TEMPLATE.replace('{resetURL}', resetUrl),
      category: 'Password Reset',
    })
    console.log(`Password reset email sent successfully to ${email}:`, response)
  } catch (error) {
    console.error(`Failed to send password reset email to ${email}:`, error)
    throw new Error(`Failed to send password reset email to ${email}: ${error}`)
  }
}

const sendResetSuccessEmail = async (
  email: string = 'milobedini64@gmail.com',
  username: string
): Promise<void> => {
  const recipient = [{ email }]
  try {
    const response = await mailtrapClient.send({
      from: sender,
      to: recipient,
      subject: 'Your CBT Password Has Been Reset',
      html: PASSWORD_RESET_SUCCESS_TEMPLATE.replace('{username}', username),
      category: 'Password Reset',
    })
    console.log(
      `Password reset success email sent successfully to ${email}:`,
      response
    )
  } catch (error) {
    throw new Error(
      `Failed to send password reset success email to ${email}: ${error}`
    )
  }
}

export {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendResetSuccessEmail,
}
