import mongoose, { Document, Schema, Types } from 'mongoose'

enum UserRole {
  THERAPIST = 'therapist',
  PATIENT = 'patient',
  ADMIN = 'admin',
}

type IUser = Document & {
  username: string
  email: string
  password: string
  name?: string
  createdAt: Date
  updatedAt: Date
  verificationCode?: string
  verificationCodeExpires?: Date
  isVerified?: boolean
  resetPasswordToken?: string
  resetPasswordExpires?: Date
  lastLogin: Date
  roles: UserRole[]
  isVerifiedTherapist?: boolean
  patients?: Types.ObjectId[]
  therapist?: Types.ObjectId
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
    name: {
      type: String,
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long!'],
      maxlength: [50, 'Name cannot exceed 50 characters!'],
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
    isVerifiedTherapist: {
      type: Boolean,
      default: false,
    },
    patients: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    therapist: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    collection: 'users-data',
  }
)

userSchema.index({ roles: 1 })
userSchema.index({ isVerified: 1 })
userSchema.index({ isVerifiedTherapist: 1 })
userSchema.index({ therapist: 1 })
userSchema.index({ createdAt: -1 })
userSchema.index({ lastLogin: -1 })

// text-ish search via case-insensitive regex still benefits from these:
userSchema.index({ username: 1 })
userSchema.index({ name: 1 })

const User = mongoose.model<IUser>('User', userSchema)

export default User
export { IUser, UserRole }
