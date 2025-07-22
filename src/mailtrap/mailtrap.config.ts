import { MailtrapClient } from 'mailtrap'
import dotenv from 'dotenv'

// https://mailtrap.io/home

dotenv.config()

export const mailtrapClient = new MailtrapClient({
  token: process.env.MAILTRAP_TOKEN || '',
})

export const sender = {
  email: 'admin@bwellbeing.co.uk',
  name: 'B-Well',
}
