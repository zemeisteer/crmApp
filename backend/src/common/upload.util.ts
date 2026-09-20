import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { createId } from '@paralleldrive/cuid2';

// Shared multer disk-storage config for homework/exam attachments —
// content-addressed-ish filenames (cuid) so nothing collides, original
// name is kept separately in the DB for display/download.
export const attachmentStorage = diskStorage({
  destination: join(__dirname, '..', '..', 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${createId()}${extname(file.originalname)}`);
  },
});

export const ATTACHMENT_MAX_SIZE = 15 * 1024 * 1024; // 15MB
