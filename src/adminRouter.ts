import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import crypto from 'crypto';
import { createUser, deleteUserByEmail, sendWelcomeEmail, sendRemovalNotice } from './services';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

//@ts-ignore
router.post('/users/import',upload.single('file'), async (req, res) => {
    try {
      const action: 'joiners' | 'leavers' = req.body.actionType;
      if (!req.file || !action) {
        return res.status(400).json({ error: 'Missing file or actionType' });
      }

      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: Array<{ fullname?: string; email: string }> =
        xlsx.utils.sheet_to_json(sheet);

      const results: { success: number; failed: number; errors: string[] } = {
        success: 0,
        failed: 0,
        errors: [],
      };

      for (const [i, row] of rows.entries()) {
        const email = row.email?.trim();
        const fullname = row.fullname?.trim() || '';
        if (!email) {
          results.failed++;
          results.errors.push(`Row ${i + 2}: missing email`);
          continue;
        }

        try {
          if (action === 'joiners') {
            // generate random password
            const password = crypto.randomBytes(6).toString('base64');
            await createUser({ fullname, email, password });
            await sendWelcomeEmail(email, password);
          } else {
            await deleteUserByEmail(email);
            await sendRemovalNotice(email);
          }
          results.success++;
        } catch (err: any) {
          results.failed++;
          results.errors.push(
            `Row ${i + 2} (${email}): ${(err.message || err).toString()}`
          );
        }
      }

      return res.json(results);
    } catch (err: any) {
      console.error('Import error:', err);
      return res.status(500).json({ error: err.message || 'Import failed' });
    }
  }
);

export default router;