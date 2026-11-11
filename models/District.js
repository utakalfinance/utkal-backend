const mongoose = require('mongoose');

const districtSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'District name is required'],
      trim: true,
      index: true,
    },
    code: {
      type: String,
      required: [true, 'District code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      default: 'Odisha',
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Branch / Office address is required'],
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, 'Contact number is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    assignedAdmin: {
      name: { type: String, default: 'Unassigned' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      assignedAt: { type: Date, default: null },
    },
    createdBy: {
      type: String,
      default: 'Super Admin',
    },
    lastUpdatedBy: {
      type: String,
      default: 'Super Admin',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.District || mongoose.model('District', districtSchema);
