import mongoose, { Document } from 'mongoose'

enum UserRole {
  THERAPIST = 'therapist',
  PATIENT = 'patient',
  ADMIN = 'admin',
}

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
  roles: UserRole[]
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
    },
    verificationCodeExpires: {
      type: Date,
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
    roles: {
      type: [String],
      enum: Object.values(UserRole),
      required: [true, 'At least one user role is required!'],
      validate: {
        validator: (arr: string[]) => arr.length > 0,
        message: 'User must have at least one role!',
      },
    },
  },
  {
    timestamps: true,
    collection: 'users-data',
  }
)

const User = mongoose.model<IUser>('User', userSchema)

export default User
export { IUser, UserRole }
