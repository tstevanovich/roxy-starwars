import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    completed: { type: Boolean, default: false, required: true }
  },
  { timestamps: true, versionKey: false }
);

export const Task = mongoose.model('Task', taskSchema);
