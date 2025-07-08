import { VERIFICATION_EMAIL_TEMPLATE } from '../mailtrap/emailTemplates'
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

export { sendVerificationEmail }
