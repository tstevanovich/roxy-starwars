import mongoose from 'mongoose';

import { connectDatabase } from '../server/src/db.ts';
import { initializeInquisitor, inquisitorKey } from '../server/src/old-republic.ts';

try {
  await connectDatabase(process.env.MONGODB_URI);
  const result = await initializeInquisitor();
  console.log(`Workspace ready: ${result.project.name}`);
  console.log(`Open http://127.0.0.1:5000/?project=${inquisitorKey}`);
} finally {
  await mongoose.disconnect();
}
