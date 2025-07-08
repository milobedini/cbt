import mongoose, { Document } from 'mongoose'

type IUser = Document & {
  username: string
  email: string
  password: string
  createdAt: Date
  updatedAt: Date
  verificationCode?: string
  verificationCodeExpires?: Date
  isVerified?: boolean
  resetPasswordToken?: string
  resetPasswordExpires?: Date
  lastLogin: Date
}

const userSchema = new mongoose.Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, 'Username is required!'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters long!'],
      maxlength: [20, 'Username cannot exceed 50 characters!'],
    },
    email: {
      type: String,
      required: [true, 'Email is required!'],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (value: string): boolean {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          return emailRegex.test(value)
        },
        message: 'Invalid email format!',
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required!'],
      minlength: [8, 'Password must be at least 8 characters long!'],
      select: false,
    },
    verificationCode: {
      type: String,
      // select: false,
    },
    verificationCodeExpires: {
      type: Date,
      // select: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'users-data',
  }
)

const User = mongoose.model<IUser>('User', userSchema)

export default User
export { IUser }
