import mongoose from 'mongoose';

mongoose.set('bufferCommands', false);

export async function connectDatabase(uri: string) {
  if (!uri) throw new Error('MONGODB_URI is required. Copy server/.env.example to server/.env.');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}
