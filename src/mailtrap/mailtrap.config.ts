import { MailtrapClient } from 'mailtrap'
import dotenv from 'dotenv'

dotenv.config()

const token = process.env.MAILTRAP_TOKEN
if (!token && process.env.NODE_ENV === 'production') {
  throw new Error('MAILTRAP_TOKEN environment variable is required in production')
}

export const mailtrapClient = new MailtrapClient({
  token: token || '',
})

export const sender = {
  email: 'admin@bwellbeing.co.uk',
  name: 'B-Well',
}
