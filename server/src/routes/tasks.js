import { Router } from 'express';
import mongoose from 'mongoose';

import { Task } from '../models/Task.js';

export const tasksRouter = Router();

function validateBody(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'A JSON object is required.';
  const keys = Object.keys(body);
  if (keys.some((key) => !['title', 'completed'].includes(key))) return 'Unknown task field.';
  if (keys.length === 0) return 'Provide at least one task field.';
  if (!partial || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      return 'Title must contain between 1 and 200 characters.';
    }
  }
  if (Object.hasOwn(body, 'completed') && typeof body.completed !== 'boolean') {
    return 'Completed must be a boolean.';
  }
  return null;
}

tasksRouter.param('id', (req, res, next, id) => {
  if (!mongoose.isObjectIdOrHexString(id))
    return res.status(400).json({ message: 'Invalid task ID.' });
  next();
});

tasksRouter.get('/', async (_req, res) => {
  const tasks = await Task.find().sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  res.json({ tasks });
});

tasksRouter.post('/', async (req, res) => {
  const error = validateBody(req.body);
  if (error) return res.status(400).json({ message: error });
  const task = await Task.create(req.body);
  res.status(201).json({ task });
});

tasksRouter.patch('/:id', async (req, res) => {
  const error = validateBody(req.body, true);
  if (error) return res.status(400).json({ message: error });
  const task = await Task.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { returnDocument: 'after', runValidators: true }
  );
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  res.json({ task });
});

tasksRouter.delete('/:id', async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task not found.' });
  res.status(204).end();
});
